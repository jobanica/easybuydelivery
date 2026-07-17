/**
 * Payment method rules.
 *
 * Three ways a customer can pay (open decision #6 — this encodes one reading):
 *
 * - `cod`      — cash on delivery. Rider collects the full customer total and
 *                holds the operator's commission (generates a settlement balance).
 * - `online`   — the platform/delivery portion (delivery fee + store/convenience
 *                fees, and the commission within them) is prepaid to the operator.
 *                The rider only collects the goods cost they fronted (nothing for
 *                Padala). No settlement balance — the operator already has its cut.
 * - `rider_qr` — customer scans the rider's personal QR and pays the full amount
 *                to the rider online. Rider collects no cash at the door but still
 *                holds the operator's commission (generates a settlement balance).
 */

import type { OrderCostBreakdown } from './pricing.ts';
import type { PaymentMethod } from './types.ts';

/** The platform/delivery portion is prepaid to the operator directly. */
export function isPrepaidToOperator(method: PaymentMethod): boolean {
  return method === 'online';
}

/**
 * Cash the rider collects from the customer at the door for a given method.
 * - cod:      full customer total
 * - online:   goods cost only (rider reimbursed for their float; 0 for Padala)
 * - rider_qr: 0 (the full amount was paid to the rider via QR)
 */
export function collectibleAtDoor(
  breakdown: OrderCostBreakdown,
  method: PaymentMethod,
): number {
  switch (method) {
    case 'online':
      return breakdown.goodsCost;
    case 'rider_qr':
      return 0;
    case 'cod':
    default:
      return breakdown.customerTotal;
  }
}

/** Whether an order paid with this method adds commission to the rider's books. */
export function generatesSettlementBalance(method: PaymentMethod): boolean {
  return method === 'cod' || method === 'rider_qr';
}
