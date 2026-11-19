// Builds the extended export: the shipped calls untouched, plus synthetic calls that plant patterns.
// A one-off tool, not part of the app. It imports nothing from src/ (Node cannot resolve src's
// extensionless imports). Output depends only on (input text, config, seed): own PRNG, no clock.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
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

/** 'YYYY-MM-DD' plus a number of days (negative for before). */
const addDays = (date: string, days: number): string => toIso(Date.parse(`${date}T00:00:00Z`) + days * DAY).slice(0, 10);

/**
 * Every whole-week shift of a start time that lands in [lo, hi] (milliseconds) and passes `accept`, as new
 * start times. The weekday and the UTC time of day are kept (across a DST change the office's local hour
 * can move by an hour). Empty when none fits.
 */
function weekShifts(startMs: number, lo: number, hi: number, accept: (ms: number) => boolean): number[] {
  const shifts: number[] = [];
  for (let k = Math.ceil((lo - startMs) / WEEK); k <= Math.floor((hi - startMs) / WEEK); k++) {
    if (accept(startMs + k * WEEK)) shifts.push(startMs + k * WEEK);
  }
  return shifts;
}

const whole = (n: number): boolean => Number.isInteger(n) && n >= 0;

/** Stop on a config the generator cannot honour, naming the setting. */
function checkConfig(c: ExtendedConfig): void {
  const counts: [string, number][] = [
    ['plainCalls', c.plainCalls],
    ['unattributedCalls', c.unattributedCalls],
    ['pendingCalls', c.pendingCalls],
    ['duplicatedCalls', c.duplicatedCalls],
    ['threeRowCalls', c.threeRowCalls],
    ['officeAnswerDrop.calls', c.officeAnswerDrop.calls],
    ['officeAnswerDrop.answered', c.officeAnswerDrop.answered],
    ['officeLowConversion.calls', c.officeLowConversion.calls],
    ['officeLowConversion.unanswered', c.officeLowConversion.unanswered],
    ['officeLowConversion.booked', c.officeLowConversion.booked],
    ['campaignSurge.calls', c.campaignSurge.calls],
    ['campaignSurge.unanswered', c.campaignSurge.unanswered],
    ['campaignSurge.booked', c.campaignSurge.booked],
    ['campaignFade.calls', c.campaignFade.calls],
    ['campaignFade.unanswered', c.campaignFade.unanswered],
    ['campaignFade.booked', c.campaignFade.booked],
  ];
  for (const [name, value] of counts) if (!whole(value)) throw new GenerateError(`${name} must be a whole number, 0 or more (got ${value})`);
  if (!Number.isInteger(c.windowDays) || c.windowDays < 7) throw new GenerateError(`windowDays must be a whole number, 7 or more (got ${c.windowDays})`);
  const { weekdays, hours } = c.officeAnswerDrop;
  if (!(Number.isInteger(weekdays.from) && Number.isInteger(weekdays.to) && weekdays.from >= 0 && weekdays.to <= 6 && weekdays.from <= weekdays.to)) {
    throw new GenerateError(`Pattern A: the weekday window ${weekdays.from} to ${weekdays.to} is empty or outside 0 (Monday) to 6 (Sunday)`);
  }
  if (!(Number.isInteger(hours.from) && Number.isInteger(hours.to) && hours.from >= 0 && hours.to <= 23 && hours.from <= hours.to)) {
    throw new GenerateError(`Pattern A: the hour window ${hours.from} to ${hours.to} is empty or outside 0 to 23`);
  }
}

