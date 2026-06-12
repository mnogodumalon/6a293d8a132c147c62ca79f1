import { useDashboardData } from '@/hooks/useDashboardData';
import { enrichBuchungen } from '@/lib/enrich';
import type { EnrichedBuchungen } from '@/types/enriched';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { useState, useMemo, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  IconAlertCircle, IconTool, IconRefresh, IconCheck,
  IconCalendar, IconPlus, IconPhone, IconMail,
  IconArrowDown, IconArrowUp, IconHome, IconUsers,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { format, parseISO, isToday, isBefore, startOfDay, isAfter, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatCard, StatCardRow } from '@/components/StatCard';
import {
  ResourceTimeline,
  ResourceTimelineSkeleton,
  ResourceTimelineError,
  type ResourceEvent,
  type ResourceGroup,
} from '@/components/widgets/ResourceTimeline';
import {
  RecordOverlay,
  RecordHeader,
  RecordSection,
  RecordField,
  RecordAttachments,
  useRecordOverlayStack,
} from '@/components/widgets/RecordView';
import { BuchungenDialog } from '@/components/dialogs/BuchungenDialog';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { useClock, gruss, namen, undoToast, ENTRANCE, entranceDelay } from '@/lib/polish';

const APPGROUP_ID = '6a293d8a132c147c62ca79f1';
const REPAIR_ENDPOINT = '/claude/build/repair';

const EVENT_PREFIX = 'buchung';
function buchungIdOf(id: string): string {
  return id.split(':')[1] ?? '';
}

/** Block overlapping bookings — same apartment, overlapping date range.
 * Check-out day = check-in day is ALLOWED (11:00 / 15:00 rule). */
function hasOverlap(
  buchungen: EnrichedBuchungen[],
  ferienwohnungId: string,
  anreise: string,
  abreise: string,
  excludeId?: string,
): boolean {
  const newFrom = parseISO(anreise);
  const newTo = parseISO(abreise);
  for (const b of buchungen) {
    if (b.record_id === excludeId) continue;
    const bId = extractRecordId(b.fields.ferienwohnung);
    if (bId !== ferienwohnungId) continue;
    const bAnreise = b.fields.anreise;
    const bAbreise = b.fields.abreise;
    if (!bAnreise || !bAbreise) continue;
    const bFrom = parseISO(bAnreise);
    const bTo = parseISO(bAbreise);
    // Overlap if new starts before existing ends AND new ends after existing starts
    // BUT same-day check-out/check-in is allowed → strict inequality
    if (isBefore(newFrom, bTo) && isAfter(newTo, bFrom)) return true;
  }
  return false;
}

export default function DashboardOverview() {
  const {
    ferienwohnungen, buchungen, setBuchungen,
    ferienwohnungenMap,
    loading, error, fetchAll,
  } = useDashboardData();

  const clock = useClock();

  // ALL hooks before early returns
  const enrichedBuchungen = useMemo(
    () => enrichBuchungen(buchungen, { ferienwohnungenMap }),
    [buchungen, ferienwohnungenMap],
  );

  const overlay = useRecordOverlayStack<EnrichedBuchungen>();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EnrichedBuchungen | null>(null);
  const [createSeed, setCreateSeed] = useState<{
    anreise?: string;
    abreise?: string;
    ferienwohnung?: string;
  } | null>(null);

  const today = format(clock, 'yyyy-MM-dd');

  // KPI: today's arrivals & departures
  const todayArrivals = useMemo(
    () => enrichedBuchungen.filter(b => b.fields.anreise === today),
    [enrichedBuchungen, today],
  );
  const todayDepartures = useMemo(
    () => enrichedBuchungen.filter(b => b.fields.abreise === today),
    [enrichedBuchungen, today],
  );
  const currentGuests = useMemo(() => {
    return enrichedBuchungen.filter(b => {
      const anr = b.fields.anreise;
      const abr = b.fields.abreise;
      if (!anr || !abr) return false;
      const from = parseISO(anr);
      const to = parseISO(abr);
      return !isAfter(from, clock) && isAfter(to, clock);
    });
  }, [enrichedBuchungen, clock]);

  // ResourceTimeline groups
  const groups = useMemo<ResourceGroup[]>(
    () => ferienwohnungen.map(fw => ({
      key: fw.record_id,
      label: fw.fields.bezeichnung ?? fw.record_id,
    })),
    [ferienwohnungen],
  );

  // Records → ResourceEvent bars
  const events = useMemo<ResourceEvent[]>(
    () =>
      enrichedBuchungen
        .filter(b => !!b.fields.anreise && !!b.fields.ferienwohnung)
        .map(b => {
          const gwId = extractRecordId(b.fields.ferienwohnung);
          const guestName = [b.fields.gast_vorname, b.fields.gast_nachname]
            .filter(Boolean)
            .join(' ') || 'Buchung';
          const isArriving = b.fields.anreise === today;
          const isDeparting = b.fields.abreise === today;
          return {
            id: `${EVENT_PREFIX}:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title: guestName,
            subtitle: b.fields.anzahl_personen
              ? `${b.fields.anzahl_personen} Pers.`
              : undefined,
            tone: isArriving ? 'primary' : isDeparting ? 'warning' : 'default',
            group: gwId ?? '',
          } satisfies ResourceEvent;
        }),
    [enrichedBuchungen, today],
  );

  // Drag reschedule with overlap check
  const handleEventDrop = useCallback(
    async (id: string, newStart: string, newEnd?: string, newGroup?: string): Promise<void | string> => {
      const rid = buchungIdOf(id);
      const booking = enrichedBuchungen.find(b => b.record_id === rid);
      if (!rid || !booking) return;

      const fwId = newGroup ?? extractRecordId(booking.fields.ferienwohnung) ?? '';
      const endDate = newEnd ?? newStart;
      if (hasOverlap(enrichedBuchungen, fwId, newStart, endDate, rid)) {
        return 'Diese Wohnung ist im gewählten Zeitraum bereits belegt.';
      }

      const fwPatch = newGroup
        ? { ferienwohnung: createRecordUrl(APP_IDS.FERIENWOHNUNGEN, newGroup) }
        : {};

      // Optimistic update
      setBuchungen(prev =>
        prev.map(b =>
          b.record_id === rid
            ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...fwPatch } }
            : b,
        ),
      );

      const snapshot = { ...booking.fields };
      undoToast(
        `Buchung ${[booking.fields.gast_vorname, booking.fields.gast_nachname].filter(Boolean).join(' ')} verschoben`,
        () => {
          setBuchungen(prev =>
            prev.map(b => (b.record_id === rid ? { ...b, fields: snapshot } : b)),
          );
          void LivingAppsService.updateBuchungenEntry(rid, snapshot).catch(() => fetchAll());
        },
      );

      try {
        await LivingAppsService.updateBuchungenEntry(rid, {
          anreise: newStart,
          ...(newEnd ? { abreise: newEnd } : {}),
          ...fwPatch,
        });
      } catch {
        fetchAll();
      }
    },
    [enrichedBuchungen, setBuchungen, fetchAll],
  );

  // Drag resize
  const handleEventResize = useCallback(
    async (id: string, newStart: string, newEnd: string): Promise<void | string> => {
      const rid = buchungIdOf(id);
      const booking = enrichedBuchungen.find(b => b.record_id === rid);
      if (!rid || !booking) return;

      const fwId = extractRecordId(booking.fields.ferienwohnung) ?? '';
      if (hasOverlap(enrichedBuchungen, fwId, newStart, newEnd, rid)) {
        return 'Diese Wohnung ist im gewählten Zeitraum bereits belegt.';
      }

      setBuchungen(prev =>
        prev.map(b =>
          b.record_id === rid
            ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
            : b,
        ),
      );

      try {
        await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      } catch {
        fetchAll();
      }
    },
    [enrichedBuchungen, setBuchungen, fetchAll],
  );

  // Open create dialog from empty cell click
  const handleEmptyClick = useCallback((date: Date, group?: string) => {
    setCreateSeed({
      anreise: format(date, 'yyyy-MM-dd'),
      ferienwohnung: group,
    });
    setEditRecord(null);
    setDialogOpen(true);
  }, []);

  // Open create from drag-to-create
  const handleRangeCreate = useCallback((start: Date, end: Date, group?: string) => {
    setCreateSeed({
      anreise: format(start, 'yyyy-MM-dd'),
      abreise: format(end, 'yyyy-MM-dd'),
      ferienwohnung: group,
    });
    setEditRecord(null);
    setDialogOpen(true);
  }, []);

  // Open edit dialog from overlay
  const handleEditFromOverlay = useCallback((b: EnrichedBuchungen) => {
    setEditRecord(b);
    setCreateSeed(null);
    setDialogOpen(true);
  }, []);

  // Context greeting
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (todayArrivals.length > 0) {
      const names = todayArrivals.map(b =>
        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
      );
      parts.push(`Heute reist ${namen(names)} an`);
    }
    if (todayDepartures.length > 0) {
      const names = todayDepartures.map(b =>
        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
      );
      parts.push(`${namen(names)} reist ab`);
    }
    if (parts.length === 0 && currentGuests.length > 0) {
      const names = currentGuests.map(b =>
        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
      );
      parts.push(`Aktuell wohnt ${namen(names)} bei dir`);
    }
    if (parts.length === 0) {
      return 'Heute sind beide Wohnungen frei.';
    }
    return parts.join(' — ') + '.';
  }, [todayArrivals, todayDepartures, currentGuests]);

  // Upcoming arrivals for aside (next 7 days, excl. today)
  const upcomingArrivals = useMemo(() => {
    const tomorrow = startOfDay(addDays(clock, 1));
    const limit = addDays(clock, 8);
    return enrichedBuchungen
      .filter(b => {
        const anr = b.fields.anreise;
        if (!anr) return false;
        const d = parseISO(anr);
        return !isBefore(d, tomorrow) && isBefore(d, limit);
      })
      .sort((a, b) => (a.fields.anreise ?? '').localeCompare(b.fields.anreise ?? ''));
  }, [enrichedBuchungen, clock]);

  // Today's departures for aside
  const todayDepartureItems = useMemo(
    () =>
      todayDepartures.map(b => ({
        id: b.record_id,
        title: [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' ') || 'Gast',
        secondLine: (
          <>
            <span className="text-amber-600 font-medium">Abreise heute</span>
            <span className="text-muted-foreground"> · {b.ferienwohnungName || 'Unbekannte Wohnung'}</span>
            {b.fields.gast_telefon && (
              <span className="text-muted-foreground"> · {b.fields.gast_telefon}</span>
            )}
          </>
        ),
        icon: <IconArrowUp size={14} className="text-amber-500 shrink-0" />,
      })),
    [todayDepartures],
  );

  const todayArrivalItems = useMemo(
    () =>
      todayArrivals.map(b => ({
        id: b.record_id,
        title: [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' ') || 'Gast',
        secondLine: (
          <>
            <span className="text-primary font-medium">Anreise heute ab 15 Uhr</span>
            <span className="text-muted-foreground"> · {b.ferienwohnungName || 'Unbekannte Wohnung'}</span>
            {b.fields.anzahl_personen ? (
              <span className="text-muted-foreground"> · {b.fields.anzahl_personen} Pers.</span>
            ) : null}
          </>
        ),
        icon: <IconArrowDown size={14} className="text-primary shrink-0" />,
      })),
    [todayArrivals],
  );

  const upcomingArrivalItems = useMemo(
    () =>
      upcomingArrivals.slice(0, 5).map(b => ({
        id: b.record_id,
        title: [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' ') || 'Gast',
        secondLine: (
          <>
            <span className="text-foreground font-medium">
              {b.fields.anreise
                ? format(parseISO(b.fields.anreise), 'EEE dd.MM.', { locale: de })
                : '—'}
            </span>
            <span className="text-muted-foreground"> · {b.ferienwohnungName || 'Wohnung'}</span>
          </>
        ),
        icon: <IconCalendar size={14} className="text-muted-foreground shrink-0" />,
      })),
    [upcomingArrivals],
  );

  // Next arrival text for empty state
  const nextArrivalText = useMemo(() => {
    const next = enrichedBuchungen
      .filter(b => b.fields.anreise && isAfter(parseISO(b.fields.anreise), clock))
      .sort((a, b) => (a.fields.anreise ?? '').localeCompare(b.fields.anreise ?? ''))[0];
    if (!next) return 'Keine bevorstehenden Buchungen';
    const name = [next.fields.gast_vorname, next.fields.gast_nachname].filter(Boolean).join(' ');
    return `Nächste Anreise: ${next.fields.anreise ? format(parseISO(next.fields.anreise), 'EEE dd.MM.', { locale: de }) : '—'}${name ? ` — ${name}` : ''}`;
  }, [enrichedBuchungen, clock]);

  // Overlay's current record
  const overlayRecord = overlay.top ?? null;

  if (loading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} onRetry={fetchAll} />;

  // Hero: show if someone arrives or departs today (concrete signal)
  const heroRecord = todayArrivals[0] ?? todayDepartures[0] ?? null;
  const heroIsArrival = !!todayArrivals[0];

  return (
    <>
      {/* Page header */}
      <div className={`mb-6 flex flex-wrap items-start justify-between gap-4 ${ENTRANCE}`}>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contextLine}</p>
        </div>
        <Button
          onClick={() => {
            setCreateSeed(null);
            setEditRecord(null);
            setDialogOpen(true);
          }}
          size="sm"
        >
          <IconPlus size={14} className="mr-1 shrink-0" />
          Neue Buchung
        </Button>
      </div>

      <DashboardGrid
        hero={
          heroRecord
            ? (
              <HeroBanner
                icon={heroIsArrival ? <IconArrowDown size={18} /> : <IconArrowUp size={18} />}
                tone={heroIsArrival ? 'primary' : 'warning'}
                action={{
                  label: heroIsArrival ? 'Buchung öffnen' : 'Buchung öffnen',
                  onClick: () => overlay.replace(heroRecord),
                }}
              >
                {heroIsArrival ? (
                  <>
                    <b>
                      {[heroRecord.fields.gast_vorname, heroRecord.fields.gast_nachname].filter(Boolean).join(' ')}
                    </b>{' '}
                    reist heute ab 15 Uhr an —{' '}
                    {heroRecord.ferienwohnungName || 'Ferienwohnung'}
                    {heroRecord.fields.anzahl_personen
                      ? `, ${heroRecord.fields.anzahl_personen} Personen`
                      : ''}
                    .
                  </>
                ) : (
                  <>
                    <b>
                      {[heroRecord.fields.gast_vorname, heroRecord.fields.gast_nachname].filter(Boolean).join(' ')}
                    </b>{' '}
                    reist heute bis 11 Uhr ab —{' '}
                    {heroRecord.ferienwohnungName || 'Ferienwohnung'}.
                  </>
                )}
              </HeroBanner>
            )
            : undefined
        }
        kpis={
          <StatCardRow>
            <StatCard
              title="Anreisen heute"
              value={todayArrivals.length}
              description={
                todayArrivals.length > 0
                  ? namen(
                      todayArrivals.map(b =>
                        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
                      ),
                    )
                  : 'Keine Anreisen'
              }
              icon={<IconArrowDown size={18} className="text-muted-foreground" />}
              tone={todayArrivals.length > 0 ? 'primary' : 'default'}
            />
            <StatCard
              title="Abreisen heute"
              value={todayDepartures.length}
              description={
                todayDepartures.length > 0
                  ? namen(
                      todayDepartures.map(b =>
                        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
                      ),
                    )
                  : 'Keine Abreisen'
              }
              icon={<IconArrowUp size={18} className="text-muted-foreground" />}
              tone={todayDepartures.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Aktuell belegt"
              value={`${currentGuests.length} / ${ferienwohnungen.length}`}
              description={
                currentGuests.length > 0
                  ? namen(
                      currentGuests.map(b =>
                        [b.fields.gast_vorname, b.fields.gast_nachname].filter(Boolean).join(' '),
                      ),
                    )
                  : 'Beide Wohnungen frei'
              }
              icon={<IconHome size={18} className="text-muted-foreground" />}
              tone={currentGuests.length > 0 ? 'success' : 'default'}
            />
            <StatCard
              title="Nächste Anreisen"
              value={upcomingArrivals.length}
              description={
                upcomingArrivals.length > 0
                  ? `Nächste: ${upcomingArrivals[0].fields.anreise ? format(parseISO(upcomingArrivals[0].fields.anreise), 'EEE dd.MM.', { locale: de }) : '—'}`
                  : 'Keine in 7 Tagen'
              }
              icon={<IconCalendar size={18} className="text-muted-foreground" />}
              tone="default"
            />
          </StatCardRow>
        }
        aside={
          <>
            {/* Slice 1: Today's events (arrivals + departures) */}
            <WorkList
              title="Heute"
              icon={<IconCalendar size={16} className="shrink-0" />}
              items={[...todayArrivalItems, ...todayDepartureItems]}
              onItemClick={id => {
                const b = enrichedBuchungen.find(x => x.record_id === id);
                if (b) overlay.replace(b);
              }}
              empty={{
                text: nextArrivalText,
                action: { label: 'Buchung anlegen', onClick: () => { setCreateSeed(null); setEditRecord(null); setDialogOpen(true); } },
              }}
            />

            {/* Slice 2: Upcoming arrivals (next 7 days) */}
            <WorkList
              title="Nächste Anreisen (7 Tage)"
              icon={<IconUsers size={16} className="shrink-0" />}
              items={upcomingArrivalItems}
              onItemClick={id => {
                const b = enrichedBuchungen.find(x => x.record_id === id);
                if (b) overlay.replace(b);
              }}
              empty={{
                text: 'Keine Buchungen in den nächsten 7 Tagen',
                action: { label: 'Buchung anlegen', onClick: () => { setCreateSeed(null); setEditRecord(null); setDialogOpen(true); } },
              }}
            />
          </>
        }
        primary={
          <div
            className={ENTRANCE}
            style={{ ...entranceDelay(360) }}
          >
            <ResourceTimeline
              events={events}
              groups={groups}
              axis="day"
              defaultRange="2weeks"
              defaultDate={clock}
              locale={de}
              onEventClick={ev => {
                const b = enrichedBuchungen.find(x => x.record_id === buchungIdOf(ev.id));
                if (b) overlay.replace(b);
              }}
              onEventDrop={handleEventDrop}
              onEventResize={handleEventResize}
              onEmptyClick={handleEmptyClick}
              onRangeCreate={handleRangeCreate}
              renderGroupHeader={group => (
                <div className="flex w-full items-center gap-2 min-w-0">
                  <IconHome size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium text-foreground">
                    {group.label}
                  </span>
                </div>
              )}
            />
          </div>
        }
      />

      {/* Record detail overlay */}
      <RecordOverlay
        open={overlay.open}
        onClose={overlay.close}
        onEdit={() => overlayRecord && handleEditFromOverlay(overlayRecord)}
        editLabel="Bearbeiten"
        ariaLabel="Buchungsdetails"
        footer={
          overlayRecord ? (
            <div className="flex flex-wrap items-center gap-2">
              {overlayRecord.fields.gast_telefon && (
                <a
                  href={`tel:${overlayRecord.fields.gast_telefon}`}
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <IconPhone size={14} className="shrink-0" />
                  {overlayRecord.fields.gast_telefon}
                </a>
              )}
              {overlayRecord.fields.gast_email && (
                <a
                  href={`mailto:${overlayRecord.fields.gast_email}`}
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <IconMail size={14} className="shrink-0" />
                  {overlayRecord.fields.gast_email}
                </a>
              )}
            </div>
          ) : undefined
        }
      >
        {overlayRecord && (
          <>
            <RecordHeader
              title={
                [overlayRecord.fields.gast_vorname, overlayRecord.fields.gast_nachname]
                  .filter(Boolean)
                  .join(' ') || 'Buchung'
              }
              meta={
                <>
                  {overlayRecord.ferienwohnungName || 'Ferienwohnung'} ·{' '}
                  {formatDate(overlayRecord.fields.anreise)}
                  {overlayRecord.fields.abreise ? ` – ${formatDate(overlayRecord.fields.abreise)}` : ''}
                </>
              }
            />
            <RecordSection title="Aufenthalt" cols={2}>
              <RecordField label="Anreise" value={overlayRecord.fields.anreise} format="date" />
              <RecordField label="Abreise" value={overlayRecord.fields.abreise} format="date" />
              <RecordField label="Ferienwohnung" value={overlayRecord.ferienwohnungName} />
              <RecordField
                label="Personen"
                value={overlayRecord.fields.anzahl_personen != null ? String(overlayRecord.fields.anzahl_personen) : undefined}
              />
            </RecordSection>
            <RecordSection title="Gast" cols={2}>
              <RecordField label="Vorname" value={overlayRecord.fields.gast_vorname} />
              <RecordField label="Nachname" value={overlayRecord.fields.gast_nachname} />
              <RecordField label="E-Mail" value={overlayRecord.fields.gast_email} format="email" />
              <RecordField label="Telefon" value={overlayRecord.fields.gast_telefon} />
            </RecordSection>
            {overlayRecord.fields.bemerkungen && (
              <RecordSection title="Bemerkungen">
                <RecordField label="" value={overlayRecord.fields.bemerkungen} format="longtext" />
              </RecordSection>
            )}
            <RecordAttachments appId={APP_IDS.BUCHUNGEN} recordId={overlayRecord.record_id} />
          </>
        )}
      </RecordOverlay>

      {/* Create / Edit dialog */}
      <BuchungenDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditRecord(null); setCreateSeed(null); }}
        onSubmit={async fields => {
          if (editRecord) {
            await LivingAppsService.updateBuchungenEntry(editRecord.record_id, fields);
          } else {
            await LivingAppsService.createBuchungenEntry(fields);
          }
          fetchAll();
        }}
        defaultValues={
          editRecord
            ? editRecord.fields
            : createSeed
            ? {
                anreise: createSeed.anreise,
                abreise: createSeed.abreise,
                ferienwohnung: createSeed.ferienwohnung
                  ? createRecordUrl(APP_IDS.FERIENWOHNUNGEN, createSeed.ferienwohnung)
                  : undefined,
              }
            : undefined
        }
        recordId={editRecord?.record_id}
        ferienwohnungenList={ferienwohnungen}
        enablePhotoScan={AI_PHOTO_SCAN['Buchungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Buchungen']}
      />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
      <ResourceTimelineSkeleton />
    </div>
  );
}

function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [repairing, setRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [repairDone, setRepairDone] = useState(false);
  const [repairFailed, setRepairFailed] = useState(false);

  const handleRepair = async () => {
    setRepairing(true);
    setRepairStatus('Reparatur wird gestartet...');
    setRepairFailed(false);

    const errorContext = JSON.stringify({
      type: 'data_loading',
      message: error.message,
      stack: (error.stack ?? '').split('\n').slice(0, 10).join('\n'),
      url: window.location.href,
    });

    try {
      const resp = await fetch(REPAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appgroup_id: APPGROUP_ID, error_context: errorContext }),
      });

      if (!resp.ok || !resp.body) {
        setRepairing(false);
        setRepairFailed(true);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          const content = line.slice(6);
          if (content.startsWith('[STATUS]')) setRepairStatus(content.replace(/^\[STATUS]\s*/, ''));
          if (content.startsWith('[DONE]')) { setRepairDone(true); setRepairing(false); }
          if (content.startsWith('[ERROR]') && !content.includes('Dashboard-Links')) setRepairFailed(true);
        }
      }
    } catch {
      setRepairing(false);
      setRepairFailed(true);
    }
  };

  if (repairDone) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
          <IconCheck size={22} className="text-green-500" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground mb-1">Dashboard repariert</h3>
          <p className="text-sm text-muted-foreground max-w-xs">Das Problem wurde behoben. Bitte lade die Seite neu.</p>
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          <IconRefresh size={14} className="mr-1" />Neu laden
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
        <IconAlertCircle size={22} className="text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-semibold text-foreground mb-1">Fehler beim Laden</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {repairing ? repairStatus : error.message}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} disabled={repairing}>Erneut versuchen</Button>
        <Button size="sm" onClick={handleRepair} disabled={repairing}>
          {repairing
            ? <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-1" />
            : <IconTool size={14} className="mr-1" />}
          {repairing ? 'Reparatur läuft...' : 'Dashboard reparieren'}
        </Button>
      </div>
      {repairFailed && <p className="text-sm text-destructive">Automatische Reparatur fehlgeschlagen.</p>}
    </div>
  );
}
