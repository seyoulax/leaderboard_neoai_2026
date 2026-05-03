import dotenv from 'dotenv';
import { createApp, refreshAll, DATA_DIR } from './app.js';
import { migrate } from './migrate.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);

const app = createApp();

app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  try {
    const result = await migrate(DATA_DIR);
    if (result.migrated) {
      console.log(`[migrate] OK: legacy → ${result.competitionSlug}, backup: ${result.backupDir}`);
    }
  } catch (e) {
    console.error('[migrate] FAILED', e);
  }
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
});
