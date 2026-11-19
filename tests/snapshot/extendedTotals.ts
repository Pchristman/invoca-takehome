// Known totals of the committed extended export (data/extended). Shared so the file-level test and the
// server test pin the same numbers. Observed on the committed seed, recorded not derived. If a generator
// change moves one of these, look at why.
export const EXTENDED_TOTALS = {
  calls: 6400,
  bookings: 1470,
  revenueUsd: 531431,
  // The shipped export has 2,040 distinct callers in 5,000 calls; copies reuse real callers at that same share.
  uniqueCallers: 2605,
  // Best and worst campaign by revenue per budget dollar over all data: the same as in the original export.
  bestWorst: { best: 'cmp_11', worst: 'cmp_07' },
  // cmp_04 / cmp_06 calls in the last 28 days against the 28 before.
  surge: { current: 342, previous: 218 },
  fade: { current: 113, previous: 261 },
};
