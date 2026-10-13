import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, localToUtc, addDays, diffDays, monthBounds, weekdayOf } from '../../src/lib/dates.ts';
import { estimate1RM } from '../../src/modules/training.ts';

test('fecha local de Lima cerca de medianoche UTC', () => {
  // 02:00 UTC del 11 = 21:00 del 10 en Lima
  assert.equal(localDate('2026-03-11T02:00:00Z', 'America/Lima'), '2026-03-10');
});

test('hora local a UTC respeta el offset (incluye zonas con horario de verano)', () => {
  assert.equal(localToUtc('2026-03-10', '19:00', 'America/Lima').toISOString(), '2026-03-11T00:00:00.000Z');
  assert.equal(localToUtc('2026-07-01', '08:00', 'Europe/Madrid').toISOString(), '2026-07-01T06:00:00.000Z');
});

test('aritmética de calendario', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(diffDays('2026-03-01', '2026-03-31'), 30);
  assert.deepEqual(monthBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(weekdayOf('2026-03-15'), 7);
});

test('1RM estimado (Epley)', () => {
  assert.equal(estimate1RM(100, 1), 100);
  assert.equal(estimate1RM(100, 5), 116.7);
  assert.equal(estimate1RM(0, 10), 0);
});
