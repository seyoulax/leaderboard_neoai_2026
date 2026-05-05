export function makeSnapshotCache() {
  const snapshots = new Map();

  function annotate(slug, fresh) {
    const previous = snapshots.get(slug) || null;
    const annotated = annotateWithPrevious(fresh, previous);
    snapshots.set(slug, structuredClone(annotated));
    return annotated;
  }

  function get(slug) {
    return snapshots.get(slug) || null;
  }

  function clear(slug) {
    if (slug) snapshots.delete(slug);
    else snapshots.clear();
  }

  return { annotate, get, clear };
}

function annotateWithPrevious(fresh, previous) {
  const out = structuredClone(fresh);
  const prevTotalByKey = new Map();
  const prevTaskPointsByKey = new Map();

  if (previous) {
    for (const e of previous.overall || []) {
      if (e.participantKey) prevTotalByKey.set(e.participantKey, e.totalPoints);
    }
    for (const slug of Object.keys(previous.byTask || {})) {
      for (const e of previous.byTask[slug]?.entries || []) {
        if (e.participantKey) prevTaskPointsByKey.set(`${slug}|${e.participantKey}`, e.points);
      }
    }
  }

  for (const e of out.overall || []) {
    e.previousTotalPoints = prevTotalByKey.has(e.participantKey)
      ? prevTotalByKey.get(e.participantKey) : null;
    if (e.tasks) {
      for (const slug of Object.keys(e.tasks)) {
        const prev = prevTaskPointsByKey.get(`${slug}|${e.participantKey}`);
        e.tasks[slug].previousPoints = prev !== undefined ? prev : null;
      }
    }
  }
  for (const slug of Object.keys(out.byTask || {})) {
    for (const e of out.byTask[slug]?.entries || []) {
      const prev = prevTaskPointsByKey.get(`${slug}|${e.participantKey}`);
      e.previousPoints = prev !== undefined ? prev : null;
    }
  }
  return out;
}
