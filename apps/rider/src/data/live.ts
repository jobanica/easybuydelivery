import type { LedgerEntry, OrderStatus } from '@ebd/shared';
import {
  listOpenOrders,
  listRiderActiveOrders,
  listRiderLedger,
  acceptOrder,
  releaseOrder,
  advanceOrderStatus,
  updatePabiliActualAmount,
  uploadPabiliReceipt,
  createSettlement,
  riderConfirmPayment,
  riderMarkItemSoldOut,
  riderProposeReplacement,
  listOrderAddons,
  respondToAddon as respondToAddonRpc,
  getRiderOnline,
  setRiderOnline,
  type SupabaseClient,
} from '@ebd/supabase';
import type { RiderData, RiderOrder } from './types.ts';

function toRiderOrder(row: Record<string, unknown>): RiderOrder {
  return {
    id: row.id as string,
    service_type: row.service_type as RiderOrder['service_type'],
    status: row.status as OrderStatus,
    payment_method: (row.payment_method as RiderOrder['payment_method']) ?? 'cod',
    payment_status: (row.payment_status as RiderOrder['payment_status']) ?? 'unpaid',
    customerName: (row.customer_name as string) ?? null,
    recipientName: (row.recipient_name as string) ?? null,
    recipientContact: (row.recipient_contact as string) ?? null,
    delivery_fee: Number(row.delivery_fee ?? 0),
    store_fee_total: Number(row.store_fee_total ?? 0),
    convenience_fee: Number(row.convenience_fee ?? 0),
    goods_cost: Number(row.goods_cost ?? 0),
    commission_amount: Number(row.commission_amount ?? 0),
    customer_contact: (row.customer_contact as string) ?? '',
    item_description: (row.item_description as string) ?? null,
    estimated_amount: row.estimated_amount == null ? null : Number(row.estimated_amount),
    budget_cap: row.budget_cap == null ? null : Number(row.budget_cap),
    actual_amount: row.actual_amount == null ? null : Number(row.actual_amount),
    goodsReceiptUrl: (row.goods_receipt_url as string) ?? null,
    store_contact: (row.store_contact as string) ?? null,
    stores: Array.isArray(row.order_stores)
      ? (row.order_stores as { store: { id: string | null; name: string | null; contact_number: string | null; lat: number | null; lng: number | null } | null }[])
          .map((os) => ({ id: os.store?.id ?? null, name: os.store?.name ?? null, contact: os.store?.contact_number ?? null, lat: os.store?.lat ?? null, lng: os.store?.lng ?? null }))
      : [],
    items: Array.isArray(row.order_items)
      ? (row.order_items as { id: string; store_id: string | null; name: string; qty: number; unit_price: number; notes: string | null; status: string | null; replaces_item_id: string | null }[])
          .map((it) => ({
            id: it.id ?? null, store_id: it.store_id ?? null, name: it.name,
            qty: Number(it.qty ?? 1), unitPrice: Number(it.unit_price ?? 0), notes: it.notes ?? null,
            status: (it.status ?? 'ok') as RiderOrder['items'][number]['status'],
            replacesItemId: it.replaces_item_id ?? null,
          }))
      : [],
    pickupLat: row.pickup_lat == null ? null : Number(row.pickup_lat),
    pickupLng: row.pickup_lng == null ? null : Number(row.pickup_lng),
    deliveryLat: row.delivery_lat == null ? null : Number(row.delivery_lat),
    deliveryLng: row.delivery_lng == null ? null : Number(row.delivery_lng),
    notes: (row.notes as string) ?? null,
    paymentReceiptUrl: (row.payment_receipt_url as string) ?? null,
    paymentReference: (row.payment_reference as string) ?? null,
    paymentConfirmedAt: (row.payment_confirmed_at as string) ?? null,
    isTransfer: Boolean(row.is_transfer),
    transferReason: (row.transfer_reason as string) ?? null,
    transferHadGoods: Boolean(row.transfer_had_goods),
    transferredFromName: (row.transferred_from_name as string) ?? null,
    transferredFromContact: (row.transferred_from_contact as string) ?? null,
  };
}

/** Live Supabase-backed rider data for an authenticated, approved rider. */
export function createLiveData(db: SupabaseClient, riderId: string): RiderData {
  return {
    live: true,
    async getOnline() {
      return getRiderOnline(db, riderId);
    },
    async setOnline(online) {
      return setRiderOnline(db, online);
    },
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
    async releaseOrder(orderId, reason) {
      await releaseOrder(db, orderId, reason);
    },
    async confirmPayment(orderId, note) {
      await riderConfirmPayment(db, orderId, note);
    },
    async markSoldOut(itemId) {
      await riderMarkItemSoldOut(db, itemId);
    },
    async proposeReplacement(itemId, name, qty, unitPrice) {
      await riderProposeReplacement(db, itemId, name, qty, unitPrice);
    },
    async getAddons(orderId) {
      return listOrderAddons(db, orderId);
    },
    async respondToAddon(addonId, accept) {
      await respondToAddonRpc(db, addonId, accept);
    },
    async advance(order, next) {
      await advanceOrderStatus(db, order, next);
    },
    async setActual(order, amount, receiptUrl) {
      return updatePabiliActualAmount(
        db,
        { id: order.id, estimated_amount: order.estimated_amount ?? 0, budget_cap: order.budget_cap ?? amount },
        amount,
        receiptUrl,
      );
    },
    async uploadGoodsReceipt(orderId, file) {
      return uploadPabiliReceipt(db, orderId, file);
    },
    async settle(businessDay, amount, extra) {
      await createSettlement(db, {
        riderId, businessDay, amountDue: amount,
        method: 'gcash', reference: extra?.reference, receiptUrl: extra?.receiptUrl,
      });
    },
  };
}
