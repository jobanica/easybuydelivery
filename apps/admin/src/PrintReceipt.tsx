import { useEffect, useState } from 'react';
import {
  buildReceipt, buildTestPrint, errMessage, OPERATOR_NAME,
  type ReceiptOrder, type ShopIdentity, type ReceiptLine,
} from '@ebd/shared';
import { getOrderDetail, getAppSettings } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import { printBytes, printingSupport, paperWidth } from './lib/printer.ts';

/**
 * Whose shop the receipt is from.
 *
 * The trading name is read from the one place it is already defined for the
 * privacy policy and the app listings — a receipt naming a different business
 * than the terms of service would be a small disaster to sort out later. The
 * address, phone and footer are the operator's to set, because they change when
 * the shop moves and that should not need a deploy.
 */
export function shopIdentity(settings?: Record<string, unknown> | null): ShopIdentity {
  const s = (k: string) => {
    const v = settings?.[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  return {
    name: OPERATOR_NAME,
    address: s('receipt_address'),
    contact: s('receipt_contact'),
    footer: s('receipt_footer') ?? 'Thank you for ordering!',
  };
}

/** The shop header, loaded once and shared by every print button on the page. */
let cachedSettings: Record<string, unknown> | null | undefined;
async function loadShop(): Promise<ShopIdentity> {
  if (cachedSettings === undefined) {
    try {
      cachedSettings = supabase
        ? (await getAppSettings(supabase)) as unknown as Record<string, unknown>
        : null;
    } catch { cachedSettings = null; }
  }
  return shopIdentity(cachedSettings);
}

/** Drop the cached header, so an edit in Settings shows on the next print. */
export function refreshShopIdentity() { cachedSettings = undefined; }

/** Turn whatever the console is holding into the fields a receipt needs. */
export function toReceiptOrder(
  o: Record<string, unknown>, items: Record<string, unknown>[] = [],
): ReceiptOrder {
  const num = (k: string) => Number(o[k] ?? 0);
  const str = (k: string) => (o[k] == null ? null : String(o[k]));
  const rider = o.rider as { name?: string } | null | undefined;
  return {
    id: String(o.id ?? ''),
    createdAt: String(o.created_at ?? new Date().toISOString()),
    serviceType: String(o.service_type ?? 'food'),
    status: str('status') ?? undefined,
    customerName: str('customer_name'),
    customerContact: str('customer_contact'),
    deliveryAddress: str('delivery_address'),
    items: items
      // A sold-out or superseded line was never handed over, so it is not on
      // the bill — printing it would have the customer paying for fresh air.
      .filter((it) => it.status == null || it.status === 'ok')
      .map((it): ReceiptLine => ({
        name: String(it.name ?? 'Item'),
        qty: Number(it.qty ?? 1),
        unitPrice: Number(it.unit_price ?? 0),
      })),
    goodsCost: num('goods_cost'),
    deliveryFee: num('delivery_fee'),
    storeFeeTotal: num('store_fee_total'),
    convenienceFee: num('convenience_fee'),
    paymentMethod: str('payment_method'),
    paymentStatus: str('payment_status'),
    paymentReference: str('payment_reference'),
    fulfilment: str('fulfilment'),
    carrier: rider?.name ?? str('carrier'),
  };
}

const swallowed = /cancell?ed|User cancelled|chooser|No device selected/i;

/**
 * Print one receipt.
 *
 * The first press of a session opens the browser's device picker, which is a
 * hard rule of Web Bluetooth rather than a choice: only a real tap may ask for
 * a device. Everything after that reuses the connection.
 *
 * Where the caller only has the order row — Live Orders holds no line items —
 * the detail is fetched before printing, because a receipt that says "Goods"
 * and one number is no use to somebody checking their bag at the counter.
 */
export function PrintReceipt({ order, items, label = '🖨 Print receipt', className }: {
  order: Record<string, unknown>;
  items?: Record<string, unknown>[];
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const support = printingSupport();

  async function go(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true); setErr(null); setDone(false);
    try {
      let row = order;
      let lines = items;
      if (!lines && supabase && order.id) {
        const detail = await getOrderDetail(supabase, String(order.id));
        row = { ...detail.order, ...order };
        lines = detail.items;
      }
      const shop = await loadShop();
      await printBytes(buildReceipt(toReceiptOrder(row, lines ?? []), shop, paperWidth()));
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e2) {
      // Closing the picker is a decision, not a fault — say nothing about it.
      const msg = errMessage(e2);
      setErr(swallowed.test(msg) ? null : msg);
    } finally { setBusy(false); }
  }

  if (!support.ok) {
    return (
      <span title={support.detail}
        className={`rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium text-black/30 ${className ?? ''}`}>
        🖨 Printing unavailable
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button onClick={(e) => void go(e)} disabled={busy} data-print-receipt
        className={`rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-black/70 hover:bg-black/[0.03] disabled:opacity-50 ${className ?? ''}`}>
        {busy ? 'Printing…' : done ? '✓ Sent to printer' : label}
      </button>
      {err && <span className="max-w-[16rem] text-[11px] leading-snug text-red-600">{err}</span>}
    </span>
  );
}

/** A test slip from the printer settings, so a rush is not the first attempt. */
export function TestPrintButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Settings may have just been edited; always print the current header.
  useEffect(() => refreshShopIdentity(), []);

  async function go() {
    setBusy(true); setErr(null); setDone(false);
    try {
      refreshShopIdentity();
      await printBytes(buildTestPrint(await loadShop(), paperWidth()));
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      const msg = errMessage(e);
      setErr(swallowed.test(msg) ? null : msg);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <button onClick={() => void go()} disabled={busy}
        className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Printing…' : done ? '✓ Sent' : 'Print a test slip'}
      </button>
      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}