/** One Intl formatter per zone, built once. A zone name Node does not know stops the run with its name. */
function zoneFormats(timeZone: string) {
  try {
    const clock = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
    const date = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return { clock, date };
  } catch {
    throw new GenerateError(`Unknown time zone "${timeZone}" in locations.csv`);
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_ATTEMPTS = 100_000;

/** How a text file ends its lines: all CRLF or all LF. A mix would make the output differ by machine. */
function lineEnding(text: string): '\r\n' | '\n' {
  const lf = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (lf === crlf) return '\r\n'; // all CRLF, or no line breaks at all
  if (crlf === 0) return '\n';
  throw new GenerateError('calls.csv mixes CRLF and LF line endings; make them all one or the other');
}

function readCalls(text: string): { header: string[]; rows: Row[] } {
  let header: string[] = [];
  const rows = parse(text, {
    bom: true,
    columns: (h: string[]) => {
      header = h;
      return h;
    },
    skip_empty_lines: true,
  }) as Row[];
  return { header, rows };
}

/**
 * The final state of each real call: the row with the latest updated_at per call_id. On a tie the later row
 * in the file wins, and a row whose updated_at cannot be read loses, as in data rule 2.
 */
function finalStates(rows: Row[]): Row[] {
  const rank = (r: Row): number => {
    const t = Date.parse(r.updated_at ?? '');
    return Number.isNaN(t) ? -Infinity : t;
  };
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const id = row.call_id ?? '';
    const have = latest.get(id);
    if (!have || rank(row) >= rank(have)) latest.set(id, row);
  }
  return [...latest.values()];
}

/**
 * The longest gap, in whole days (rounded up), between a call starting and the last row that changed its
 * outcome or revenue. The same idea as the app's outcome lag; the generator keeps its own copies short of it.
 */
function outcomeLagDays(rows: Row[], finals: Row[]): number {
  const startOf = new Map(finals.map((r) => [r.call_id ?? '', Date.parse(r.started_at ?? '')]));
  const byCall = new Map<string, Row[]>();
  for (const row of rows) {
    if (Number.isNaN(Date.parse(row.updated_at ?? ''))) continue;
    byCall.set(row.call_id ?? '', [...(byCall.get(row.call_id ?? '') ?? []), row]);
  }
  let longest = 0;
  for (const [id, group] of byCall) {
    const sorted = [...group].sort((x, y) => Date.parse(x.updated_at ?? '') - Date.parse(y.updated_at ?? ''));
    for (let i = 1; i < sorted.length; i++) {
      const row = sorted[i] as Row;
      const before = sorted[i - 1] as Row;
      if (row.outcome !== before.outcome || row.revenue_usd !== before.revenue_usd) {
        longest = Math.max(longest, Date.parse(row.updated_at ?? '') - (startOf.get(id) ?? NaN));
      }
    }
  }
  return Math.ceil(longest / DAY);
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
  checkConfig(config);
  const eol = lineEnding(input.calls);
  const rng = makeRng(config.seed);
  // A second generator for details that do not decide which rows exist (caller reuse, agents), so changing
  // them never moves the main stream and with it every other row.
  const decor = makeRng((config.seed ^ 0x9e3779b9) >>> 0);
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

  const locations = parse(input.locations, { bom: true, columns: true, skip_empty_lines: true }) as Row[];
  const campaigns = parse(input.campaigns, { bom: true, columns: true, skip_empty_lines: true }) as Row[];
  const formats = new Map(locations.map((l) => [l.location_id ?? '', zoneFormats(l.timezone ?? '')]));
  const knownCampaigns = new Set(campaigns.map((c) => c.campaign_id));

  // Templates: final-state real calls with a readable start at a known office and a known (or no) campaign,
  // so a copy is never itself a bad row.
  const finals = finalStates(rows);
  const templates = finals.filter(
    (r) =>
      !Number.isNaN(Date.parse(r.started_at ?? '')) &&
      formats.has(r.location_id ?? '') &&
      ((r.campaign_id ?? '') === '' || knownCampaigns.has(r.campaign_id)),
  );
  const synthetic: Row[] = [];

  /** The office-local date ('YYYY-MM-DD') of an instant at an office. */
  const localDateAt = (locationId: string, ms: number): string => {
    const parts = (formats.get(locationId) as ReturnType<typeof zoneFormats>).date.formatToParts(new Date(ms));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };

  // Callers: a clone reuses its template's caller at the share the data's own calls show (calls per distinct
  // caller), so the extended data keeps repeat callers instead of making every synthetic caller new.
  const hashes = templates.map((r) => r.caller_number_hash ?? '').filter((h) => h !== '');
  const repeatShare = hashes.length === 0 ? 0 : 1 - new Set(hashes).size / hashes.length;

  // Agents work at one office, so a call moved to another office gets one of that office's agents.
  const agentsByOffice = new Map<string, string[]>();
  for (const r of templates) {
    const agent = r.agent_id ?? '';
    const list = agentsByOffice.get(r.location_id ?? '') ?? [];
    if (agent !== '' && !list.includes(agent)) agentsByOffice.set(r.location_id ?? '', [...list, agent]);
  }
  const atOffice = (row: Row, locationId: string): Row => {
    const agents = agentsByOffice.get(locationId) ?? [];
    const agent = (row.agent_id ?? '') !== '' && agents.length > 0 ? (agents[randInt(decor, 0, agents.length - 1)] as string) : row.agent_id ?? '';
    return { ...row, location_id: locationId, agent_id: agent };
  };

  /** A copy of `template` starting at `startMs`, with new id, caller hash and timestamps. */
  const clone = (template: Row, startMs: number): Row => {
    const duration = Number(template.duration_seconds);
    const endMs = startMs + duration * SECOND;
    const newHash = `h_x${randInt(rng, 0, 0xfffffff).toString(16).padStart(7, '0')}`; // always drawn: keeps the stream steady
    const reuse = decor() < repeatShare && (template.caller_number_hash ?? '') !== '';
    return {
      ...template,
      call_id: newId(),
      started_at: toIso(startMs),
      ended_at: toIso(endMs),
      caller_number_hash: reuse ? (template.caller_number_hash as string) : newHash,
      updated_at: toIso(endMs + randInt(rng, 5, 30) * SECOND),
    };
  };

  /** A start for a copy of `template`, whole weeks away, inside the span margin (and `accept`, if given). */
  const shiftedStart = (template: Row, from = lo, to = hi, accept: (ms: number) => boolean = () => true): number => {
    const options = weekShifts(Date.parse(template.started_at ?? ''), from, to, accept);
    if (options.length === 0) throw new GenerateError(`The data span is too short to place a copy of call ${template.call_id}`);
    return options[randInt(rng, 0, options.length - 1)] as number;
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
    if (!formats.has(a.locationId)) throw new GenerateError(`Pattern A: office ${a.locationId} is not in locations.csv`);
    if (a.answered > a.calls) throw new GenerateError(`Pattern A: answered (${a.answered}) must be between 0 and calls (${a.calls})`);
    if (a.calls - a.answered > 0 && unansweredPool.length === 0) throw new GenerateError('Pattern A: no unanswered calls to copy');
    if (a.answered > 0 && bookedPool.length === 0) throw new GenerateError('Pattern A: no booked calls with revenue to copy');
    const clockFormat = (formats.get(a.locationId) as ReturnType<typeof zoneFormats>).clock;
    const inWindow = (ms: number): boolean => {
      const parts = clockFormat.formatToParts(new Date(ms));
      const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
      const hour = Number(parts.find((p) => p.type === 'hour')?.value);
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
      synthetic.push(atOffice(clone(template, startMs), a.locationId));
    }
  }

  // Pattern B: an office with a normal answer rate but few bookings. Week-shifted clones, any campaign.
  const b = config.officeLowConversion;
  if (b.calls > 0) {
    const notBooked = b.calls - b.unanswered - b.booked;
    if (!formats.has(b.locationId)) throw new GenerateError(`Pattern B: office ${b.locationId} is not in locations.csv`);
    if (notBooked < 0) throw new GenerateError(`Pattern B: unanswered (${b.unanswered}) plus booked (${b.booked}) must fit within calls (${b.calls})`);
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
      synthetic.push(atOffice(clone(template, startMs), b.locationId));
    }
  }

  // Patterns C and D: one campaign's calls added to one window, using that campaign's own calls as templates.
  // The app filters by each office's local date, so the windows are local dates counted back from the data's
  // last local date: "recent" is the last windowDays days (not counting that last day itself), "earlier" is the
  // windowDays days before it. A copy is kept only if its local date, at its own office, is inside the window.
  const lastLocalDate = templates.map((r) => localDateAt(r.location_id ?? '', Date.parse(r.started_at ?? ''))).sort().at(-1) ?? '';
  const recent = { from: addDays(lastLocalDate, -(config.windowDays - 1)), to: addDays(lastLocalDate, -1) };
  const earlier = { from: addDays(lastLocalDate, -(2 * config.windowDays - 1)), to: addDays(lastLocalDate, -config.windowDays) };
  const plantInWindow = (name: string, block: ExtendedConfig['campaignSurge'], window: { from: string; to: string }): void => {
    if (block.calls <= 0) return;
    if (!knownCampaigns.has(block.campaignId)) throw new GenerateError(`${name}: campaign ${block.campaignId} is not in campaigns.csv`);
    const notBooked = block.calls - block.unanswered - block.booked;
    if (notBooked < 0) throw new GenerateError(`${name}: unanswered (${block.unanswered}) plus booked (${block.booked}) must fit within calls (${block.calls})`);
    if (last - first < 2 * config.windowDays * DAY) throw new GenerateError(`${name}: the data span is under ${2 * config.windowDays} days, so two ${config.windowDays}-day windows do not fit`);
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
      const inWindow = (ms: number): boolean => {
        const date = localDateAt(template.location_id ?? '', ms);
        return date >= window.from && date <= window.to;
      };
      // UTC bounds first (the same days as the local window, give or take a day), then the local-date check.
      const from = Date.parse(`${window.from}T00:00:00Z`) - DAY;
      const to = Date.parse(`${window.to}T00:00:00Z`) + 2 * DAY;
      synthetic.push(clone(template, shiftedStart(template, Math.max(lo, from), Math.min(hi, to), inWindow)));
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

  // Duplicated: the first row has no outcome yet; a later row (1 to 47 hours on, never later than the data's own
  // outcome lag allows) fills it in; threeRowCalls of them get a third identical row (1 to 24 hours on). The third
  // row changes nothing, so the outcome lag the app measures comes from the second row alone.
  if (config.threeRowCalls > config.duplicatedCalls) {
    throw new GenerateError(`threeRowCalls (${config.threeRowCalls}) must be between 0 and duplicatedCalls (${config.duplicatedCalls})`);
  }
  const duplicablePool = attributed.filter((r) => r.answered === 'true' && (r.outcome ?? '') !== '');
  if (config.duplicatedCalls > 0 && duplicablePool.length === 0) throw new GenerateError('No duplicate templates: no real attributed call is answered with an outcome');
  const lagMs = config.duplicatedCalls > 0 ? outcomeLagDays(rows, finals) * DAY : 0;
  for (let i = 0; i < config.duplicatedCalls; i++) {
    const template = pick(duplicablePool);
    const finished = clone(template, shiftedStart(template));
    // The second row's lag from the call start is its duration + up to 30 s + the delay; keep that within the data's lag.
    const room = Math.floor((lagMs - Number(template.duration_seconds) * SECOND - 30 * SECOND) / HOUR);
    if (room < 1) throw new GenerateError(`The data's outcome lag (${lagMs / DAY} days) leaves no room to add a later row to call ${template.call_id}`);
    const firstRow = { ...finished, outcome: '', revenue_usd: '' };
    const secondRow = { ...finished, updated_at: toIso(Date.parse(finished.updated_at ?? '') + randInt(rng, 1, Math.min(47, room)) * HOUR) };
    synthetic.push(firstRow, secondRow);
    if (i < config.threeRowCalls) {
      synthetic.push({ ...secondRow, updated_at: toIso(Date.parse(secondRow.updated_at ?? '') + randInt(rng, 1, 24) * HOUR) });
    }
  }

  // All synthetic rows go after the original text, oldest update first, with the input's own line ending.
  synthetic.sort((x, y) => (x.updated_at ?? '').localeCompare(y.updated_at ?? '') || (x.call_id ?? '').localeCompare(y.call_id ?? ''));
  const base = input.calls.endsWith(eol) ? input.calls : input.calls + eol;
  return base + synthetic.map((row) => serialise(header, row) + eol).join('');
}

/** Read fromDir/{calls,campaigns,locations}.csv; write toDir/calls.csv (generated) and byte copies of the other two. */
export function writeExtended(fromDir: string, toDir: string, config: Partial<ExtendedConfig> = {}): void {
  if (resolve(fromDir) === resolve(toDir)) throw new GenerateError('The output folder must not be the input folder: the original export stays untouched');
  const read = (file: string): string => {
    try {
      return readFileSync(join(fromDir, file), 'utf8');
    } catch {
      throw new GenerateError(`Cannot read ${join(fromDir, file)}`);
    }
  };
  const generated = generateExtendedCalls({ calls: read('calls.csv'), campaigns: read('campaigns.csv'), locations: read('locations.csv') }, config);
  mkdirSync(toDir, { recursive: true });
  writeFileSync(join(toDir, 'calls.csv'), generated);
  copyFileSync(join(fromDir, 'campaigns.csv'), join(toDir, 'campaigns.csv'));
  copyFileSync(join(fromDir, 'locations.csv'), join(toDir, 'locations.csv'));
}

// Command line: node scripts/generate-extended.ts [fromDir=. [toDir=data/extended]]
if (import.meta.main) {
  const [fromDir = '.', toDir = 'data/extended'] = process.argv.slice(2);
  try {
    writeExtended(fromDir, toDir);
    console.log(`Wrote the extended export to ${toDir}`);
  } catch (error) {
    if (error instanceof GenerateError) {
      console.error(`Could not generate the extended export: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
