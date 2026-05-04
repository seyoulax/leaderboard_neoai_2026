import Busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function acceptSingleFile(req, res, opts) {
  const { maxBytes, destDir, makeFinalName, onAccepted, onError } = opts;
  const bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
  let handled = false;
  let aborted = false;
  let gotFile = false;

  bb.on('file', (name, stream, info) => {
    gotFile = true;
    fs.mkdirSync(destDir, { recursive: true });
    const tmpName = `.tmp-${crypto.randomUUID()}`;
    const tmpPath = path.join(destDir, tmpName);
    const sink = fs.createWriteStream(tmpPath);
    const hash = crypto.createHash('sha256');
    let size = 0;

    stream.on('data', (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    stream.on('limit', () => {
      aborted = true;
      sink.destroy();
      fs.rm(tmpPath, () => {});
      if (handled) return;
      handled = true;
      onError(new Error('file too large'), 413);
    });
    stream.pipe(sink);

    sink.on('finish', () => {
      if (aborted) return;
      const finalName = makeFinalName(info);
      const finalPath = path.join(destDir, finalName);
      fs.rename(tmpPath, finalPath, (err) => {
        if (err) {
          fs.rm(tmpPath, () => {});
          if (handled) return;
          handled = true;
          onError(err, 500);
          return;
        }
        if (handled) return;
        handled = true;
        onAccepted({
          size,
          sha256: hash.digest('hex'),
          finalPath,
          originalFilename: info.filename,
          mimetype: info.mimeType,
        });
      });
    });
    sink.on('error', (err) => {
      if (handled) return;
      handled = true;
      onError(err, 500);
    });
  });

  bb.on('error', (err) => {
    if (handled) return;
    handled = true;
    onError(err, 400);
  });

  bb.on('finish', () => {
    if (!handled && !gotFile) {
      handled = true;
      onError(new Error('no file in request'), 400);
    }
  });

  req.pipe(bb);
}
