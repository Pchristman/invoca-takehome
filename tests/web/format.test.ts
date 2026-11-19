import { afterEach, describe, expect, it } from 'vitest';
import {
  BLANK,
  formatDateSpan,
  formatLongDate,
  formatShortDate,
  formatSkippedRows,
  formatSpendUsd,
  humanize,
} from '../../src/web/format';

describe('dates', () => {
  it('formats long dates', () => {
    expect(formatLongDate('2026-10-29')).toBe('Oct 29, 2026');
    expect(formatLongDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatLongDate('2026-12-31')).toBe('Dec 31, 2026');
    expect(formatLongDate('2028-02-29')).toBe('Feb 29, 2028');
  });

  it('formats short dates', () => {
    expect(formatShortDate('2026-09-01')).toBe('Sep 1');
  });
});

describe("the viewer's time zone cannot move a date", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // A deliberately local-time reading of the same day: if it does not differ
  // between zones, changing TZ did not take effect and the test below proves nothing.
  const localMidnight = () => new Date(2026, 0, 1).getTime();

  it('really changes the zone in this Node', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const east = localMidnight();
    process.env.TZ = 'Pacific/Pago_Pago';
    const west = localMidnight();
    expect(east).not.toBe(west);
  });

  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago']) {
    it(`gives the same text in ${tz}`, () => {
      process.env.TZ = tz;
      expect(formatLongDate('2026-01-01')).toBe('Jan 1, 2026');
      expect(formatShortDate('2026-03-08')).toBe('Mar 8');
    });
  }
});

describe('spans', () => {
  it('shows the year once within a year', () => {
    expect(formatDateSpan('2026-09-01', '2026-09-14')).toBe('Sep 1 – Sep 14, 2026');
  });

  it('shows both years across years', () => {
    expect(formatDateSpan('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('shows one date when start equals end', () => {
    expect(formatDateSpan('2026-09-01', '2026-09-01')).toBe('Sep 1, 2026');
  });
});

describe('bad input is returned unchanged', () => {
  for (const bad of ['banana', '', '2026-13-45', '2026-9-1']) {
    it(`"${bad}"`, () => {
      expect(formatLongDate(bad)).toBe(bad);
      expect(formatShortDate(bad)).toBe(bad);
      expect(() => formatDateSpan(bad, bad)).not.toThrow();
      expect(() => formatDateSpan(bad, '2026-09-01')).not.toThrow();
      expect(() => formatDateSpan('2026-09-01', bad)).not.toThrow();
    });
  }
});

describe('skipped rows', () => {
  it('says nothing for zero and pluralizes otherwise', () => {
    expect(formatSkippedRows(0)).toBeNull();
    expect(formatSkippedRows(1)).toBe('1 row skipped');
    expect(formatSkippedRows(12)).toBe('12 rows skipped');
    expect(formatSkippedRows(1204)).toBe('1,204 rows skipped');
  });
});

describe('humanize', () => {
  it('turns enum values into labels', () => {
    expect(humanize('paid_search')).toBe('Paid search');
    expect(humanize('social')).toBe('Social');
    expect(humanize('qualified_lead')).toBe('Qualified lead');
  });

  it('gives the blank for null and empty', () => {
    expect(humanize(null)).toBe(BLANK);
    expect(humanize('')).toBe(BLANK);
  });
});

describe('formatSpendUsd', () => {
  it('always shows four decimals', () => {
    expect(formatSpendUsd(0)).toBe('$0.0000');
    expect(formatSpendUsd(0.0012)).toBe('$0.0012');
    expect(formatSpendUsd(12.5)).toBe('$12.5000');
  });
});
