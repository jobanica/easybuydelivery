import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { routeDistanceKm, applyRouteDistance, remeasureAfterPinMove } from './routing.ts';

/** A client whose only job is to answer `functions.invoke`. */
function stub(reply: unknown, opts: { error?: unknown; throws?: boolean } = {}) {
  const calls: unknown[] = [];
  const db = {
    functions: {
      invoke: (_name: string, args: { body: unknown }) => {
        calls.push(args.body);
        if (opts.throws) return Promise.reject(new Error('network down'));
        return Promise.resolve({ data: reply, error: opts.error ?? null });
      },
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const shop = { lat: 14.986286, lng: 120.545558 };
const door = { lat: 14.997231, lng: 120.531712 };

test('routeDistanceKm asks for the pins it was given and returns the road distance', async () => {
  const { db, calls } = stub({ routed: true, km: 4.559, by: 'osrm' });
  const res = await routeDistanceKm(db, [shop], door);
  assert.deepEqual(res, { km: 4.559, by: 'osrm' });
  assert.deepEqual(calls, [{ origins: [shop], dropoff: door }]);
});

test('routeDistanceKm drops unusable pins and never asks about nothing', async () => {
  const { db, calls } = stub({ routed: true, km: 3 });
  assert.deepEqual(await routeDistanceKm(db, [null, undefined], door), { km: null, by: null });
  assert.deepEqual(await routeDistanceKm(db, [shop], null), { km: null, by: null });
  assert.deepEqual(await routeDistanceKm(db, [{ lat: NaN, lng: 1 }], door), { km: null, by: null });
  assert.equal(calls.length, 0, 'nothing worth routing should cost a request');
});

test('routeDistanceKm falls back to no answer rather than failing a checkout', async () => {
  for (const s of [
    stub(null, { error: new Error('boom') }),
    stub({ routed: false, reason: 'unrouted' }),
    stub({}),
  ]) {
    assert.deepEqual(await routeDistanceKm(s.db, [shop], door), { km: null, by: null });
  }
});

test('applyRouteDistance passes the order on and reports what the server did', async () => {
  const { db, calls } = stub({ updated: true, km: 4.559, old_fee: 67.97, new_fee: 119.42 });
  const res = await applyRouteDistance(db, 'order-1');
  assert.equal(res.updated, true);
  assert.equal(res.new_fee, 119.42);
  assert.deepEqual(calls, [{ orderId: 'order-1' }]);
});

test('applyRouteDistance swallows a dead network — the pin correction still happened', async () => {
  const { db } = stub(null, { throws: true });
  assert.deepEqual(await applyRouteDistance(db, 'order-1'), { updated: false, reason: 'unavailable' });
});

test('remeasureAfterPinMove replaces the straight-line fee with the measured one', async () => {
  const { db, calls } = stub({ updated: true, km: 4.559, new_fee: 119.42 });
  const res = await remeasureAfterPinMove(db, 'order-1', {
    updated: true, moved_m: 1200, old_fee: 50, new_fee: 81.09,
  });
  assert.equal(res.new_fee, 119.42);
  assert.equal(res.old_fee, 50, 'the fee it replaced is still the one the rider was quoted');
  assert.equal(res.moved_m, 1200, 'the correction’s own account of itself survives');
  assert.deepEqual(calls, [{ orderId: 'order-1' }]);
});

test('remeasureAfterPinMove leaves a correction that did nothing alone', async () => {
  const { db, calls } = stub({ updated: true, new_fee: 119.42 });
  const refused = { updated: false, reason: 'outside_area' as const };
  assert.deepEqual(await remeasureAfterPinMove(db, 'order-1', refused), refused);
  assert.equal(calls.length, 0, 'a pin that did not move has no road to measure');
});

test('remeasureAfterPinMove keeps the straight-line fee when the road cannot be measured', async () => {
  // The important one: an unroutable order must keep the corrected
  // straight-line fee, not fall back to the fee from before the pin moved.
  for (const reply of [
    { updated: false, reason: 'unrouted' },
    { updated: false, reason: 'finished' },
    { updated: true },
  ]) {
    const { db } = stub(reply);
    const res = await remeasureAfterPinMove(db, 'order-1', { updated: true, new_fee: 81.09 });
    assert.equal(res.new_fee, 81.09);
  }
});
