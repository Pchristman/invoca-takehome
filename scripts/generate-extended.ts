// Builds the extended export: the shipped calls untouched, plus synthetic calls that plant patterns.
// A one-off tool, not part of the app. It imports nothing from src/ (Node cannot resolve src's
// extensionless imports). Output depends only on (input text, config, seed): own PRNG, no clock.
import { parse } from 'csv-parse/sync';

export interface ExportTexts {
  calls: string;
  campaigns: string;
  locations: string;
}

export interface ExtendedConfig {
  seed: number;
  windowDays: number; // length of the C and D windows
  officeAnswerDrop: { locationId: string; weekdays: { from: number; to: number }; hours: { from: number; to: number }; calls: number; answered: number };
  officeLowConversion: { locationId: string; calls: number; unanswered: number; booked: number };
  campaignSurge: { campaignId: string; calls: number; unanswered: number; booked: number };
  campaignFade: { campaignId: string; calls: number; unanswered: number; booked: number };
  plainCalls: number;
  unattributedCalls: number;
  pendingCalls: number;
  duplicatedCalls: number;
  threeRowCalls: number; // <= duplicatedCalls
}

// weekdays 0 = Monday, inclusive; hours are local, inclusive. Within each block the rest of its calls
// are answered and not booked.
export const DEFAULT_CONFIG: ExtendedConfig = {
  seed: 20261101,
  windowDays: 28,
  officeAnswerDrop: { locationId: 'loc_06', weekdays: { from: 0, to: 4 }, hours: { from: 9, to: 11 }, calls: 200, answered: 40 },
  officeLowConversion: { locationId: 'loc_02', calls: 300, unanswered: 63, booked: 12 },
  campaignSurge: { campaignId: 'cmp_04', calls: 150, unanswered: 30, booked: 60 },
  campaignFade: { campaignId: 'cmp_06', calls: 150, unanswered: 30, booked: 0 },
  plainCalls: 480,
  unattributedCalls: 30,
  pendingCalls: 10,
  duplicatedCalls: 80,
  threeRowCalls: 20,
};

export class GenerateError extends Error {}

type Row = Record<string, string>;

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const WEEK = 7 * DAY;

/** mulberry32: a small seeded generator. Returns numbers in [0, 1). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from lo to hi, both included. */
const randInt = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

const toIso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Shift a start time by a random whole number of weeks so it lands in [lo, hi] (milliseconds).
 * Weekday and time of day are kept. Returns null when no whole-week shift fits.
 */
function shiftByWeeksInto(startMs: number, lo: number, hi: number, rng: () => number): number | null {
  const fewest = Math.ceil((lo - startMs) / WEEK);
  const most = Math.floor((hi - startMs) / WEEK);
  if (fewest > most) return null;
  return startMs + randInt(rng, fewest, most) * WEEK;
}

interface Source {
  header: string[];
  rows: Row[];
}

function readCalls(text: string): Source {
  let header: string[] = [];
  const rows = parse(text, {
    columns: (h: string[]) => {
      header = h;
      return h;
    },
    skip_empty_lines: true,
  }) as Row[];
  return { header, rows };
}

/** The final state of each real call: the row with the latest updated_at per call_id. */
function finalStates(rows: Row[]): Row[] {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const id = row.call_id ?? '';
    const have = latest.get(id);
    if (!have || Date.parse(row.updated_at ?? '') > Date.parse(have.updated_at ?? '')) latest.set(id, row);
  }
  return [...latest.values()];
}

const isPending = (r: Row): boolean => r.answered === 'true' && (r.outcome ?? '') === '';

/** Row line text in header order; a field with a comma, quote or line break would need quoting, so refuse it. */
function serialise(header: string[], row: Row): string {
  return header
    .map((col) => {
      const value = row[col] ?? '';
      if (/[",\r\n]/.test(value)) throw new GenerateError(`Cannot copy a template with a comma, quote or line break in ${col}: ${value}`);
      return value;
    })
    .join(',');
}

export function generateExtendedCalls(input: ExportTexts, partial: Partial<ExtendedConfig> = {}): string {
  const config: ExtendedConfig = { ...DEFAULT_CONFIG, ...partial };
  const rng = makeRng(config.seed);
  const { header, rows } = readCalls(input.calls);

  const starts = rows.map((r) => Date.parse(r.started_at ?? '')).filter((t) => !Number.isNaN(t));
  if (starts.length === 0) throw new GenerateError('The data span is empty: no call has a valid started_at');
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  if (last - first < WEEK) throw new GenerateError('The data span is under a week; there is no room to place synthetic calls');
  const lo = first + DAY;
  const hi = last - DAY;

  const existingIds = new Set(rows.map((r) => r.call_id));
  let nextId = 1;
  const newId = (): string => {
    const id = `x_${String(nextId++).padStart(6, '0')}`;
    if (existingIds.has(id)) throw new GenerateError(`Synthetic id ${id} already exists in the input`);
    return id;
  };

  const templates = finalStates(rows).filter((r) => !Number.isNaN(Date.parse(r.started_at ?? '')));
  const synthetic: string[] = [];

  /** A copy of `template` starting at `startMs`, with new id, caller hash and timestamps. */
  const clone = (template: Row, startMs: number): Row => {
    const duration = Number(template.duration_seconds);
    const endMs = startMs + duration * SECOND;
    return {
      ...template,
      call_id: newId(),
      started_at: toIso(startMs),
      ended_at: toIso(endMs),
      caller_number_hash: `h_x${randInt(rng, 0, 0xfffffff).toString(16).padStart(7, '0')}`,
      updated_at: toIso(endMs + randInt(rng, 5, 30) * SECOND),
    };
  };

  // Plain calls: week-shifted clones of attributed, non-pending real calls.
  const plainPool = templates.filter((r) => (r.campaign_id ?? '') !== '' && !isPending(r));
  if (config.plainCalls > 0 && plainPool.length === 0) throw new GenerateError('No plain templates: every real call is unattributed or pending');
  for (let i = 0; i < config.plainCalls; i++) {
    const template = plainPool[randInt(rng, 0, plainPool.length - 1)] as Row;
    const startMs = shiftByWeeksInto(Date.parse(template.started_at ?? ''), lo, hi, rng);
    if (startMs === null) throw new GenerateError(`The data span is too short to place a copy of call ${template.call_id}`);
    synthetic.push(serialise(header, clone(template, startMs)));
  }

  return input.calls + synthetic.map((line) => line + '\r\n').join('');
}
