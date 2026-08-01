import type { LedgerEntry, OrderStatus } from '@ebd/shared';
import { needsOverBudgetConfirmation, canTransition, generatesSettlementBalance } from '@ebd/shared';
import type { RiderData, RiderOrder } from './types.ts';

/** YYYY-MM-DD helpers for seeding a believable ledger. */
function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * In-memory rider data for preview mode (no Supabase). Seeds an unsettled
 * previous-day balance so the settlement lock screen is demonstrable, plus a
 * pool of one order per service type.
 */
export function createPreviewData(): RiderData {
  let open: RiderOrder[] = [
    {
      id: 'ord-transfer-1', service_type: 'food', status: 'pending',
      payment_method: 'cod', payment_status: 'unpaid', customerName: 'Rico Tan', recipientName: null, recipientContact: null,
      delivery_fee: 55, store_fee_total: 0, convenience_fee: 20, goods_cost: 320, commission_amount: 8.25,
      customer_contact: '0917 777 1010', item_description: null,
      estimated_amount: null, budget_cap: null, actual_amount: null,
      store_contact: '0918 555 0200', stores: [{ id: 's2', name: 'Kowloon House', contact: '0918 555 0200', lat: 14.18, lng: 121.246 }],
      items: [{ store_id: 's2', name: 'Chicken Mami', qty: 2, unitPrice: 115, notes: null }, { store_id: 's2', name: 'Siopao', qty: 2, unitPrice: 45, notes: null }],
      pickupLat: null, pickupLng: null, deliveryLat: 14.192, deliveryLng: 121.258, notes: null,
      isTransfer: true, transferReason: 'Flat tire', transferHadGoods: true,
      transferredFromName: 'Ben Cruz', transferredFromContact: '0918 555 2000',
    },
    {
      id: 'ord-food-1', service_type: 'food', status: 'pending',
      payment_method: 'cod', payment_status: 'unpaid', customerName: 'Maria Santos', recipientName: 'Lola Nena', recipientContact: '0917 999 8888',
      delivery_fee: 50, store_fee_total: 0, convenience_fee: 0, goods_cost: 280, commission_amount: 7.5,
      customer_contact: '0917 111 2222', item_description: null,
      estimated_amount: null, budget_cap: null, actual_amount: null,
      store_contact: '0918 555 0100', stores: [{ id: 's1', name: 'Barrio Diner', contact: '0918 555 0100', lat: 14.176, lng: 121.244 }],
      items: [{ store_id: 's1', name: 'Chicken Adobo', qty: 2, unitPrice: 95, notes: null }, { store_id: 's1', name: 'Extra Rice', qty: 2, unitPrice: 20, notes: null }, { store_id: 's1', name: 'Softdrink', qty: 1, unitPrice: 50, notes: 'Cold' }],
      pickupLat: null, pickupLng: null, deliveryLat: 14.186, deliveryLng: 121.256, notes: 'Extra spicy, leave at the gate.',
      isTransfer: false, transferReason: null, transferHadGoods: false, transferredFromName: null, transferredFromContact: null,
    },
    {
      id: 'ord-pabili-1', service_type: 'pabili', status: 'pending',
      payment_method: 'cod', payment_status: 'unpaid', customerName: 'Ben Cruz', recipientName: null, recipientContact: null,
      delivery_fee: 60, store_fee_total: 0, convenience_fee: 0, goods_cost: 0, commission_amount: 9,
      customer_contact: '0917 333 4444',
      item_description: '2x paracetamol, 1L milk', estimated_amount: 500,
      budget_cap: 600, actual_amount: null, store_contact: null, stores: [],
      items: [{ store_id: null, name: '2x paracetamol', qty: 1, unitPrice: 0, notes: null }, { store_id: null, name: '1L milk', qty: 1, unitPrice: 0, notes: null }],
      pickupLat: null, pickupLng: null, deliveryLat: 14.19, deliveryLng: 121.25, notes: null,
      isTransfer: false, transferReason: null, transferHadGoods: false, transferredFromName: null, transferredFromContact: null,
    },
    {
      id: 'ord-padala-1', service_type: 'padala', status: 'pending',
      payment_method: 'online', payment_status: 'paid', customerName: 'Ana Reyes', recipientName: null, recipientContact: null,
      delivery_fee: 40, store_fee_total: 0, convenience_fee: 0, goods_cost: 0, commission_amount: 6,
      customer_contact: '0917 555 6666', item_description: 'Documents envelope (paid online)',
      estimated_amount: null, budget_cap: null, actual_amount: null,
      store_contact: null, stores: [],
      items: [{ store_id: null, name: 'Documents envelope', qty: 1, unitPrice: 0, notes: null }],
      pickupLat: null, pickupLng: null, deliveryLat: 14.2, deliveryLng: 121.26, notes: null,
      isTransfer: false, transferReason: null, transferHadGoods: false, transferredFromName: null, transferredFromContact: null,
    },
  ];
  let active: RiderOrder[] = [];
  let online = true;
  const ledger: LedgerEntry[] = [
    // Yesterday, unsettled -> triggers the lock screen.
    { amount: 22.5, businessDay: isoDay(-1), settled: false },
  ];

  return {
    live: false,
    async getOnline() { return online; },
    async setOnline(v) { online = v; return online; },
    async getOpenOrders() { return [...open]; },
    async getActiveOrders() { return [...active]; },
    async getLedger() { return [...ledger]; },
    async accept(orderId) {
      const o = open.find((x) => x.id === orderId);
      if (!o) return;
      open = open.filter((x) => x.id !== orderId);
      active = [...active, { ...o, status: 'accepted' }];
    },
    async releaseOrder(orderId) {
      const o = active.find((x) => x.id === orderId);
      if (!o) return;
      active = active.filter((x) => x.id !== orderId);
      open = [...open, { ...o, status: 'pending' }];
    },
    async advance(order, next: OrderStatus) {
      if (!canTransition(order.service_type, order.status, next)) {
        throw new Error(`Illegal transition ${order.status} → ${next}`);
      }
      if (next === 'delivered') {
        active = active.filter((x) => x.id !== order.id);
        // Online-paid orders don't add to the rider's books — the operator
        // already holds its commission.
        if (generatesSettlementBalance(order.payment_method)) {
          ledger.push({ amount: order.commission_amount, businessDay: isoDay(0), settled: false });
        }
      } else {
        active = active.map((x) => (x.id === order.id ? { ...x, status: next } : x));
      }
    },
    async setActual(order, amount) {
      active = active.map((x) =>
        x.id === order.id ? { ...x, actual_amount: amount, goods_cost: amount } : x);
      return {
        overCap: needsOverBudgetConfirmation(amount, {
          estimate: order.estimated_amount ?? 0,
          cap: order.budget_cap ?? amount,
        }),
      };
    },
    async settle(businessDay) {
      // Preview: clear everything up to and including the paid day.
      for (const e of ledger) if (e.businessDay <= businessDay) e.settled = true;
    },
  };
}
