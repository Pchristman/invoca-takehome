import { describe, expect, it } from 'vitest';
import { readUpload } from '../../../src/db/upload/detect';
import { planReferenceUpload } from '../../../src/db/upload/planReference';
import { campaignLine, count, locationLine } from '../helpers';
import { csvOf, seeded } from './helpers';

const CAMPAIGN_HEADER = 'campaign_id,name,channel,daily_budget_usd';
const LOCATION_HEADER = 'location_id,name,timezone';

const campaigns = (lines: string[]) => readUpload('campaigns.csv', csvOf(CAMPAIGN_HEADER, lines));
const locations = (lines: string[]) => readUpload('locations.csv', csvOf(LOCATION_HEADER, lines));
const plan = (lines: string[]) => planReferenceUpload(seeded(), campaigns(lines));
const planLoc = (lines: string[]) => planReferenceUpload(seeded(), locations(lines));
const counts = (c: Partial<Record<string, number>>) => ({
  rowsRead: 0, newRows: 0, newVersions: 0, duplicates: 0, conflicts: 0, bad: 0, ...c,
});

describe('planReferenceUpload: campaigns', () => {
  it('a campaign with a blank budget is a new row with no budget; an unreadable budget is a bad row', () => {
    const p = plan(['cmp_c,Gamma,paid_search,', 'cmp_d,Delta,social,$150.00']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 2, newRows: 1, bad: 1 }));
    expect(p.preview.badByReason).toEqual({ bad_budget: 1 });
    expect(p.kind === 'campaigns' && p.campaigns).toEqual([
      { id: 'cmp_c', name: 'Gamma', channel: 'paid_search', dailyBudgetUsd: null },
    ]);
  });

  it('a stored budget against a blank one is a conflict that says blank', () => {
    const p = plan(['cmp_a,Alpha,social,']);
    expect(p.preview.examples.conflict[0]?.note).toBe('budget is 100 in the database, blank in this file');
  });

  it('a new campaign is a new row', () => {
    const p = plan(['cmp_c,Gamma,paid_search,75']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 1, newRows: 1 }));
    expect(p.kind === 'campaigns' && p.campaigns).toEqual([
      { id: 'cmp_c', name: 'Gamma', channel: 'paid_search', dailyBudgetUsd: 75 },
    ]);
  });

  it('the same campaign with identical values is a duplicate', () => {
    for (const line of ['cmp_a,Alpha,social,100', 'cmp_a,Alpha,social,100.00', 'cmp_a, Alpha ,social,100']) {
      const p = plan([line]);
      expect(p.preview.counts).toEqual(counts({ rowsRead: 1, duplicates: 1 }));
    }
  });

  it.each([
    ['name', 'cmp_a,Other,social,100', 'name is "Alpha" in the database, "Other" in this file'],
    ['budget', 'cmp_a,Alpha,social,120', 'budget is 100 in the database, 120 in this file'],
    ['channel', 'cmp_a,Alpha,display,100', 'channel is "social" in the database, "display" in this file'],
  ])('the same campaign id with a different %s is a conflict and is not planned', (_field, line, note) => {
    const p = plan([line]);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 1, conflicts: 1 }));
    expect(p.preview.examples.conflict[0]).toEqual({ row: 1, id: 'cmp_a', note });
    expect(p.kind === 'campaigns' && p.campaigns).toEqual([]);
  });

  it('a duplicate inside the file is caught', () => {
    const p = plan(['cmp_c,Gamma,paid_search,75', 'cmp_c,Gamma,paid_search,75']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 2, newRows: 1, duplicates: 1 }));
    expect(p.preview.examples.duplicate[0]!.note).toBe('repeated in this file (row 1)');
    expect(p.kind === 'campaigns' && p.campaigns).toHaveLength(1);
  });

  it('the same new id twice with different values: the first row is new, the second a conflict', () => {
    const p = plan(['cmp_c,Gamma,paid_search,75', 'cmp_c,Gamma,paid_search,80']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 2, newRows: 1, conflicts: 1 }));
    expect(p.preview.examples.conflict[0]!.note).toContain('row 1');
    expect(p.kind === 'campaigns' && p.campaigns.map((c) => c.dailyBudgetUsd)).toEqual([75]);
  });

  it('rows that differ from the stored campaign are each compared with the stored one', () => {
    const p = plan(['cmp_a,Alpha,social,120', 'cmp_a,Alpha,social,130']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 2, conflicts: 2 }));
    expect(p.preview.examples.conflict.map((e) => e.note)).toEqual([
      'budget is 100 in the database, 120 in this file',
      'budget is 100 in the database, 130 in this file',
    ]);
  });

  it('a conflict inside the file names the first row own value', () => {
    const p = plan(['cmp_c,Gamma,paid_search,75', 'cmp_c,Gamma,paid_search,80']);
    expect(p.preview.examples.conflict[0]!.note).toBe('differs from row 1 in this file: budget is 75 in row 1, 80 in this row');
  });

  it('a very long cell is shortened in the bad note and in a quoted value', () => {
    const long = 'q'.repeat(5000);
    const bad = plan([`cmp_x,X,social,${long}`]);
    expect(bad.preview.examples.bad[0]!.note.length).toBeLessThanOrEqual(103);
    const conflict = plan([`cmp_a,${long},social,100`]);
    expect(conflict.preview.examples.conflict[0]!.note.length).toBeLessThan(200);
  });

  it('bad rows are reported by reason and never planned', () => {
    const p = plan([',NoId,social,10', 'cmp_x,X,social,abc', 'cmp_y,Y,social,-5', 'cmp_z,Z,carrier_pigeon,10']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 4, bad: 4 }));
    expect(p.preview.badByReason).toEqual({ empty_id: 1, bad_budget: 2, bad_channel: 1 });
    expect(p.kind === 'campaigns' && p.campaigns).toEqual([]);
    expect(p.preview.examples.bad.map((e) => e.row)).toEqual([1, 2, 3, 4]);
  });

  it('a mixed file adds up', () => {
    const p = plan([
      'cmp_c,Gamma,paid_search,75',
      'cmp_a,Alpha,social,100',
      'cmp_b,Changed,display,50',
      'cmp_d,Delta,abc,1',
    ]);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 4, newRows: 1, duplicates: 1, conflicts: 1, bad: 1 }));
    const c = p.preview.counts;
    expect(c.newRows + c.newVersions + c.duplicates + c.conflicts + c.bad).toBe(c.rowsRead);
  });

  it('examples are capped at 5 per class and carry the file row number', () => {
    const p = plan(Array.from({ length: 8 }, (_, i) => `cmp_n${i},N${i},social,1`));
    expect(p.preview.counts.newRows).toBe(8);
    expect(p.preview.examples.new.map((e) => e.row)).toEqual([1, 2, 3, 4, 5]);
  });

  it('an id with markup, quotes, a comma and a newline is carried through unchanged', () => {
    const id = '<script>"x,y\nz';
    const p = plan([campaignLine(id, 'Odd', 'social', '1')]);
    expect(p.kind === 'campaigns' && p.campaigns[0]!.id).toBe(id);
    expect(p.preview.examples.new[0]!.id).toBe(id);
  });

  it('a long id is shortened in the example only', () => {
    const id = 'x'.repeat(60);
    const p = plan([campaignLine(id, 'Long', 'social', '1')]);
    expect(p.kind === 'campaigns' && p.campaigns[0]!.id).toBe(id);
    expect(p.preview.examples.new[0]!.id).toBe(`${'x'.repeat(40)}...`);
  });

  it('a header-only file is zero rows, nothing planned', () => {
    const p = plan([]);
    expect(p.preview.counts).toEqual(counts({}));
    expect(p.kind === 'campaigns' && p.campaigns).toEqual([]);
  });

  it('it never writes', () => {
    const db = seeded();
    const before = [count(db, 'campaigns'), count(db, 'seeds'), count(db, 'reference_issues')];
    planReferenceUpload(db, campaigns(['cmp_c,Gamma,paid_search,75', 'cmp_x,X,social,abc']));
    expect([count(db, 'campaigns'), count(db, 'seeds'), count(db, 'reference_issues')]).toEqual(before);
  });
});

