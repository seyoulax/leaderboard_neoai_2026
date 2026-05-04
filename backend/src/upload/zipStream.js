import archiver from 'archiver';

export function streamZip(files, res, basename) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${basename}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.destroy(err));
  archive.pipe(res);
  for (const f of files) {
    archive.file(f.path, { name: f.originalFilename });
  }
  archive.finalize();
}
