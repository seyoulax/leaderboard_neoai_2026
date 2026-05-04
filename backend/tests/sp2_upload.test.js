import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFilename } from '../src/upload/safeFilename.js';

test('safeFilename: keeps allowed chars', () => {
  assert.equal(safeFilename('train.csv'), 'train.csv');
  assert.equal(safeFilename('My-File_2.json'), 'My-File_2.json');
});

test('safeFilename: replaces unsafe chars with _', () => {
  assert.equal(safeFilename('foo bar baz!.csv'), 'foo_bar_baz_.csv');
  assert.equal(safeFilename('../../etc/passwd'), '_.._etc_passwd');
});

test('safeFilename: caps to 80 bytes preserving extension', () => {
  const long = 'a'.repeat(200) + '.csv';
  const out = safeFilename(long);
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith('.csv'));
});

test('safeFilename: empty input → "file"', () => {
  assert.equal(safeFilename(''), 'file');
  assert.equal(safeFilename('   '), 'file');
});

import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acceptSingleFile } from '../src/upload/multipartFile.js';

function makeUploadApp(opts) {
  const app = express();
  app.post('/upload', (req, res) => {
    acceptSingleFile(req, res, {
      maxBytes: opts.maxBytes,
      destDir: opts.destDir,
      makeFinalName: (info) => `${Date.now()}-${info.filename}`,
      onAccepted: ({ size, sha256, finalPath, originalFilename }) => {
        res.json({ size, sha256, finalPath, originalFilename });
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  });
  return app;
}

async function postFile(port, content) {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`http://127.0.0.1:${port}/upload`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

test('multipart: happy path — file written, sha256 + size correct', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const app = makeUploadApp({ maxBytes: 1024, destDir: dest });
  const server = app.listen(0);
  const port = server.address().port;
  const r = await postFile(port, 'hello\n');
  const json = await r.json();
  assert.equal(json.size, 6);
  assert.equal(json.sha256, '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
  assert.ok(fs.existsSync(json.finalPath));
  assert.equal(fs.readFileSync(json.finalPath, 'utf8'), 'hello\n');
  server.close();
  fs.rmSync(dest, { recursive: true });
});

test('multipart: oversize — 413 + tmp cleaned', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const app = makeUploadApp({ maxBytes: 5, destDir: dest });
  const server = app.listen(0);
  const port = server.address().port;
  const r = await postFile(port, '0123456789');
  assert.equal(r.status, 413);
  const left = fs.readdirSync(dest);
  assert.deepEqual(left.filter((f) => !f.startsWith('.')), []);
  server.close();
  fs.rmSync(dest, { recursive: true });
});