describe('planReferenceUpload: locations', () => {
  it('a new location is a new row', () => {
    const p = planLoc(['loc_c,Office C,America/Chicago']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 1, newRows: 1 }));
    expect(p.kind === 'locations' && p.locations.map((l) => l.id)).toEqual(['loc_c']);
  });

  it('the same location with identical values is a duplicate; a different name or time zone is a conflict', () => {
    expect(planLoc([locationLine('loc_a', 'Office A', 'America/Phoenix')]).preview.counts).toEqual(
      counts({ rowsRead: 1, duplicates: 1 }),
    );
    const name = planLoc([locationLine('loc_a', 'Renamed', 'America/Phoenix')]);
    expect(name.preview.counts).toEqual(counts({ rowsRead: 1, conflicts: 1 }));
    expect(name.preview.examples.conflict[0]!.note).toContain('name is "Office A" in the database, "Renamed" in this file');
    const zone = planLoc([locationLine('loc_a', 'Office A', 'America/Denver')]);
    expect(zone.preview.counts).toEqual(counts({ rowsRead: 1, conflicts: 1 }));
    expect(zone.preview.examples.conflict[0]!.note).toContain('time zone');
    expect(zone.kind === 'locations' && zone.locations).toEqual([]);
  });

  it('a zone alias that normalises to the stored zone is a duplicate', () => {
    const p = planReferenceUpload(
      seeded({ locations: [locationLine('loc_a', 'Office A', 'America/New_York')] }),
      locations([locationLine('loc_a', 'Office A', 'US/Eastern')]),
    );
    expect(p.preview.counts).toEqual(counts({ rowsRead: 1, duplicates: 1 }));
  });

  it('a location with an invalid time zone is bad, not written', () => {
    const p = planLoc(['loc_m,Mars,Mars/Olympus']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 1, bad: 1 }));
    expect(p.preview.badByReason).toEqual({ invalid_timezone: 1 });
    expect(p.kind === 'locations' && p.locations).toEqual([]);
  });

  it('a repeated id inside the file is a duplicate or a conflict', () => {
    const p = planLoc(['loc_c,C,America/Chicago', 'loc_c,C,America/Chicago', 'loc_c,Other,America/Chicago']);
    expect(p.preview.counts).toEqual(counts({ rowsRead: 3, newRows: 1, duplicates: 1, conflicts: 1 }));
  });
});
