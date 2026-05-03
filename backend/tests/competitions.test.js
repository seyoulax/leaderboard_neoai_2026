import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompetitions } from '../src/competitions.js';

test('validateCompetitions: minimal valid entry', () => {
  const out = validateCompetitions([{ slug: 'neoai-2026', title: 'NEOAI 2026' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'neoai-2026');
  assert.equal(out[0].title, 'NEOAI 2026');
  assert.equal(out[0].order, 0);
  assert.equal(out[0].visible, true);
  assert.equal(out[0].subtitle, undefined);
});

test('validateCompetitions: rejects empty slug', () => {
  assert.throws(
    () => validateCompetitions([{ slug: '', title: 'x' }]),
    /slug/i
  );
});

test('validateCompetitions: rejects bad slug pattern', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'NEOAI 2026', title: 'x' }]),
    /slug/i
  );
});

test('validateCompetitions: rejects deny-listed slug', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'admin', title: 'x' }]),
    /reserved/i
  );
});

test('validateCompetitions: rejects duplicate slug', () => {
  assert.throws(
    () => validateCompetitions([
      { slug: 'a', title: 'A' },
      { slug: 'a', title: 'B' },
    ]),
    /duplicate/i
  );
});

test('validateCompetitions: rejects missing title', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'a' }]),
    /title/i
  );
});

test('validateCompetitions: defaults order=0 and visible=true', () => {
  const out = validateCompetitions([{ slug: 'a', title: 'A' }]);
  assert.equal(out[0].order, 0);
  assert.equal(out[0].visible, true);
});

test('validateCompetitions: keeps subtitle when provided', () => {
  const out = validateCompetitions([{ slug: 'a', title: 'A', subtitle: 's' }]);
  assert.equal(out[0].subtitle, 's');
});
