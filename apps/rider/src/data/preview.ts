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
      id: 'ord-food-1', service_type: 'food', status: 'pending',
      payment_method: 'cod', payment_status: 'unpaid',
      delivery_fee: 50, store_fee_total: 0, convenience_fee: 0, goods_cost: 280, commission_amount: 7.5,
      customer_contact: '0917 111 2222', item_description: null,
      estimated_amount: null, budget_cap: null, actual_amount: null,
      store_contact: '0918 555 0100', notes: 'Extra spicy, leave at the gate.',
    },
    {
      id: 'ord-pabili-1', service_type: 'pabili', status: 'pending',
      payment_method: 'cod', payment_status: 'unpaid',
      delivery_fee: 60, store_fee_total: 0, convenience_fee: 0, goods_cost: 0, commission_amount: 9,
      customer_contact: '0917 333 4444',
      item_description: '2x paracetamol, 1L milk', estimated_amount: 500,
      budget_cap: 600, actual_amount: null, store_contact: null, notes: null,
    },
    {
      id: 'ord-padala-1', service_type: 'padala', status: 'pending',
      payment_method: 'online', payment_status: 'paid',
      delivery_fee: 40, store_fee_total: 0, convenience_fee: 0, goods_cost: 0, commission_amount: 6,
      customer_contact: '0917 555 6666', item_description: 'Documents envelope (paid online)',
      estimated_amount: null, budget_cap: null, actual_amount: null,
      store_contact: null, notes: null,
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
      for (const e of ledger) if (e.businessDay === businessDay) e.settled = true;
    },
  };
}
