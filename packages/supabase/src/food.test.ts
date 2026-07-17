import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFoodOrder, type FoodCheckoutInput } from './food.ts';
import type { CartLine } from '@ebd/shared';

const lines: CartLine[] = [
  { storeId: 'A', menuItemId: 'm1', name: 'Burger', unitPrice: 120, qty: 2,
    options: [{ name: 'Cheese', priceDelta: 15 }] },
  { storeId: 'B', menuItemId: 'm2', name: 'Milk tea', unitPrice: 90, qty: 1 },
];

const base: FoodCheckoutInput = {
  customerId: 'cust-1',
  customerContact: '09171234567',
  deliveryFee: 50,
  lines,
};

test('builds order with goods pass-through and 2-store fee', () => {
  const built = buildFoodOrder(base);
  assert.equal(built.order.goods_cost, 270 + 90); // (135*2) + 90
  assert.equal(built.order.store_fee_total, 25); // 1 added store
  assert.equal(built.order.commission_amount, 11.25); // (50+25)*0.15
  assert.equal(built.order.delivery_fee, 50);
});

test('collects distinct store links', () => {
  const built = buildFoodOrder(base);
  assert.deepEqual(built.storeIds.sort(), ['A', 'B']);
});

test('line items carry option-adjusted unit price', () => {
  const built = buildFoodOrder(base);
  const burger = built.items.find((i) => i.name === 'Burger')!;
  assert.equal(burger.unit_price, 135); // 120 + 15
  assert.equal(burger.qty, 2);
});

test('rejects an empty cart', () => {
  assert.throws(() => buildFoodOrder({ ...base, lines: [] }), /empty/);
});

test('rejects more than 3 stores', () => {
  const four: CartLine[] = ['A', 'B', 'C', 'D'].map((s) => ({
    storeId: s, name: 'x', unitPrice: 10, qty: 1,
  }));
  assert.throws(() => buildFoodOrder({ ...base, lines: four }), /at most 3 stores/);
});
