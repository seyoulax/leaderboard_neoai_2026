function normalizeWithAnchors(entries, baseline, author) {
  const denominator = author - baseline;
  return entries.map((entry) => {
    const raw = ((entry.score - baseline) / denominator) * 100;
    const points = Math.max(0, raw);
    return {  
      participantKey: entry.participantKey,
      nickname: entry.nickname,
      teamName: entry.teamName,
      rank: entry.rank,
      score: entry.score,
      points: Number(points.toFixed(6)),
    };
  });
}

function normalizeTaskScores(entries, higherIsBetter, baselineScore, authorScore) {
  if (entries.length === 0) {
    return [];
  }

  if (Number.isFinite(baselineScore) && Number.isFinite(authorScore) && baselineScore !== authorScore) {
    return normalizeWithAnchors(entries, baselineScore, authorScore);
  }

  const rankedEntries = entries.filter((entry) => Number.isFinite(entry.rank) && entry.rank > 0);
  const sourceEntries = rankedEntries.length > 0 ? rankedEntries : entries;

  // By product rule: normalization anchors are rank=1 and last rank.
  // This also avoids technical rows such as baseline entries with rank=0.
  const sortedByRank = sourceEntries
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank);

  if (sortedByRank.length > 1) {
    const topScore = sortedByRank[0].score;
    const lastScore = sortedByRank[sortedByRank.length - 1].score;
    const denominator = topScore - lastScore;

    return sourceEntries.map((entry) => {
      const points = denominator === 0 ? 100 : ((entry.score - lastScore) / denominator) * 100;

      return {
        participantKey: entry.participantKey,
        nickname: entry.nickname,
        teamName: entry.teamName,
        rank: entry.rank,
        score: entry.score,
        points: Number(points.toFixed(6)),
      };
    });
  }

  const transformed = sourceEntries.map((entry) => ({
    ...entry,
    transformedScore: higherIsBetter ? entry.score : -entry.score,
  }));

  const top = Math.max(...transformed.map((e) => e.transformedScore));
  const last = Math.min(...transformed.map((e) => e.transformedScore));
  const denominator = top - last;

  return transformed.map((entry) => {
    const points = denominator === 0 ? 100 : ((entry.transformedScore - last) / denominator) * 100;

    return {
      participantKey: entry.participantKey,
      nickname: entry.nickname,
      teamName: entry.teamName,
      rank: entry.rank,
      score: entry.score,
      points: Number(points.toFixed(6)),
    };
  });
}

export function buildLeaderboards(tasksWithRows) {
  const byTask = {};
  const teams = new Map();

  for (const task of tasksWithRows) {
    const normalized = normalizeTaskScores(
      task.rows,
      task.higherIsBetter,
      task.baselineScore,
      task.authorScore
    );

    byTask[task.slug] = {
      slug: task.slug,
      title: task.title,
      competition: task.competition,
      higherIsBetter: task.higherIsBetter,
      baselineScore: task.baselineScore,
      authorScore: task.authorScore,
      updatedAt: task.updatedAt,
      entries: normalized
        .sort((a, b) => {
          const ar = Number.isFinite(a.rank) && a.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
          const br = Number.isFinite(b.rank) && b.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
          if (ar !== br) return ar - br;
          if (a.points !== b.points) return b.points - a.points;
          return (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '');
        })
        .map((entry, i) => ({
          place: i + 1,
          ...entry,
        })),
    };

    for (const entry of normalized) {
      const participantKey = entry.participantKey || entry.nickname || entry.teamName || 'unknown-participant';

      if (!teams.has(participantKey)) {
        teams.set(participantKey, {
          participantKey,
          nickname: entry.nickname,
          teamName: entry.teamName,
          totalPoints: 0,
          tasks: {},
        });
      }

      const team = teams.get(participantKey);
      team.totalPoints += entry.points;
      if (!team.nickname && entry.nickname) {
        team.nickname = entry.nickname;
      }
      if (!team.teamName && entry.teamName) {
        team.teamName = entry.teamName;
      }
      team.tasks[task.slug] = {
        score: entry.score,
        points: entry.points,
      };
    }
  }

  const overall = Array.from(teams.values())
    .map((team) => ({
      ...team,
      totalPoints: Number(team.totalPoints.toFixed(6)),
    }))
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((team, i) => ({
      place: i + 1,
      ...team,
    }));

  return {
    overall,
    byTask,
  };
}
