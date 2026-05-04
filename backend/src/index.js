import dotenv from 'dotenv';
import path from 'node:path';
import { createApp, refreshAll, DATA_DIR } from './app.js';
import { migrate } from './migrate.js';
import { getDb } from './db/index.js';
import { migrateCompetitionsJsonToDb } from './dataMigration/competitionsJsonToDb.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import { cleanupExpired } from './db/sessionsRepo.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);

process.env.DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.db');
const db = getDb();

const app = createApp({ db });

app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  try {
    const compMig = migrateCompetitionsJsonToDb({ db, dataDir: DATA_DIR });
    if (compMig.migrated) {
      console.log(`[migrate-db] competitions.json → DB (${compMig.count} rows), backup: ${compMig.backupFile}`);
    }
    const admin = await bootstrapAdmin({
      db,
      email: process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    });
    if (admin.created) console.log(`[bootstrap] admin created: id=${admin.userId}`);
    else if (admin.promoted) console.log(`[bootstrap] existing user promoted to admin: id=${admin.userId}`);
    const result = await migrate(DATA_DIR);
    if (result.migrated) {
      console.log(`[migrate] OK: legacy → ${result.competitionSlug}, backup: ${result.backupDir}`);
    }
  } catch (e) {
    console.error('[startup] migration FAILED', e);
  }
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  setInterval(() => {
    try { cleanupExpired(db); } catch (e) { console.error('[sessions] cleanup failed', e); }
  }, 60 * 60 * 1000);
});
