const COLS = `id,
  task_id AS taskId,
  kind,
  display_name AS displayName,
  description,
  original_filename AS originalFilename,
  size_bytes AS sizeBytes,
  sha256,
  path,
  display_order AS displayOrder,
  uploaded_at AS uploadedAt`;

export function insertPendingFile(db, f) {
  const result = db
    .prepare(
      `INSERT INTO native_task_files (
        task_id, kind, display_name, description,
        original_filename, size_bytes, sha256, path, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`
    )
    .run(
      f.taskId,
      f.kind,
      f.displayName,
      f.description ?? '',
      f.originalFilename,
      f.sizeBytes,
      f.sha256,
      Number.isFinite(f.displayOrder) ? f.displayOrder : 0
    );
  return getFileById(db, result.lastInsertRowid);
}

export function commitFilePath(db, id, finalPath) {
  db.prepare('UPDATE native_task_files SET path = ? WHERE id = ?').run(finalPath, id);
}

export function getFileById(db, id) {
  return db.prepare(`SELECT ${COLS} FROM native_task_files WHERE id = ?`).get(id) || null;
}

export function listFilesByTask(db, taskId, kind = null) {
  if (kind) {
    return db
      .prepare(`SELECT ${COLS} FROM native_task_files WHERE task_id = ? AND kind = ? ORDER BY display_order, id`)
      .all(taskId, kind);
  }
  return db
    .prepare(`SELECT ${COLS} FROM native_task_files WHERE task_id = ? ORDER BY kind, display_order, id`)
    .all(taskId);
}

export function deleteFileById(db, id) {
  db.prepare('DELETE FROM native_task_files WHERE id = ?').run(id);
}

const META_UPDATABLE = {
  displayName: 'display_name',
  description: 'description',
  displayOrder: 'display_order',
};

export function updateFileMetadata(db, id, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(META_UPDATABLE)) {
    if (!(k in patch)) continue;
    sets.push(`${col} = ?`);
    vals.push(patch[k]);
  }
  if (!sets.length) return getFileById(db, id);
  vals.push(id);
  db.prepare(`UPDATE native_task_files SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getFileById(db, id);
}
