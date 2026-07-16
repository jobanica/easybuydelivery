/**
 * Pricing & commission math for Easy Buy Delivery.
 *
 * Locked commission formula (confirmed by operator):
 *
 *   Commission = (Delivery Fee + perStoreFee × addedStores) × rate
 *
 * where addedStores = max(0, storeCount - 1), perStoreFee defaults to ₱25,
 * and rate defaults to 0.15. Commission is charged on the delivery fee and
 * per-store fees ONLY — never on the cost of goods, which is a pass-through.
 */

import { roundPeso } from './money.ts';

/** Fee configuration, mirrors the admin-editable `app_settings` row. */
export interface FeeConfig {
  /** Per-store add-on fee, applied to stores beyond the first. Default ₱25. */
  perStoreFee: number;
  /** Commission rate as a fraction. Default 0.15 (15%). */
  commissionRate: number;
  /** Flat convenience fee charged to the customer. Default ₱0. */
  convenienceFee: number;
  /**
   * How the convenience fee interacts with commission (open decision #2):
   * - 'pass_through' (default): straight to admin, outside the 15% base.
   * - 'in_base': folded into the commission base before applying the rate.
   */
  convenienceFeeMode: 'pass_through' | 'in_base';
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  perStoreFee: 25,
  commissionRate: 0.15,
  convenienceFee: 0,
  convenienceFeeMode: 'pass_through',
};

/** Number of stores billed the per-store add-on (stores beyond the first). */
export function addedStores(storeCount: number): number {
  return Math.max(0, Math.trunc(storeCount) - 1);
}

/** Total per-store fee for an order touching `storeCount` stores. */
export function storeFeeTotal(storeCount: number, config: FeeConfig): number {
  return roundPeso(addedStores(storeCount) * config.perStoreFee);
}

export interface CommissionInput {
  /** The delivery fee charged for this order. */
  deliveryFee: number;
  /** How many stores the order touches (1–3 for food/pabili; 0 or 1 for padala). */
  storeCount: number;
}

/**
 * Operator commission for an order.
 *
 * @example
 * // DF ₱50, 3 stores → base = 50 + 25×2 = 100 → commission = ₱15
 * commission({ deliveryFee: 50, storeCount: 3 }, DEFAULT_FEE_CONFIG) // 15
 */
export function commission(input: CommissionInput, config: FeeConfig = DEFAULT_FEE_CONFIG): number {
  let base = input.deliveryFee + addedStores(input.storeCount) * config.perStoreFee;
  if (config.convenienceFeeMode === 'in_base') {
    base += config.convenienceFee;
  }
  return roundPeso(base * config.commissionRate);
}

export interface OrderCostInput extends CommissionInput {
  /**
   * Cost of goods the customer repays the rider (food/pabili). ₱0 for padala.
   * Pass-through — excluded from commission.
   */
  goodsCost?: number;
}

export interface OrderCostBreakdown {
  goodsCost: number;
  deliveryFee: number;
  storeFeeTotal: number;
  convenienceFee: number;
  /** What the customer pays at the door / online. */
  customerTotal: number;
  /** Operator's commission (held by the rider on COD). */
  commission: number;
}

/**
 * Full monetary breakdown for an order.
 *
 * customerTotal = goodsCost + deliveryFee + storeFeeTotal + convenienceFee.
 * The commission is NOT added to the customer total — it is the operator's cut
 * of the delivery + store fees the customer already pays.
 */
export function orderCost(
  input: OrderCostInput,
  config: FeeConfig = DEFAULT_FEE_CONFIG,
): OrderCostBreakdown {
  const goods = input.goodsCost ?? 0;
  const stores = storeFeeTotal(input.storeCount, config);
  const customerTotal = roundPeso(
    goods + input.deliveryFee + stores + config.convenienceFee,
  );
  return {
    goodsCost: roundPeso(goods),
    deliveryFee: roundPeso(input.deliveryFee),
    storeFeeTotal: stores,
    convenienceFee: roundPeso(config.convenienceFee),
    customerTotal,
    commission: commission(input, config),
  };
}
