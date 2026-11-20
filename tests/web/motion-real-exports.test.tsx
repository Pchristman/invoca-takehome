// S5 done-when: "no view's numbers or actions change". Each of the four views, drawn from the real view builders
// on both real exports (the shipped one and the extended one), reads the same with motion on and with motion off.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { formatCount, formatRate, formatUsd } from '../../src/core/views/format';
import { readExportFromDir } from '../../src/node/readDataDir';
import { CampaignsView } from '../../src/web/components/CampaignsView';
import { LocationsView } from '../../src/web/components/LocationsView';
import { MissedCallsView } from '../../src/web/components/MissedCallsView';
import { OverviewView } from '../../src/web/components/OverviewView';
import { MOTION_OFF } from '../../src/web/models/motionSettings';
import type { MotionSettings } from '../../src/web/models/motionSettings';
import { MotionContext } from '../../src/web/useMotion';
import { parseUrlState } from '../../src/web/urlState';
import { campaignsFor, locationsFor, metaFor, missedCallsFor, overviewFor } from './fixtures';

const ROOT = join(__dirname, '..', '..');
const EXTENDED_DIR = join(ROOT, 'data', 'extended');

const ON: MotionSettings = { enabled: true, fast: 0.15, base: 0.2, slow: 0.3, ease: [0.2, 0, 0, 1] };

/** Visible text: style attributes ignored, tags stripped. */
const text = (html: string) => html.replace(/ style="[^"]*"/g, '').replace(/<[^>]*>/g, '');
const render = (motion: MotionSettings, node: ReactNode) =>
  renderToStaticMarkup(<MotionContext value={motion}>{node}</MotionContext>);

const BAD = /NaN|Infinity|undefined/;
const noop = () => {};
const SEARCH = 'range=last28';

const exports = [
  { name: 'shipped', dir: join(ROOT, 'tests', 'fixtures', 'original-export') },
  { name: 'extended', dir: EXTENDED_DIR },
];

describe.each(exports)('motion on and off on the $name export', ({ dir }) => {
  // Skip the way a missing extended export is skipped elsewhere: no data, no test, no failure.
  const present = existsSync(dir);
  const run = present ? it : it.skip;
  const store = present ? cleanExport(readExportFromDir(dir)) : null;

  function views() {
    const s = store!;
    const meta = metaFor(s);
    const span = meta.span!;
    const state = parseUrlState(`?${SEARCH}`);
    const overview = overviewFor(SEARCH, s);
    const campaigns = campaignsFor(SEARCH, s);
    const locations = locationsFor(SEARCH, s);
    const missed = missedCallsFor(SEARCH, s);
    return {
      overview,
      list: [
        { name: 'Overview', node: <OverviewView view={overview} state={state} span={span} /> },
        { name: 'Campaigns', node: <CampaignsView view={campaigns} state={state} span={span} onSelectCampaign={noop} /> },
        { name: 'Locations', node: <LocationsView view={locations} state={state} span={span} /> },
        {
          name: 'Missed calls',
          node: <MissedCallsView view={missed} state={state} span={span} offices={meta.locations} onSelectOffice={noop} />,
        },
      ],
    };
  }

  run('every view reads the same with motion on and off, with no NaN, Infinity or undefined', () => {
    for (const { name, node } of views().list) {
      const on = text(render(ON, node));
      const off = text(render(MOTION_OFF, node));
      expect(on.length, name).toBeGreaterThan(50); // a real page, not an empty render
      expect(on, name).toBe(off);
      expect(on, name).not.toMatch(BAD);
    }
  });

  run('the Overview contains every tile exact value, with motion on and off', () => {
    const { overview, list } = views();
    const node = list[0]!.node;
    // Expected strings come from the raw export numbers and the core formatters, not from the web model.
    const raw = overview.tiles;
    const expected = [
      formatCount(raw.calls.current!),
      formatCount(raw.uniqueCallers.current!),
      formatRate(raw.answerRate.current!),
      formatCount(raw.bookings.current!),
      formatUsd(raw.revenueUsd.current!),
    ];
    for (const motion of [ON, MOTION_OFF]) {
      const out = text(render(motion, node));
      for (const value of expected) expect(out).toContain(value);
    }
  });
});
