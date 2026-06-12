// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Ferienwohnungen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    bezeichnung?: string;
    beschreibung?: string;
    max_personen?: number;
    lage?: string;
    hinweise?: string;
  };
}

export interface Buchungen {
  record_id: string;
  createdat: string;
  updatedat: string | null;
  fields: {
    ferienwohnung?: string; // applookup -> URL zu 'Ferienwohnungen' Record
    anreise?: string; // Format: YYYY-MM-DD oder ISO String
    abreise?: string; // Format: YYYY-MM-DD oder ISO String
    gast_vorname?: string;
    gast_nachname?: string;
    gast_email?: string;
    gast_telefon?: string;
    anzahl_personen?: number;
    bemerkungen?: string;
  };
}

export const APP_IDS = {
  FERIENWOHNUNGEN: '6a293d78523cacb6cdbf4f0d',
  BUCHUNGEN: '6a293d7b075920351b0a17fc',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {};

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'ferienwohnungen': {
    'bezeichnung': 'string/text',
    'beschreibung': 'string/textarea',
    'max_personen': 'number',
    'lage': 'string/text',
    'hinweise': 'string/textarea',
  },
  'buchungen': {
    'ferienwohnung': 'applookup/select',
    'anreise': 'date/date',
    'abreise': 'date/date',
    'gast_vorname': 'string/text',
    'gast_nachname': 'string/text',
    'gast_email': 'string/email',
    'gast_telefon': 'string/tel',
    'anzahl_personen': 'number',
    'bemerkungen': 'string/textarea',
  },
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateFerienwohnungen = StripLookup<Ferienwohnungen['fields']>;
export type CreateBuchungen = StripLookup<Buchungen['fields']>;