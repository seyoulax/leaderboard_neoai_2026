// Persistence + SSE subscriber registry for the results-reveal ceremony.

import fs from 'node:fs/promises';
import path from 'node:path';
import { initialState } from '../results.js';

const STATE_FILENAME = 'results-reveal.json';
const CSV_FILENAME = 'results-final.csv';

export function makeResultsStore({ getCompetitionDir }) {
  // slug → { state, subscribers: Set<(state)=>void>, mutex: Promise }
  const cache = new Map();

  async function ensureLoaded(slug) {
    if (cache.has(slug)) return cache.get(slug);
    const entry = { state: null, subscribers: new Set(), mutex: Promise.resolve() };
    cache.set(slug, entry);
    entry.state = await loadFromDisk(slug);
    return entry;
  }

  async function loadFromDisk(slug) {
    const file = path.join(getCompetitionDir(slug), STATE_FILENAME);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.version === 1) return parsed;
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[results] failed to load state for ${slug}: ${e.message}`);
    }
    return initialState();
  }

  async function persist(slug, state) {
    const dir = getCompetitionDir(slug);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, STATE_FILENAME);
    const body = JSON.stringify(state, null, 2) + '\n';
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, file);
  }

  async function removeAll(slug) {
    const dir = getCompetitionDir(slug);
    for (const name of [STATE_FILENAME, CSV_FILENAME]) {
      try { await fs.unlink(path.join(dir, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }

  async function saveCsvText(slug, text) {
    const dir = getCompetitionDir(slug);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, CSV_FILENAME);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
  }

  async function getState(slug) {
    const e = await ensureLoaded(slug);
    return e.state;
  }

  // Run `fn(currentState)` under a per-slug mutex. fn returns the next state.
  // Persists on change and notifies subscribers.
  async function update(slug, fn) {
    const entry = await ensureLoaded(slug);
    const next = entry.mutex.then(async () => {
      const out = await fn(entry.state);
      if (out && out !== entry.state) {
        entry.state = out;
        await persist(slug, out);
        notify(slug, out);
      }
      return entry.state;
    }).catch((err) => { throw err; });
    entry.mutex = next.catch(() => {});
    return next;
  }

  function subscribe(slug, fn) {
    const entry = cache.get(slug);
    if (!entry) {
      // Lazy init without await: caller will await getState() first usually,
      // but just in case, create a subscriber-only entry.
      const newE = { state: null, subscribers: new Set([fn]), mutex: Promise.resolve() };
      cache.set(slug, newE);
      ensureLoaded(slug).then((e) => fn(e.state)).catch(() => {});
      return () => newE.subscribers.delete(fn);
    }
    entry.subscribers.add(fn);
    return () => entry.subscribers.delete(fn);
  }

  function notify(slug, state) {
    const entry = cache.get(slug);
    if (!entry) return;
    for (const fn of entry.subscribers) {
      try { fn(state); } catch (e) { console.warn(`[results] subscriber threw: ${e.message}`); }
    }
  }

  async function reset(slug) {
    await removeAll(slug);
    const entry = await ensureLoaded(slug);
    entry.state = initialState();
    notify(slug, entry.state);
  }

  return {
    getState,
    update,
    saveCsvText,
    removeAll,
    reset,
    subscribe,
  };
}
