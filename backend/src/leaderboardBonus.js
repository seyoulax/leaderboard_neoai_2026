// Parse multiplier input like "2/3", "0.5", "1.25", "" (= 1), invalid → 1.
export function parseMultiplier(input) {
  if (input === null || input === undefined) return 1;
  const s = String(input).trim();
  if (!s) return 1;
  const m = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 1;
    return num / den;
  }
  const dec = Number(s);
  return Number.isFinite(dec) ? dec : 1;
}

// Mutates each overall row to expose:
//   tasksPoints           — raw sum across tasks (no multiplier, no bonus)
//   multipliedTasksPoints — tasksPoints * multiplier (always exposed)
//   bonusPoints           — preserved (unchanged); 0 by default
//   totalPoints           — multipliedTasksPoints + (bonus if includeBonus)
//   previousTotalPoints   — adjusted with same formula
// Then re-sorts by totalPoints DESC and re-assigns place.
export function applyMultiplierAndBonus(overall, multiplierInput, includeBonus) {
  if (!Array.isArray(overall)) return overall;
  const k = parseMultiplier(multiplierInput);
  for (const row of overall) {
    const rawTasks = Number(row.totalPoints) || 0;
    const bonus = Number(row.bonusPoints) || 0;
    const prevRawTasks = row.previousTotalPoints != null ? (Number(row.previousTotalPoints) || 0) : null;

    row.tasksPoints = Number(rawTasks.toFixed(6));
    row.multipliedTasksPoints = Number((rawTasks * k).toFixed(6));
    row.totalPoints = Number((rawTasks * k + (includeBonus ? bonus : 0)).toFixed(6));

    if (prevRawTasks != null) {
      row.previousTotalPoints = Number((prevRawTasks * k + (includeBonus ? bonus : 0)).toFixed(6));
    }
  }
  overall.sort((a, b) => (Number(b.totalPoints) || 0) - (Number(a.totalPoints) || 0));
  overall.forEach((r, i) => { r.place = i + 1; });
  return overall;
}

// Legacy name kept for any old callers — no multiplier, bonus added.
export function applyBonusToOverall(overall) {
  return applyMultiplierAndBonus(overall, '', true);
}
