import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addedStores,
  commission,
  storeFeeTotal,
  orderCost,
  distanceDeliveryFee,
  DEFAULT_FEE_CONFIG,
  DEFAULT_DISTANCE_FEE_CONFIG,
  type FeeConfig,
  type DistanceFeeConfig,
} from './pricing.ts';

test('addedStores counts only stores beyond the first', () => {
  assert.equal(addedStores(0), 0);
  assert.equal(addedStores(1), 0);
  assert.equal(addedStores(2), 1);
  assert.equal(addedStores(3), 2);
});

test('locked formula: DF 50 + 3 stores => commission 15', () => {
  // base = 50 + 25*2 = 100 ; 100 * 0.15 = 15
  assert.equal(commission({ deliveryFee: 50, storeCount: 3 }), 15);
});

test('single-store food order: DF 50 => commission 7.5', () => {
  // base = 50 + 25*0 = 50 ; 50 * 0.15 = 7.5
  assert.equal(commission({ deliveryFee: 50, storeCount: 1 }), 7.5);
});

test('padala (delivery fee only, no store): 15% of DF', () => {
  assert.equal(commission({ deliveryFee: 40, storeCount: 0 }), 6);
});

test('storeFeeTotal uses per-store fee for added stores', () => {
  assert.equal(storeFeeTotal(3, DEFAULT_FEE_CONFIG), 50);
  assert.equal(storeFeeTotal(1, DEFAULT_FEE_CONFIG), 0);
});

test('convenience fee pass-through does NOT change commission', () => {
  const config: FeeConfig = {
    ...DEFAULT_FEE_CONFIG,
    convenienceFee: 20,
    convenienceFeeMode: 'pass_through',
  };
  assert.equal(commission({ deliveryFee: 50, storeCount: 3 }, config), 15);
});

test('convenience fee in_base DOES fold into the 15% base', () => {
  const config: FeeConfig = {
    ...DEFAULT_FEE_CONFIG,
    convenienceFee: 20,
    convenienceFeeMode: 'in_base',
  };
  // base = 50 + 50 + 20 = 120 ; 120 * 0.15 = 18
  assert.equal(commission({ deliveryFee: 50, storeCount: 3 }, config), 18);
});

test('editable commission rate is honored', () => {
  const config: FeeConfig = { ...DEFAULT_FEE_CONFIG, commissionRate: 0.2 };
  assert.equal(commission({ deliveryFee: 100, storeCount: 1 }, config), 20);
});

test('orderCost: goods are a pass-through, excluded from commission', () => {
  const b = orderCost({ deliveryFee: 50, storeCount: 3, goodsCost: 500 });
  // customer pays goods + DF + store fees + convenience
  assert.equal(b.customerTotal, 500 + 50 + 50 + 0);
  // commission untouched by the 500 goods cost
  assert.equal(b.commission, 15);
  assert.equal(b.storeFeeTotal, 50);
});

test('orderCost: convenience pass-through is added to customer total', () => {
  const config: FeeConfig = { ...DEFAULT_FEE_CONFIG, convenienceFee: 20 };
  const b = orderCost({ deliveryFee: 50, storeCount: 1, goodsCost: 200 }, config);
  assert.equal(b.customerTotal, 200 + 50 + 0 + 20);
  assert.equal(b.commission, 7.5);
});

test('no floating point drift in rounding', () => {
  // 0.1-style inputs should still round cleanly to centavos
  const b = orderCost({ deliveryFee: 10.1, storeCount: 1, goodsCost: 0.2 });
  assert.equal(b.customerTotal, 10.3);
});

test('distanceDeliveryFee: within base distance is just the base fare', () => {
  assert.equal(distanceDeliveryFee(0), 50);
  assert.equal(distanceDeliveryFee(1.5), 50);
  assert.equal(distanceDeliveryFee(2), 50); // exactly at the base km
});

test('distanceDeliveryFee: charges per km beyond the base distance', () => {
  // 5 km → 50 + 10 × (5 − 2) = 80
  assert.equal(distanceDeliveryFee(5), 80);
  // 2.5 km → 50 + 10 × 0.5 = 55
  assert.equal(distanceDeliveryFee(2.5), 55);
});

test('distanceDeliveryFee: honours a custom rate config', () => {
  const config: DistanceFeeConfig = { baseFare: 40, baseKm: 1, perKm: 12 };
  // 4 km → 40 + 12 × (4 − 1) = 76
  assert.equal(distanceDeliveryFee(4, config), 76);
});

test('distanceDeliveryFee: guards bad distances', () => {
  assert.equal(distanceDeliveryFee(-3), 50);          // negative → base fare
  assert.equal(distanceDeliveryFee(NaN), 50);         // NaN → base fare
  assert.equal(DEFAULT_DISTANCE_FEE_CONFIG.baseFare, 50);
});
