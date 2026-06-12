#!/usr/bin/env node
/**
 * check-dashboard.mjs — mechanical pre-build gate for DashboardOverview.tsx.
 *
 * Runs in Step 3 (after parse-formulas.mjs, before `npm run build`). Exits
 * non-zero with actionable messages; fix every ERROR and re-run until green.
 * Text-based on purpose: cheap, deterministic, no AST dependency.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/pages/DashboardOverview.tsx';
let src;
try {
  src = readFileSync(FILE, 'utf8');
} catch {
  console.error(`ERROR: ${FILE} not found — run from the project root.`);
  process.exit(1);
}

const errors = [];
const warnings = [];

// 1. UTC day-shift trap
if (src.includes('toISOString')) {
  errors.push("toISOString() found — day keys MUST use date-fns format(d, 'yyyy-MM-dd') (toISOString is UTC; the day flips at the wrong hour).");
}

// 2. Page skeleton: DashboardGrid or a written opt-out
if (!src.includes('<DashboardGrid') && !src.includes('layout-opt-out:')) {
  errors.push("Page layout is hand-rolled — compose <DashboardGrid hero/kpis/aside/primary> (it owns grid, mobile order, entrance). A genuinely different page shape needs a `// layout-opt-out: <reason>` comment.");
}

// 3. Polish layer imported
if (!src.includes("from '@/lib/polish'")) {
  errors.push("No import from '@/lib/polish' — the polish layer (useClock, gruss, namen, undoToast) is mandatory, do not re-derive it by hand.");
}

// 4. Drag/status writes need the undo toast
if (/onCardMove|onEventDrop|onEventResize/.test(src) && !src.includes('undoToast(')) {
  errors.push('Drag/status write handlers found but no undoToast(...) — every write gets feedback + Rückgängig (counter-write).');
}

// 5. Record clicks open the overlay
if (/onCardClick|onEventClick/.test(src) && !src.includes('<RecordOverlay')) {
  errors.push('onCardClick/onEventClick wired but no <RecordOverlay> — every record click opens the overlay (RecordView HARD RULE).');
}

// 6. Unguarded parseISO on optional record fields — the sandbox build does NOT
// enforce strictNullChecks, so parseISO(undefined) crashes at RUNTIME
// ("Cannot read properties of undefined (reading 'split')"), taking the whole
// dashboard down for one record with a missing date.
const unguardedParseISO = src.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /parseISO\(\s*[\w$]+\.fields\.\w+\s*\)/.test(line) && !/[!?]|&&/.test(line));
for (const { n } of unguardedParseISO) {
  errors.push(`Line ${n}: parseISO(x.fields.…) without a guard — one record with a missing date crashes the page. Pre-filter the chain (.filter(r => !!r.fields.X)) and assert with r.fields.X!, or guard inline (r.fields.X ? … : …).`);
}

// 7. Frozen clock
if (!src.includes('useClock(')) {
  warnings.push("useClock() not used — if any 'today'/overdue/greeting derivation exists, it must tick (a Date captured once shows yesterday tomorrow).");
}

// 8. Filler totals
if (/(?:title|description)\s*=\s*["'{][^"'}]*[Gg]esamt/.test(src)) {
  warnings.push("A KPI mentions 'gesamt' — bare totals are filler; every KPI is a clickable filter or a progress toward a limit.");
}

// 9. Aside present (or consciously omitted)
if (src.includes('<DashboardGrid') && !/aside\s*=/.test(src)) {
  warnings.push('DashboardGrid without aside — fine ONLY when the app truly has no secondary slice; otherwise add a WorkList on a different axis than the primary widget.');
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} error(s) — fix DashboardOverview.tsx and re-run.`);
  process.exit(1);
}
console.log(`check-dashboard: OK (${warnings.length} warning(s))`);
