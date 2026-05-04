import fs from 'node:fs';
import path from 'node:path';
import { validateCompetitions } from '../competitions.js';
import {
  insertCompetition,
  listActiveCompetitions,
} from '../db/competitionsRepo.js';

export function migrateCompetitionsJsonToDb({ db, dataDir }) {
  if (listActiveCompetitions(db).length > 0) {
    return { migrated: false, reason: 'db not empty' };
  }
  const file = path.join(dataDir, 'competitions.json');
  if (!fs.existsSync(file)) {
    return { migrated: false, reason: 'no legacy file' };
  }

  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const validated = validateCompetitions(parsed);

  db.transaction(() => {
    for (const c of validated) {
      insertCompetition(db, {
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle ?? null,
        type: 'kaggle',
        visible: c.visible !== false,
        displayOrder: Number.isFinite(c.order) ? c.order : 0,
      });
    }
  })();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `_legacy-backup-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'competitions.json');
  fs.copyFileSync(file, backupFile);
  fs.rmSync(file);

  return { migrated: true, count: validated.length, backupFile };
}
