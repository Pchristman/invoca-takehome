// The automated half of Phase 8's done-when: the real builders on the shipped and the extended export,
// through JSON, into the screen models.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { dataSpan } from '../../src/core/ranges';
import type { CallStore } from '../../src/core/types';
import { readExportFromDir } from '../../src/node/readDataDir';
import { DEFAULT_LOCATION_SORT, locationsModel } from '../../src/web/models/locationsModel';
import { heatmapModel } from '../../src/web/models/heatmapModel';
import { CALLBACK_PAGE_SIZE, missedCallsModel } from '../../src/web/models/missedCallsModel';
import { actionHref, parseUrlState } from '../../src/web/urlState';
import { locationsFor, missedCallsFor } from './fixtures';

const ROOT = join(__dirname, '..', '..');
const shipped = cleanExport(readExportFromDir(join(ROOT, 'tests', 'fixtures', 'original-export')));
const extended = cleanExport(readExportFromDir(join(ROOT, 'data', 'extended')));

const BAD = /Infinity|NaN|undefined/;

function screens(store: CallStore, location?: string) {
  const span = dataSpan(store.calls)!;
  const locations = locationsFor('range=all', store);
  const missed = missedCallsFor(location ? `range=all&location=${location}` : 'range=all', store);
  return {
    locations,
    missed,
    locationsModel: locationsModel(locations, DEFAULT_LOCATION_SORT),
    missedModel: missedCallsModel(missed, span),
  };
}

describe('shipped export', () => {
  const s = screens(shipped);

  it('flags no office and says nothing stands out', () => {
    expect(s.locations.rows.every((r) => !r.answerFlag.flagged && !r.bookingFlag.flagged)).toBe(true);
    expect(s.locationsModel.rows.every((r) => r.flags.length === 0)).toBe(true);
    expect(s.locationsModel.action.kind).toBe('no_office_stands_out');
    expect(s.locationsModel.action.linkLabel).toBe('See Missed calls');
  });

  it('lists the first 25 callbacks and the pager total is the API row count', () => {
    const total = s.missed.callbacks.rows.length;
    expect(total).toBeGreaterThan(CALLBACK_PAGE_SIZE);
    expect(s.missedModel.callbacks.rows).toHaveLength(CALLBACK_PAGE_SIZE);
    expect(s.missedModel.callbacks.pager!.label).toContain(`Rows 1–25 of ${total.toLocaleString('en-US')}`);
    expect(s.missedModel.callbacks.canDownload).toBe(true);
  });

  it('prints no Infinity, NaN or undefined', () => {
    expect(JSON.stringify([s.locationsModel, s.missedModel])).not.toMatch(BAD);
  });
});

describe('extended export', () => {
  const s = screens(extended);

  it('plants exactly the four flags', () => {
    const found = s.locations.rows.flatMap((r) =>
      (['answer', 'booking'] as const)
        .filter((m) => r[`${m}Flag`].flagged)
        .map((m) => `${r.locationId} ${m} ${r[`${m}Flag`].direction}`),
    );
    expect(new Set(found)).toEqual(
      new Set(['loc_02 booking worse', 'loc_04 booking better', 'loc_06 answer worse', 'loc_08 answer better']),
    );
    const fromModel = s.locationsModel.rows.flatMap((r) => r.flags.map((f) => `${r.id} ${f.metric} ${f.direction}`));
    expect(new Set(fromModel)).toEqual(new Set(found));
  });

  it('links the action to Missed calls for loc_06', () => {
    expect(s.locationsModel.action.link.locationId).toBe('loc_06');
    const state = parseUrlState('?range=all');
    expect(actionHref(state, s.locationsModel.action.link)).toBe('/?view=missed-calls&range=all&location=loc_06');
  });

  it('filters Missed calls to loc_06: named office, one heatmap row, some missed calls', () => {
    const f = screens(extended, 'loc_06');
    const name = f.missed.heatmap.byOffice[0]!.name;
    expect(f.missedModel.filterLabel).toBe(`Showing ${name} only.`);
    expect(heatmapModel(f.missed.heatmap, 'office').rows).toHaveLength(1);
    expect(f.missedModel.noMissed).toBeNull();
    expect(JSON.stringify([f.locationsModel, f.missedModel])).not.toMatch(BAD);
  });

  it('prints no Infinity, NaN or undefined', () => {
    expect(JSON.stringify([s.locationsModel, s.missedModel])).not.toMatch(BAD);
  });
});
