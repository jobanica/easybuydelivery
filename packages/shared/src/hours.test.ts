import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHm, isOpenNow, formatHm, scheduleLabel } from './hours.ts';

test('parseHm parses HH:MM and HH:MM:SS', () => {
  assert.equal(parseHm('09:00'), 540);
  assert.equal(parseHm('21:30:00'), 1290);
  assert.equal(parseHm(null), null);
  assert.equal(parseHm('bad'), null);
  assert.equal(parseHm('25:00'), null);
});

test('no schedule means always open', () => {
  assert.equal(isOpenNow(null, null), true);
  assert.equal(isOpenNow('09:00', null), true);
});

test('same-day window', () => {
  // 09:00–21:00 at a fixed instant: 2020-01-01T05:00:00Z = 13:00 Manila (open)
  assert.equal(isOpenNow('09:00', '21:00', new Date('2020-01-01T05:00:00Z')), true);
  // 2020-01-01T00:00:00Z = 08:00 Manila (before open)
  assert.equal(isOpenNow('09:00', '21:00', new Date('2020-01-01T00:00:00Z')), false);
  // 2020-01-01T14:00:00Z = 22:00 Manila (after close)
  assert.equal(isOpenNow('09:00', '21:00', new Date('2020-01-01T14:00:00Z')), false);
});

test('overnight window crosses midnight', () => {
  // 18:00–02:00; 2020-01-01T18:00:00Z = 02:00 next day Manila -> closed at 02:00 (exclusive)
  assert.equal(isOpenNow('18:00', '02:00', new Date('2020-01-01T17:00:00Z')), true);  // 01:00 Manila
  assert.equal(isOpenNow('18:00', '02:00', new Date('2020-01-01T12:00:00Z')), true);  // 20:00 Manila
  assert.equal(isOpenNow('18:00', '02:00', new Date('2020-01-01T06:00:00Z')), false); // 14:00 Manila
});

test('formatHm and scheduleLabel', () => {
  assert.equal(formatHm('09:00'), '9:00 AM');
  assert.equal(formatHm('21:05'), '9:05 PM');
  assert.equal(formatHm('00:00'), '12:00 AM');
  assert.equal(scheduleLabel('09:00', '21:00'), '9:00 AM – 9:00 PM');
  assert.equal(scheduleLabel(null, null), 'Open 24 hours');
});
