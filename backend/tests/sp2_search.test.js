import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /api/competitions: filters by visibility, supports q', async () => {
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug: 'neoai-2026', title: 'NEOAI 2026', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'kf', title: 'Kaggle Forces', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'priv', title: 'Private', type: 'native', visibility: 'unlisted' });
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const all = await fetch(`http://127.0.0.1:${port}/api/competitions`).then((r) => r.json());
  assert.deepEqual(all.competitions.map((c) => c.slug).sort(), ['kf', 'neoai-2026']);
  const search = await fetch(`http://127.0.0.1:${port}/api/competitions?q=neo`).then((r) => r.json());
  assert.deepEqual(search.competitions.map((c) => c.slug), ['neoai-2026']);
  server.close();
});
