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
const HOUR = 60 * 60 * SECOND;

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
 * Weekday and time of DAY are kept. Returns null when no whole-week shift fits.
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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Local weekday (0 = Monday) and hour (0-23) of an instant in an IANA zone. Build once per zone. */
function localClock(timeZone: string): (ms: number) => { weekday: number; hour: number } {
  const format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  return (ms) => {
    const parts = format.formatToParts(new Date(ms));
    const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return { weekday, hour };
  };
}

const MAX_ATTEMPTS = 100_000;

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
  const synthetic: Row[] = [];
  const locations = parse(input.locations, { columns: true, skip_empty_lines: true }) as Row[];
  const campaigns = parse(input.campaigns, { columns: true, skip_empty_lines: true }) as Row[];

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

  /** A start for a copy of `template`, whole weeks away, inside the span margin. */
  const shiftedStart = (template: Row, from = lo, to = hi): number => {
    const startMs = shiftByWeeksInto(Date.parse(template.started_at ?? ''), from, to, rng);
    if (startMs === null) throw new GenerateError(`The data span is too short to place a copy of call ${template.call_id}`);
    return startMs;
  };

  // Plain calls: week-shifted clones of attributed, non-pending real calls.
  const plainPool = templates.filter((r) => (r.campaign_id ?? '') !== '' && !isPending(r));
  if (config.plainCalls > 0 && plainPool.length === 0) throw new GenerateError('No plain templates: every real call is unattributed or pending');
  for (let i = 0; i < config.plainCalls; i++) {
    const template = plainPool[randInt(rng, 0, plainPool.length - 1)] as Row;
    const startMs = shiftedStart(template);
    synthetic.push(clone(template, startMs));
  }

  // Pools for the planted patterns: attributed calls only, so none of them is unattributed.
  const attributed = templates.filter((r) => (r.campaign_id ?? '') !== '');
  const unansweredPool = attributed.filter((r) => r.answered === 'false');
  const bookedPool = attributed.filter((r) => r.outcome === 'booked' && Number(r.revenue_usd) > 0);
  const notBookedPool = attributed.filter((r) => r.answered === 'true' && (r.outcome === 'qualified_lead' || r.outcome === 'not_qualified'));
  const pick = (pool: Row[]): Row => pool[randInt(rng, 0, pool.length - 1)] as Row;

  // Pattern A: an office whose calls in one local-time window mostly go unanswered.
  const a = config.officeAnswerDrop;
  if (a.calls > 0) {
    const office = locations.find((l) => l.location_id === a.locationId);
    if (!office) throw new GenerateError(`Pattern A: office ${a.locationId} is not in locations.csv`);
    if (a.answered < 0 || a.answered > a.calls) throw new GenerateError(`Pattern A: answered (${a.answered}) must be between 0 and calls (${a.calls})`);
    if (a.calls - a.answered > 0 && unansweredPool.length === 0) throw new GenerateError('Pattern A: no unanswered calls to copy');
    if (a.answered > 0 && bookedPool.length === 0) throw new GenerateError('Pattern A: no booked calls with revenue to copy');
    const clockAt = localClock(office.timezone ?? '');
    const inWindow = (ms: number): boolean => {
      const { weekday, hour } = clockAt(ms);
      return weekday >= a.weekdays.from && weekday <= a.weekdays.to && hour >= a.hours.from && hour <= a.hours.to;
    };
    const loSecond = Math.ceil(lo / SECOND);
    const hiSecond = Math.floor(hi / SECOND);
    for (let i = 0; i < a.calls; i++) {
      // The first `answered` calls are answered and booked, the rest unanswered. The answered ones are
      // booked on purpose: it keeps this office's booking rate near the others, so it is flagged for one thing.
      const template = pick(i < a.answered ? bookedPool : unansweredPool);
      let startMs = -1;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && startMs < 0; attempt++) {
        const candidate = randInt(rng, loSecond, hiSecond) * SECOND;
        if (inWindow(candidate)) startMs = candidate;
      }
      if (startMs < 0) throw new GenerateError(`Pattern A: no time in the data span falls in the window for ${a.locationId}`);
      synthetic.push({ ...clone(template, startMs), location_id: a.locationId });
    }
  }

  // Pattern B: an office with a normal answer rate but few bookings. Week-shifted clones, any campaign.
  const b = config.officeLowConversion;
  if (b.calls > 0) {
    const notBooked = b.calls - b.unanswered - b.booked;
    if (!locations.some((l) => l.location_id === b.locationId)) throw new GenerateError(`Pattern B: office ${b.locationId} is not in locations.csv`);
    if (b.unanswered < 0 || b.booked < 0 || notBooked < 0) throw new GenerateError(`Pattern B: unanswered (${b.unanswered}) plus booked (${b.booked}) must fit within calls (${b.calls})`);
    if (b.unanswered > 0 && unansweredPool.length === 0) throw new GenerateError('Pattern B: no unanswered calls to copy');
    if (b.booked > 0 && bookedPool.length === 0) throw new GenerateError('Pattern B: no booked calls with revenue to copy');
    if (notBooked > 0 && notBookedPool.length === 0) throw new GenerateError('Pattern B: no answered, not booked calls to copy');
    const plan: Row[][] = [
      ...Array.from({ length: b.unanswered }, () => unansweredPool),
      ...Array.from({ length: b.booked }, () => bookedPool),
      ...Array.from({ length: notBooked }, () => notBookedPool),
    ];
    for (const pool of plan) {
      const template = pick(pool);
      const startMs = shiftedStart(template);
      synthetic.push({ ...clone(template, startMs), location_id: b.locationId });
    }
  }

  // Patterns C and D: one campaign's calls added to one window, using that campaign's own calls as templates.
  // Windows are offsets from the last call: "recent" is the last windowDays days (not counting the margin day
  // at the end), "earlier" is the windowDays days before it.
  const recent = { from: last - (config.windowDays - 1) * DAY, to: last - DAY };
  const earlier = { from: last - (2 * config.windowDays - 1) * DAY, to: last - config.windowDays * DAY };
  const plantInWindow = (name: string, block: ExtendedConfig['campaignSurge'], window: { from: number; to: number }): void => {
    if (block.calls <= 0) return;
    if (!campaigns.some((c) => c.campaign_id === block.campaignId)) throw new GenerateError(`${name}: campaign ${block.campaignId} is not in campaigns.csv`);
    const notBooked = block.calls - block.unanswered - block.booked;
    if (block.unanswered < 0 || block.booked < 0 || notBooked < 0) throw new GenerateError(`${name}: unanswered (${block.unanswered}) plus booked (${block.booked}) must fit within calls (${block.calls})`);
    if (last - first < 2 * config.windowDays * DAY) throw new GenerateError(`${name}: the data span is under ${2 * config.windowDays} days, so two ${config.windowDays}-DAY windows do not fit`);
    const own = attributed.filter((r) => r.campaign_id === block.campaignId);
    const ownUnanswered = own.filter((r) => r.answered === 'false');
    const ownBooked = own.filter((r) => r.outcome === 'booked' && Number(r.revenue_usd) > 0);
    const ownNotBooked = own.filter((r) => r.answered === 'true' && (r.outcome === 'qualified_lead' || r.outcome === 'not_qualified'));
    if (block.unanswered > 0 && ownUnanswered.length === 0) throw new GenerateError(`${name}: ${block.campaignId} has no unanswered calls to copy`);
    if (block.booked > 0 && ownBooked.length === 0) throw new GenerateError(`${name}: ${block.campaignId} has no booked calls with revenue to copy`);
    if (notBooked > 0 && ownNotBooked.length === 0) throw new GenerateError(`${name}: ${block.campaignId} has no answered, not booked calls to copy`);
    const plan: Row[][] = [
      ...Array.from({ length: block.unanswered }, () => ownUnanswered),
      ...Array.from({ length: block.booked }, () => ownBooked),
      ...Array.from({ length: notBooked }, () => ownNotBooked),
    ];
    for (const pool of plan) {
      const template = pick(pool);
      synthetic.push(clone(template, shiftedStart(template, window.from, window.to)));
    }
  };
  plantInWindow('Pattern C', config.campaignSurge, recent);
  plantInWindow('Pattern D', config.campaignFade, earlier);

  // Unattributed: copies of real unattributed calls, so the set of unattributed tracking numbers does not grow.
  // Pending ones are left out of the pool so this group does not change the pending count.
  const unattributedPool = templates.filter((r) => (r.campaign_id ?? '') === '' && !isPending(r));
  if (config.unattributedCalls > 0 && unattributedPool.length === 0) throw new GenerateError('No unattributed templates: no real call has an empty campaign_id');
  for (let i = 0; i < config.unattributedCalls; i++) {
    const template = pick(unattributedPool);
    synthetic.push(clone(template, shiftedStart(template)));
  }

  // Pending: answered, no outcome yet, one row each. Attributed only, so this group does not change the unattributed count.
  const pendingPool = attributed.filter(isPending);
  if (config.pendingCalls > 0 && pendingPool.length === 0) throw new GenerateError('No pending templates: no real attributed call is answered with an empty outcome');
  for (let i = 0; i < config.pendingCalls; i++) {
    const template = pick(pendingPool);
    synthetic.push(clone(template, shiftedStart(template)));
  }

  // Duplicated: the first row has no outcome yet; a later row (1 to 47 hours on) fills it in; threeRowCalls of
  // them get a third identical row (1 to 24 hours on). The last update is so within 71 hours (+30 s) of the call's end.
  if (config.threeRowCalls < 0 || config.threeRowCalls > config.duplicatedCalls) {
    throw new GenerateError(`threeRowCalls (${config.threeRowCalls}) must be between 0 and duplicatedCalls (${config.duplicatedCalls})`);
  }
  const duplicablePool = attributed.filter((r) => r.answered === 'true' && (r.outcome ?? '') !== '');
  if (config.duplicatedCalls > 0 && duplicablePool.length === 0) throw new GenerateError('No duplicate templates: no real attributed call is answered with an outcome');
  for (let i = 0; i < config.duplicatedCalls; i++) {
    const template = pick(duplicablePool);
    const finished = clone(template, shiftedStart(template));
    const firstRow = { ...finished, outcome: '', revenue_usd: '' };
    const secondRow = { ...finished, updated_at: toIso(Date.parse(finished.updated_at ?? '') + randInt(rng, 1, 47) * HOUR) };
    synthetic.push(firstRow, secondRow);
    if (i < config.threeRowCalls) {
      synthetic.push({ ...secondRow, updated_at: toIso(Date.parse(secondRow.updated_at ?? '') + randInt(rng, 1, 24) * HOUR) });
    }
  }

  // All synthetic rows go after the original text, oldest update first.
  synthetic.sort((x, y) => (x.updated_at ?? '').localeCompare(y.updated_at ?? '') || (x.call_id ?? '').localeCompare(y.call_id ?? ''));
  return input.calls + synthetic.map((row) => serialise(header, row) + '\r\n').join('');
}
