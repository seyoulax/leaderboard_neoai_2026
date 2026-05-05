// Mutates each row in the given overall array: adds bonusPoints to totalPoints,
// adds bonusPoints to previousTotalPoints (when not null), then re-sorts the
// array by new totalPoints DESC and re-assigns sequential `place` (1-based).
//
// Used by both native and kaggle leaderboard endpoints when
// state.overallShowBonusPoints === true. Caller is responsible for not mutating
// shared cache entries (clone first if needed).
export function applyBonusToOverall(overall) {
  if (!Array.isArray(overall)) return overall;
  for (const row of overall) {
    const bonus = Number(row?.bonusPoints) || 0;
    if (bonus === 0) continue;
    row.totalPoints = (Number(row.totalPoints) || 0) + bonus;
    if (row.previousTotalPoints != null) {
      row.previousTotalPoints = (Number(row.previousTotalPoints) || 0) + bonus;
    }
  }
  overall.sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));
  overall.forEach((r, i) => { r.place = i + 1; });
  return overall;
}
