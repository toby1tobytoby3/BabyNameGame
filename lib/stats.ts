/**
 * The two tests the taste card rests on.
 *
 * Both are deliberately small and dependency-free: the point is not statistical
 * sophistication, it is having a defensible reason to show a sentence at all.
 * A claim about someone's taste that turns out to be noise is worse than no
 * claim, so every finding has to clear one of these before it can be phrased.
 */

export interface Sample {
  n: number;
  mean: number;
  /** Sample standard deviation (n − 1). */
  sd: number;
}

export function summarise(values: number[]): Sample {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean, sd: 0 };
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { n, mean, sd: Math.sqrt(variance) };
}

/**
 * Welch's t for two independent samples.
 *
 * Welch rather than Student because the two groups are never the same size
 * here — 91 likes against 568 passes — and pooling their variances would
 * quietly overstate confidence.
 */
export function welchT(a: Sample, b: Sample): number {
  if (a.n < 2 || b.n < 2) return 0;
  const se = Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n);
  if (se === 0) return 0;
  return (a.mean - b.mean) / se;
}

/** Two-proportion z. Returns 0 when either group is empty or both are flat. */
export function proportionZ(
  countA: number,
  totalA: number,
  countB: number,
  totalB: number,
): number {
  if (totalA === 0 || totalB === 0) return 0;
  const pA = countA / totalA;
  const pB = countB / totalB;
  const pooled = (countA + countB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (se === 0) return 0;
  return (pA - pB) / se;
}

/**
 * How close a value sits to a target, 0–1, on a gaussian falling off with the
 * spread of the thing being matched. The floor on sd stops a preference that
 * happens to be very consistent from rejecting everything a hair outside it.
 */
export function closeness(value: number, target: Sample, minSd: number): number {
  const sd = Math.max(target.sd, minSd);
  return Math.exp(-((value - target.mean) ** 2) / (2 * sd ** 2));
}
