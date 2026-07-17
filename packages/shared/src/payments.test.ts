import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrepaidToOperator,
  collectibleAtDoor,
  generatesSettlementBalance,
} from './payments.ts';
import { orderCost } from './pricing.ts';

// Food-style order: goods 280 pass-through, DF 50, 1 store.
const food = orderCost({ deliveryFee: 50, storeCount: 1, goodsCost: 280 });
// Padala-style: no goods.
const padala = orderCost({ deliveryFee: 40, storeCount: 0, goodsCost: 0 });

test('only online is prepaid to the operator', () => {
  assert.equal(isPrepaidToOperator('online'), true);
  assert.equal(isPrepaidToOperator('cod'), false);
  assert.equal(isPrepaidToOperator('rider_qr'), false);
});

test('COD collects the full customer total', () => {
  assert.equal(collectibleAtDoor(food, 'cod'), food.customerTotal); // 330
});

test('online collects goods only (rider float), 0 for padala', () => {
  assert.equal(collectibleAtDoor(food, 'online'), 280);
  assert.equal(collectibleAtDoor(padala, 'online'), 0);
});

test('rider_qr collects nothing at the door', () => {
  assert.equal(collectibleAtDoor(food, 'rider_qr'), 0);
});

test('only COD and rider_qr generate a settlement balance', () => {
  assert.equal(generatesSettlementBalance('cod'), true);
  assert.equal(generatesSettlementBalance('rider_qr'), true);
  assert.equal(generatesSettlementBalance('online'), false);
});
