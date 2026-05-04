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
