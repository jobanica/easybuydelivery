import type { LedgerEntry, OrderStatus } from '@ebd/shared';
import {
  listOpenOrders,
  listRiderActiveOrders,
  listRiderLedger,
  acceptOrder,
  advanceOrderStatus,
  updatePabiliActualAmount,
  createSettlement,
  type SupabaseClient,
} from '@ebd/supabase';
import type { RiderData, RiderOrder } from './types.ts';

function toRiderOrder(row: Record<string, unknown>): RiderOrder {
  return {
    id: row.id as string,
    service_type: row.service_type as RiderOrder['service_type'],
    status: row.status as OrderStatus,
    delivery_fee: Number(row.delivery_fee ?? 0),
    goods_cost: Number(row.goods_cost ?? 0),
    commission_amount: Number(row.commission_amount ?? 0),
    customer_contact: (row.customer_contact as string) ?? '',
    item_description: (row.item_description as string) ?? null,
    estimated_amount: row.estimated_amount == null ? null : Number(row.estimated_amount),
    budget_cap: row.budget_cap == null ? null : Number(row.budget_cap),
    actual_amount: row.actual_amount == null ? null : Number(row.actual_amount),
    store_contact: (row.store_contact as string) ?? null,
  };
}

/** Live Supabase-backed rider data for an authenticated, approved rider. */
export function createLiveData(db: SupabaseClient, riderId: string): RiderData {
  return {
    live: true,
    async getOpenOrders() {
      return (await listOpenOrders(db)).map((r) => toRiderOrder(r as Record<string, unknown>));
    },
    async getActiveOrders() {
      return (await listRiderActiveOrders(db, riderId)).map((r) => toRiderOrder(r as Record<string, unknown>));
    },
    async getLedger() {
      return (await listRiderLedger(db, riderId)).map((r): LedgerEntry => {
        const row = r as Record<string, unknown>;
        return {
          amount: Number(row.amount ?? 0),
          businessDay: row.business_day as string,
          settled: Boolean(row.settled),
        };
      });
    },
    async accept(orderId) {
      await acceptOrder(db, orderId, riderId);
    },
    async advance(order, next) {
      await advanceOrderStatus(db, order, next);
    },
    async setActual(order, amount) {
      return updatePabiliActualAmount(
        db,
        { id: order.id, estimated_amount: order.estimated_amount ?? 0, budget_cap: order.budget_cap ?? amount },
        amount,
      );
    },
    async settle(businessDay, amount) {
      await createSettlement(db, { riderId, businessDay, amountDue: amount });
    },
  };
}
