import type { OrderStatus, ServiceType, LedgerEntry, PaymentMethod } from '@ebd/shared';

/** The order shape the rider UI works with (subset of the orders row). */
export interface RiderOrder {
  id: string;
  service_type: ServiceType;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: 'unpaid' | 'paid';
  customerName: string | null;
  recipientName: string | null;
  recipientContact: string | null;
  delivery_fee: number;
  store_fee_total: number;
  convenience_fee: number;
  goods_cost: number;
  commission_amount: number;
  customer_contact: string;
  item_description: string | null;
  estimated_amount: number | null;
  budget_cap: number | null;
  actual_amount: number | null;
  store_contact: string | null;
  /** Linked store(s) for the order, so the rider can call the restaurant. */
  stores: { id: string | null; name: string | null; contact: string | null; lat: number | null; lng: number | null }[];
  /** What the customer ordered (store_id links each item to its store). */
  items: { store_id: string | null; name: string; qty: number; unitPrice: number; notes: string | null }[];
  /** Where the rider buys/collects (pabili & padala pin the source). */
  pickupLat: number | null;
  pickupLng: number | null;
  /** Customer drop-off coordinates (for the tracking map / navigation). */
  deliveryLat: number | null;
  deliveryLng: number | null;
  notes: string | null;
  /** Proof of a GCash-to-rider payment (uploaded by the customer, if any). */
  paymentReceiptUrl: string | null;
  paymentReference: string | null;
  paymentConfirmedAt: string | null;
  /** Released by another rider — prioritised in the pool. */
  isTransfer: boolean;
  transferReason: string | null;
  /** The previous rider already has the goods; coordinate a hand-over. */
  transferHadGoods: boolean;
  transferredFromName: string | null;
  transferredFromContact: string | null;
}

/** Abstraction the UI depends on — implemented for live Supabase and preview. */
export interface RiderData {
  readonly live: boolean;
  getOnline(): Promise<boolean>;
  setOnline(online: boolean): Promise<boolean>;
  getOpenOrders(): Promise<RiderOrder[]>;
  getActiveOrders(): Promise<RiderOrder[]>;
  getLedger(): Promise<LedgerEntry[]>;
  accept(orderId: string): Promise<void>;
  releaseOrder(orderId: string, reason?: string): Promise<void>;
  confirmPayment(orderId: string, note?: string): Promise<void>;
  advance(order: RiderOrder, next: OrderStatus): Promise<void>;
  setActual(order: RiderOrder, amount: number): Promise<{ overCap: boolean }>;
  settle(businessDay: string, amount: number, extra?: { reference?: string; receiptUrl?: string }): Promise<void>;
}
