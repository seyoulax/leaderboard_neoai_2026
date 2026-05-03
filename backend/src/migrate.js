import fs from 'node:fs/promises';
import path from 'node:path';
import { saveCompetitions } from './competitions.js';

const LEGACY_FILES = ['tasks.json', 'boards.json', 'participants.json'];
const NEOAI_SLUG = 'neoai-2026';
const NEOAI_TITLE = 'NEOAI 2026';
const NEOAI_SUBTITLE = 'Northern Eurasia Olympiad in Artificial Intelligence 2026';

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function moveIfExists(src, dst) {
  if (!(await exists(src))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return true;
}

async function copyIfExists(src, dst) {
  if (!(await exists(src))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

export async function migrate(dataDir) {
  const indexPath = path.join(dataDir, 'competitions.json');

  if (await exists(indexPath)) {
    return { migrated: false, reason: 'competitions.json already exists' };
  }

  const hasLegacy = (await Promise.all(
    LEGACY_FILES.map((f) => exists(path.join(dataDir, f)))
  )).some(Boolean);

  if (!hasLegacy) {
    await fs.mkdir(dataDir, { recursive: true });
    await saveCompetitions(indexPath, []);
    return { migrated: false, reason: 'no legacy files; created empty index' };
  }

  // Snapshot.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `_legacy-backup-${ts}`);
  await fs.mkdir(backupDir, { recursive: true });
  for (const f of LEGACY_FILES) {
    await copyIfExists(path.join(dataDir, f), path.join(backupDir, f));
  }
  const legacyPrivateDir = path.join(dataDir, 'private');
  if (await exists(legacyPrivateDir)) {
    const entries = await fs.readdir(legacyPrivateDir);
    for (const e of entries) {
      const src = path.join(legacyPrivateDir, e);
      const stat = await fs.stat(src);
      if (stat.isFile()) {
        await fs.copyFile(src, path.join(backupDir, e));
      }
    }
  }

  // Move legacy → competitions/<slug>/.
  const compDir = path.join(dataDir, 'competitions', NEOAI_SLUG);
  await fs.mkdir(compDir, { recursive: true });
  for (const f of LEGACY_FILES) {
    await moveIfExists(path.join(dataDir, f), path.join(compDir, f));
  }

  // Move private/*.csv → private/<slug>/*.csv.
  if (await exists(legacyPrivateDir)) {
    const entries = await fs.readdir(legacyPrivateDir);
    const newPrivateDir = path.join(legacyPrivateDir, NEOAI_SLUG);
    for (const e of entries) {
      const src = path.join(legacyPrivateDir, e);
      const stat = await fs.stat(src);
      if (stat.isFile() && e.endsWith('.csv')) {
        await fs.mkdir(newPrivateDir, { recursive: true });
        await fs.rename(src, path.join(newPrivateDir, e));
      }
    }
  }

  await saveCompetitions(indexPath, [{
    slug: NEOAI_SLUG,
    title: NEOAI_TITLE,
    subtitle: NEOAI_SUBTITLE,
    order: 0,
    visible: true,
  }]);

  return { migrated: true, competitionSlug: NEOAI_SLUG, backupDir };
}
