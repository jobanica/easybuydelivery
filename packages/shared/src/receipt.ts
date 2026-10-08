/**
 * What a receipt says, and where each thing sits on the paper.
 *
 * Kept apart from both the printer commands and the database: this takes an
 * order as plain numbers and strings and returns the bytes for it, so the
 * layout can be tested by reading the paper as text without a printer, a
 * browser, or a Supabase connection anywhere in sight.
 *
 * A receipt is a record of what somebody paid, and people keep them precisely
 * for the arguments — so every peso on the bill is named. A total that doesn't
 * reconcile to the lines above it is worse than no receipt at all.
 */

import { EscPos } from './escpos.ts';

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;
}

export interface ReceiptOrder {
  id: string;
  createdAt: string;
  serviceType: string;
  status?: string;
  customerName?: string | null;
  customerContact?: string | null;
  deliveryAddress?: string | null;
  items: ReceiptLine[];
  goodsCost: number;
  deliveryFee: number;
  storeFeeTotal?: number;
  convenienceFee?: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paymentReference?: string | null;
  /** Who is bringing it: a rider's name, a vehicle, or a collection. */
  carrier?: string | null;
  fulfilment?: string | null;
}

export interface ShopIdentity {
  name: string;
  address?: string | null;
  contact?: string | null;
  /** A line under the total — "Thank you", return policy, whatever they want. */
  footer?: string | null;
}

/** Peso amounts without the sign, because the printer has no glyph for it. */
export function peso(n: number): string {
  return `P${Number(n || 0).toFixed(2)}`;
}

const PAY_LABEL: Record<string, string> = {
  cod: 'Cash on delivery',
  rider_qr: 'GCash to rider',
  online: 'Paid online',
};

/** "14 Sep 2026, 5:22 PM" in Manila, wherever the console happens to be. */
export function receiptDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch { return iso; }
}

/** The last six characters of the uuid — enough to find an order by eye. */
export function receiptNo(id: string): string {
  return id.replace(/-/g, '').slice(-6).toUpperCase();
}

/**
 * Lay out one order on a roll `width` columns wide.
 *
 * 32 is a 58mm printer, which is what almost every stall in the country runs.
 */
export function buildReceipt(
  order: ReceiptOrder, shop: ShopIdentity, width = 32,
): Uint8Array {
  const p = new EscPos(width).init();

  p.align('center').big(true).line(shop.name).big(false);
  if (shop.address) p.line(shop.address);
  if (shop.contact) p.line(shop.contact);
  p.feed(1);

  p.bold(true).line(`RECEIPT #${receiptNo(order.id)}`).bold(false);
  p.line(receiptDate(order.createdAt));
  p.align('left').rule();

  if (order.customerName) p.row('Customer', trimTo(order.customerName, width - 10));
  if (order.customerContact) p.row('Contact', order.customerContact);
  p.row('Service', order.serviceType.toUpperCase());
  if (order.fulfilment === 'pickup') p.row('Fulfilment', 'PICK-UP');
  else if (order.carrier) p.row('Carrier', trimTo(order.carrier, width - 10));
  p.rule();

  // The bill. Quantity and unit price go under the name rather than beside it,
  // because a 32-column roll cannot hold "2 x Purefoods Chicken Nuggets" and a
  // price on the same row without truncating the thing the customer bought.
  let lineTotal = 0;
  for (const it of order.items) {
    const amount = (it.unitPrice || 0) * (it.qty || 1);
    lineTotal += amount;
    p.line(it.name);
    p.row(`  ${it.qty} x ${peso(it.unitPrice)}`, peso(amount));
  }
  if (order.items.length === 0) {
    // Pabili and padala carry no itemised lines — only what was agreed.
    p.row('Goods', peso(order.goodsCost));
  }

  p.rule();
  // Where the itemised lines don't add up to the recorded goods cost — a rider
  // corrected a price, or an item was dropped — the recorded figure is the one
  // that was charged, so it is the one shown.
  const goods = order.items.length > 0 ? lineTotal : order.goodsCost;
  if (order.items.length > 0 && Math.abs(goods - order.goodsCost) >= 0.01) {
    p.row('Items', peso(goods));
    p.row('Adjusted goods', peso(order.goodsCost));
  } else if (order.items.length > 0) {
    p.row('Goods', peso(goods));
  }

  if (order.deliveryFee > 0) p.row('Delivery fee', peso(order.deliveryFee));
  if ((order.storeFeeTotal ?? 0) > 0) p.row('Store fee', peso(order.storeFeeTotal!));
  if ((order.convenienceFee ?? 0) > 0) p.row('Convenience fee', peso(order.convenienceFee!));

  const total = Number(order.goodsCost || 0) + Number(order.deliveryFee || 0)
    + Number(order.storeFeeTotal || 0) + Number(order.convenienceFee || 0);

  p.rule('=');
  p.bold(true).tall(true).row('TOTAL', peso(total)).tall(false).bold(false);
  p.rule('=');

  if (order.paymentMethod) {
    p.row('Payment', PAY_LABEL[order.paymentMethod] ?? order.paymentMethod.replace(/_/g, ' '));
  }
  if (order.paymentStatus) p.row('Status', order.paymentStatus === 'paid' ? 'PAID' : 'UNPAID');
  if (order.paymentReference) p.row('Reference', order.paymentReference);

  if (order.deliveryAddress && order.fulfilment !== 'pickup') {
    p.feed(1).line('Deliver to:').line(order.deliveryAddress);
  }

  p.feed(1).align('center');
  p.line(shop.footer || 'Thank you!');
  p.line('This is your proof of purchase.');
  p.align('left').cut();

  return p.bytes();
}

/** A test slip, so the counter can confirm the printer works before a rush. */
export function buildTestPrint(shop: ShopIdentity, width = 32): Uint8Array {
  const p = new EscPos(width).init();
  p.align('center').big(true).line(shop.name).big(false);
  p.line('PRINTER TEST').feed(1).align('left');
  p.row('Paper width', `${width} cols`);
  p.row('Date', receiptDate(new Date().toISOString()));
  p.rule();
  p.row('Sample item', peso(123.45));
  p.row('Peso sign folds to', peso(0));
  p.line('Accents: Pampanga’s, niño, café');
  p.rule('=');
  p.bold(true).row('TOTAL', peso(123.45)).bold(false);
  p.feed(1).align('center').line('If this is readable,').line('you are ready to print.');
  p.align('left').cut();
  return p.bytes();
}

function trimTo(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`;
}
