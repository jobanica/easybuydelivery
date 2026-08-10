/**
 * Rider settlement gate.
 *
 * Every completed COD (or rider-QR) order adds its commission to the rider's
 * ledger. At the daily cutoff, the previous day's balance becomes due; a rider
 * with any unsettled balance from a business day BEFORE today is locked out of
 * accepting new orders until they settle.
 *
 * Online-paid orders do not add to the ledger — that money already reached the
 * operator, so there is nothing for the rider to hold.
 */

import { roundPeso } from './money.ts';

/** A single commission ledger entry. */
export interface LedgerEntry {
  amount: number;
  /** Business day this commission belongs to (YYYY-MM-DD). */
  businessDay: string;
  settled: boolean;
  /** What the charge is: the operator's commission, or its share of a mark-up. */
  kind?: 'commission' | 'markup';
}

/** Split an unsettled balance by what it is, so nothing reads as a mystery charge. */
export function owedByKind(entries: readonly LedgerEntry[]): { commission: number; markup: number } {
  let commission = 0, markup = 0;
  for (const e of entries) {
    if (e.settled) continue;
    if (e.kind === 'markup') markup += e.amount;
    else commission += e.amount;
  }
  return { commission: Math.round(commission * 100) / 100, markup: Math.round(markup * 100) / 100 };
}

/** Total unsettled balance across all business days. */
export function owedBalance(entries: readonly LedgerEntry[]): number {
  return roundPeso(
    entries.filter((e) => !e.settled).reduce((sum, e) => sum + e.amount, 0),
  );
}

/**
 * Unsettled balance from business days strictly before `today` (YYYY-MM-DD).
 * This is the amount the daily gate checks.
 */
export function overdueBalance(entries: readonly LedgerEntry[], today: string): number {
  return roundPeso(
    entries
      .filter((e) => !e.settled && e.businessDay < today)
      .reduce((sum, e) => sum + e.amount, 0),
  );
}

/** A rider is locked when they have any overdue (previous-day) balance. */
export function isLockedOut(entries: readonly LedgerEntry[], today: string): boolean {
  return overdueBalance(entries, today) > 0;
}

/** A rider and their ledger entries, for admin-side aggregation. */
export interface RiderLedgerGroup {
  riderId: string;
  riderName?: string;
  entries: readonly LedgerEntry[];
}

/** Per-rider balance summary for the admin settlement view. */
export interface RiderBalance {
  riderId: string;
  riderName?: string;
  owed: number;
  overdue: number;
  /** True when the rider should be locked (has an overdue previous-day balance). */
  locked: boolean;
}

/**
 * Summarize each rider's owed/overdue balance and lock state as of `today`.
 * Riders with nothing owed are omitted so the admin view lists only who owes.
 */
export function summarizeRiderBalances(
  groups: readonly RiderLedgerGroup[],
  today: string,
): RiderBalance[] {
  return groups
    .map((g) => ({
      riderId: g.riderId,
      riderName: g.riderName,
      owed: owedBalance(g.entries),
      overdue: overdueBalance(g.entries, today),
      locked: isLockedOut(g.entries, today),
    }))
    .filter((b) => b.owed > 0)
    .sort((a, b) => Number(b.locked) - Number(a.locked) || b.overdue - a.overdue);
}
