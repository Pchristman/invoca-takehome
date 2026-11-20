import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanExport } from '../../src/core/clean';
import { readExportFromDir } from '../../src/node/readDataDir';
import { createApp } from '../../src/server/app';

const ROOT = join(__dirname, '..', '..');
const EXPORTS = [join(ROOT, 'tests', 'fixtures', 'original-export'), join(ROOT, 'data', 'extended')];
const PATHS = [
  '/api/meta',
  '/api/overview?range=all',
  '/api/campaigns?range=all',
  '/api/locations?range=all',
  '/api/missed-calls?range=all',
  '/api/missed-calls/callbacks.csv?range=all',
];

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** Rebuild the store from each export under the given process time zone and collect every response body as text. */
async function bodiesUnder(zone: string): Promise<string[]> {
  process.env.TZ = zone;
  const bodies: string[] = [];
  for (const dir of EXPORTS) {
    const app = createApp(cleanExport(readExportFromDir(dir)), { webRoot: join(ROOT, 'dist') });
    for (const path of PATHS) {
      const response = await app.request(path);
      bodies.push(`${dir} ${path} ${response.status}\n${await response.text()}`);
    }
  }
  return bodies;
}

describe('process time zone independence', () => {
  it('the process time zone really changed (so the comparison below is not vacuous)', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    expect(new Date(Date.UTC(2026, 0, 1, 12)).getDate()).toBe(2); // UTC+14: noon UTC is 02:00 the next day
    process.env.TZ = 'UTC';
    expect(new Date(Date.UTC(2026, 0, 1, 12)).getDate()).toBe(1);
  });

  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Phoenix'])(
    'every endpoint returns the same bytes under TZ=%s as under TZ=UTC, on both exports',
    async (zone) => {
      const utc = await bodiesUnder('UTC');
      expect(utc.every((body) => / 200\n/.test(body.split('\n')[0] + '\n'))).toBe(true);
      expect(await bodiesUnder(zone)).toEqual(utc);
    },
  );
});
