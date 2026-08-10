/**
 * Efraimidis–Spirakis weighted sampling without replacement.
 *
 * Assigns each item key = U^(1/w) for U ~ Uniform(0,1) and sorts descending.
 * The resulting order is a genuine weighted-random permutation, so slicing the
 * first n gives an unbiased weighted sample of size n — and the tail is a
 * ready-made source of top-up candidates.
 *
 * This is what keeps the queue fresh. Taking the top n *by score* would return
 * the same names forever; this returns high-scoring names more often while
 * leaving everything reachable.
 */
export function weightedOrder<T>(items: T[], weight: (item: T) => number): T[] {
  return items
    .map((item) => {
      const w = Math.max(weight(item), 1e-9);
      return { item, key: Math.pow(Math.random(), 1 / w) };
    })
    .sort((a, b) => b.key - a.key)
    .map((k) => k.item);
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
