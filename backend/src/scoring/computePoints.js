export function computePoints({ raw, baseline, author, higherIsBetter }) {
  if (baseline == null || author == null || baseline === author) {
    return raw;
  }
  const points = ((raw - baseline) / (author - baseline)) * 100;
  return Math.max(0, points);
}
