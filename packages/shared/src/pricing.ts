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
import { haversineMeters, type LatLng } from './tracking.ts';
import type { DeliveryFeeModel } from './types.ts';

/** Fee configuration, mirrors the admin-editable `app_settings` row. */
export interface FeeConfig {
  /** Per-store add-on fee, applied to stores beyond the first. Default ₱25. */
  perStoreFee: number;
  /** Commission rate as a fraction. Default 0.15 (15%). */
  commissionRate: number;
  /**
   * Flat convenience fee charged to the customer. Default ₱0. This goes to the
   * rider in full — the operator takes NO commission on it, so it never enters
   * the commission base.
   */
  convenienceFee: number;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  perStoreFee: 25,
  commissionRate: 0.15,
  convenienceFee: 0,
};

/** Number of stores billed the per-store add-on (stores beyond the first). */
export function addedStores(storeCount: number): number {
  return Math.max(0, Math.trunc(storeCount) - 1);
}

/** Distance-based delivery-fee rate, mirrors the admin-editable settings. */
export interface DistanceFeeConfig {
  /** Base fare charged for any delivery within `baseKm`. Default ₱50. */
  baseFare: number;
  /** Distance (km) already covered by the base fare. Default 2. */
  baseKm: number;
  /** Rate (₱ per km) charged for each km beyond `baseKm`. Default ₱10. */
  perKm: number;
}

export const DEFAULT_DISTANCE_FEE_CONFIG: DistanceFeeConfig = {
  baseFare: 50,
  baseKm: 2,
  perKm: 10,
};

/**
 * Delivery fee for a `distanceKm`-long trip (store pin → drop-off) under the
 * per-km model:  baseFare + perKm × max(0, distanceKm − baseKm).
 *
 * @example
 * // 5 km with the defaults → 50 + 10 × (5 − 2) = ₱80
 * distanceDeliveryFee(5) // 80
 */
export function distanceDeliveryFee(
  distanceKm: number,
  config: DistanceFeeConfig = DEFAULT_DISTANCE_FEE_CONFIG,
): number {
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const billableKm = Math.max(0, km - config.baseKm);
  return roundPeso(config.baseFare + config.perKm * billableKm);
}

/**
 * Resolve the delivery fee for a trip. Under the 'per_km' model the fee is
 * driven by the farthest store→drop-off leg (a rider visiting several stores
 * still ends up covering at least that distance; extra stops are billed via the
 * per-store fee). Any other model — or a missing drop-off / un-pinned store —
 * falls back to the flat fee, so checkout never blocks on geodata.
 */
export function resolveDeliveryFee(args: {
  model: DeliveryFeeModel;
  flatFee: number;
  distanceConfig: DistanceFeeConfig;
  storeLocations: readonly (LatLng | null | undefined)[];
  dropoff: LatLng | null | undefined;
}): number {
  const { model, flatFee, distanceConfig, storeLocations, dropoff } = args;
  if (model !== 'per_km' || !isLatLng(dropoff)) return roundPeso(flatFee);
  const legsKm = storeLocations
    .filter(isLatLng)
    .map((s) => haversineMeters(s, dropoff) / 1000);
  if (legsKm.length === 0) return roundPeso(flatFee);
  return distanceDeliveryFee(Math.max(...legsKm), distanceConfig);
}

function isLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Total per-store fee for an order touching `storeCount` stores. */
export function storeFeeTotal(storeCount: number, config: FeeConfig): number {
  return roundPeso(addedStores(storeCount) * config.perStoreFee);
}

/**
 * Convenience fee for an order touching `storeCount` stores — one per stop.
 *
 * Each shop is its own queue, its own counter, its own wait. A padala (no
 * store at all) and a single-store order both carry exactly one.
 */
export function convenienceFeeTotal(storeCount: number, config: FeeConfig): number {
  return roundPeso(Math.max(1, Math.trunc(storeCount)) * config.convenienceFee);
}

export interface CommissionInput {
  /** The delivery fee charged for this order. */
  deliveryFee: number;
  /** How many stores the order touches (1–3 for food/pabili; 0 or 1 for padala). */
  storeCount: number;
}

/**
 * Operator commission for an order: (delivery fee + per-store fees) × rate.
 * The convenience fee is the rider's — never in the commission base.
 *
 * @example
 * // DF ₱50, 3 stores → base = 50 + 25×2 = 100 → commission = ₱15
 * commission({ deliveryFee: 50, storeCount: 3 }, DEFAULT_FEE_CONFIG) // 15
 */
export function commission(input: CommissionInput, config: FeeConfig = DEFAULT_FEE_CONFIG): number {
  const base = input.deliveryFee + addedStores(input.storeCount) * config.perStoreFee;
  return roundPeso(base * config.commissionRate);
}

export interface RiderEarningsInput {
  /** Delivery fee charged on this order (collected by the rider). */
  deliveryFee: number;
  /** Per-store fees on this order (collected by the rider). */
  storeFeeTotal?: number;
  /** Convenience fee — the rider's in full. */
  convenienceFee?: number;
  /** Operator commission the rider settles later. */
  commission: number;
}

/**
 * A rider's take-home for an order: the delivery + per-store + convenience fees
 * they collect, minus the operator's commission they settle later. Goods are a
 * pass-through (repaid by the customer) and excluded.
 *
 * @example
 * // DF ₱50, no added stores, no convenience, commission ₱7.50 → earns ₱42.50
 * riderEarnings({ deliveryFee: 50, commission: 7.5 }) // 42.5
 */
export function riderEarnings(input: RiderEarningsInput): number {
  return roundPeso(
    input.deliveryFee + (input.storeFeeTotal ?? 0) + (input.convenienceFee ?? 0) - input.commission,
  );
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
  const convenience = convenienceFeeTotal(input.storeCount, config);
  const customerTotal = roundPeso(
    goods + input.deliveryFee + stores + convenience,
  );
  return {
    goodsCost: roundPeso(goods),
    deliveryFee: roundPeso(input.deliveryFee),
    storeFeeTotal: stores,
    convenienceFee: convenience,
    customerTotal,
    commission: commission(input, config),
  };
}
