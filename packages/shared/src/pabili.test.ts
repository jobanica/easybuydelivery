import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBudget,
  budgetVerdict,
  needsOverBudgetConfirmation,
  overCapAmount,
  pabiliCollectible,
  pabiliCommission,
  type PabiliBudget,
} from './pabili.ts';

const budget: PabiliBudget = { estimate: 500, cap: 600 };

test('validateBudget rejects a cap below the estimate', () => {
  assert.throws(() => validateBudget({ estimate: 500, cap: 400 }), /cap must be/);
  assert.throws(() => validateBudget({ estimate: -1, cap: 10 }), /non-negative/);
});

test('budgetVerdict classifies actual spend', () => {
  assert.equal(budgetVerdict(480, budget), 'within_estimate');
  assert.equal(budgetVerdict(550, budget), 'within_cap'); // between estimate and cap
  assert.equal(budgetVerdict(600, budget), 'within_cap'); // exactly cap is allowed
  assert.equal(budgetVerdict(650, budget), 'over_cap');
});

test('confirmation only needed over the cap', () => {
  assert.equal(needsOverBudgetConfirmation(550, budget), false);
  assert.equal(needsOverBudgetConfirmation(650, budget), true);
});

test('overCapAmount is the excess above the cap', () => {
  assert.equal(overCapAmount(650, budget), 50);
  assert.equal(overCapAmount(550, budget), 0);
});

test('collectible = actual goods + delivery fee', () => {
  assert.equal(pabiliCollectible(550, 60), 610);
});

test('commission is 15% of the delivery fee only', () => {
  assert.equal(pabiliCommission(60), 9); // 60 * 0.15, goods excluded
});
