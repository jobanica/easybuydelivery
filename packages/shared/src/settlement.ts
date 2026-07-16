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

/** Only COD and rider-QR orders put commission on the rider's books. */
export function generatesSettlementBalance(
  paymentMethod: 'cod' | 'online' | 'rider_qr',
): boolean {
  return paymentMethod === 'cod' || paymentMethod === 'rider_qr';
}
