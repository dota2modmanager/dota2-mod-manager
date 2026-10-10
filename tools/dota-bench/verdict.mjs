/**
 * Whether a hero swings through its attacks, read from how much each picture of the bench's burst
 * differs from the next (tools/dota-bench/burst.ps1). A swing moves the whole body every 80 ms; a
 * hero standing still while its hits land changes only around the dummy and the damage numbers.
 *
 * Measured on 17 bursts of issue #118 whose answer was known: the median difference was 14.1 to 20.1
 * for every build that swung (the plain hero, the catalog's Crimson arcana, the fixed build) and
 * 5.3 to 8.1 for every one that stood still. An idle fidget moves a few pictures in a row, which the
 * median does not take for a swing: that fidget was once taken for the attack by eye.
 */
export const SWING = 11;

/** The median of the differences, and whether that is a swing. */
export function attackVerdict(diffs) {
  const sorted = [...diffs].filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  if (sorted.length < 4) return { median: null, swings: null };
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median: Math.round(median * 100) / 100, swings: median >= SWING };
}

/** The differences from burst.ps1's output, its "diffs:" line. */
export function readDiffs(output) {
  const line = String(output).split(/\r?\n/).find((l) => l.startsWith('diffs:'));
  return line ? line.slice(6).trim().split(/\s+/).map(Number) : [];
}
