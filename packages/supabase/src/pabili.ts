/**
 * Pabili (buy-anything) data access.
 *
 * The request stores an estimate + cap and free-text items (no fixed menu).
 * After buying, the rider records the actual amount; the final collectible is
 * the actual goods cost + the delivery fee.
 */

import {
  validateBudget,
  pabiliCommission,
  needsOverBudgetConfirmation,
  type PabiliBudget,
  type PaymentMethod,
} from '@ebd/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PabiliRequestInput {
  customerId: string;
  customerContact: string;
  deliveryFee: number;
  /** Free-text list of what to buy. */
  itemsDescription: string;
  estimate: number;
  cap: number;
  /** Where to buy (specific store or "any nearest"). */
  where?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  notes?: string;
  paymentMethod?: PaymentMethod;
  paid?: boolean;
}

export interface PabiliOrderRow {
  customer_id: string;
  service_type: 'pabili';
  status: 'pending';
  payment_method: PaymentMethod;
  payment_status: 'unpaid' | 'paid';
  delivery_fee: number;
  store_fee_total: 0;
  goods_cost: 0;
  commission_amount: number;
  estimated_amount: number;
  budget_cap: number;
  item_description: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  customer_contact: string;
  notes: string | null;
}

/** Build the `orders` row for a Pabili request (pure, validated). */
export function buildPabiliOrderRow(input: PabiliRequestInput): PabiliOrderRow {
  if (!input.itemsDescription.trim()) {
    throw new Error('itemsDescription is required for a Pabili order');
  }
  const budget: PabiliBudget = { estimate: input.estimate, cap: input.cap };
  validateBudget(budget);

  const whereLine = input.where?.trim() ? `Buy at: ${input.where.trim()}\n` : '';
  const noteLine = input.notes?.trim() ?? '';

  return {
    customer_id: input.customerId,
    service_type: 'pabili',
    status: 'pending',
    payment_method: input.paymentMethod ?? 'cod',
    payment_status: input.paid ? 'paid' : 'unpaid',
    delivery_fee: input.deliveryFee,
    store_fee_total: 0,
    goods_cost: 0, // unknown until the rider buys
    commission_amount: pabiliCommission(input.deliveryFee),
    estimated_amount: input.estimate,
    budget_cap: input.cap,
    item_description: input.itemsDescription.trim(),
    delivery_lat: input.deliveryLat ?? null,
    delivery_lng: input.deliveryLng ?? null,
    customer_contact: input.customerContact,
    notes: (whereLine + noteLine).trim() || null,
  };
}

export async function createPabiliOrder(
  db: SupabaseClient,
  input: PabiliRequestInput,
): Promise<string> {
  const row = buildPabiliOrderRow(input);
  const { data, error } = await db.from('orders').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface ActualAmountResult {
  overCap: boolean;
}

/**
 * Rider records the actual amount spent after buying. Sets goods_cost so the
 * amount-to-collect is accurate. Returns whether the spend exceeded the cap
 * (the caller/UI should prompt for customer confirmation before collecting).
 */
export async function updatePabiliActualAmount(
  db: SupabaseClient,
  order: { id: string; estimated_amount: number; budget_cap: number },
  actualAmount: number,
): Promise<ActualAmountResult> {
  if (actualAmount < 0) throw new Error('actualAmount must be non-negative');
  const { error } = await db
    .from('orders')
    .update({ actual_amount: actualAmount, goods_cost: actualAmount })
    .eq('id', order.id);
  if (error) throw error;
  return {
    overCap: needsOverBudgetConfirmation(actualAmount, {
      estimate: order.estimated_amount,
      cap: order.budget_cap,
    }),
  };
}
