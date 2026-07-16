import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  owedBalance,
  overdueBalance,
  isLockedOut,
  generatesSettlementBalance,
  type LedgerEntry,
} from './settlement.ts';

const entries: LedgerEntry[] = [
  { amount: 15, businessDay: '2026-07-14', settled: true },
  { amount: 7.5, businessDay: '2026-07-15', settled: false },
  { amount: 6, businessDay: '2026-07-15', settled: false },
  { amount: 15, businessDay: '2026-07-16', settled: false },
];

test('owedBalance sums all unsettled entries', () => {
  assert.equal(owedBalance(entries), 28.5);
});

test('overdueBalance counts only business days before today', () => {
  // today = 2026-07-16 → only the two 07-15 entries are overdue
  assert.equal(overdueBalance(entries, '2026-07-16'), 13.5);
});

test('rider with previous-day balance is locked out', () => {
  assert.equal(isLockedOut(entries, '2026-07-16'), true);
});

test('rider with only same-day balance is NOT locked out', () => {
  const sameDayOnly: LedgerEntry[] = [
    { amount: 15, businessDay: '2026-07-16', settled: false },
  ];
  assert.equal(isLockedOut(sameDayOnly, '2026-07-16'), false);
});

test('fully settled rider is not locked out', () => {
  const settled: LedgerEntry[] = entries.map((e) => ({ ...e, settled: true }));
  assert.equal(isLockedOut(settled, '2026-07-16'), false);
});

test('only COD and rider_qr generate a settlement balance', () => {
  assert.equal(generatesSettlementBalance('cod'), true);
  assert.equal(generatesSettlementBalance('rider_qr'), true);
  assert.equal(generatesSettlementBalance('online'), false);
});
