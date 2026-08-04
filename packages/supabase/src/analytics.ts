/**
 * Operator analytics — aggregated over recent orders. Municipality scale, so
 * aggregation is done in JS over a capped fetch (admin reads all orders).
 */

import { manilaDay, normalizeRange, shiftDay, type DayRange, type ServiceType } from '@ebd/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DayCount { day: string; count: number }
export interface RiderRank { riderId: string; name: string; delivered: number; commission: number }

export interface Analytics {
  rangeDays: number;
  /** The business days actually covered (inclusive), for labelling. */
  range: DayRange;
  totalOrders: number;
  delivered: number;
  cancelled: number;
  gmv: number;                 // goods + delivery + store fees + convenience
  commissionRevenue: number;   // operator commission on delivered orders
  convenienceRevenue: number;  // convenience fee on delivered orders
  byService: Record<ServiceType, number>;
  daily: DayCount[];
  riders: RiderRank[];
}

/** Manila is UTC+8 year-round, so a business day is a fixed offset. */
const MANILA_OFFSET = '+08:00';

/** Which business day an order belongs to — Manila, matching the ledger. */
const dayKey = (iso: string) => manilaDay(new Date(iso));

/** Whole days spanned by an inclusive range. */
function daysBetween(range: DayRange): number {
  const ms = new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** A day-count preset or an explicit span, resolved to inclusive business days. */
export function analyticsRange(spec: number | DayRange, today = manilaDay()): DayRange {
  return typeof spec === 'number'
    ? { from: shiftDay(today, -(Math.max(1, Math.round(spec)) - 1)), to: today }
    : normalizeRange(spec);
}

/**
 * Aggregate orders over a span of business days. Pass a number for "the last N
 * days" or an explicit {from, to} for a picked range — both inclusive of today's
 * partial day, and both bucketed by Philippine business day so the totals agree
 * with the commission ledger and the riders' own earnings screens.
 */
export async function getAnalytics(db: SupabaseClient, spec: number | DayRange = 14): Promise<Analytics> {
  const range = analyticsRange(spec);
  const days = daysBetween(range);
  // Half-open upper bound: everything before 00:00 Manila the day after `to`.
  const until = `${shiftDay(range.to, 1)}T00:00:00${MANILA_OFFSET}`;

  const { data, error } = await db
    .from('orders')
    .select('created_at, service_type, status, goods_cost, delivery_fee, store_fee_total, convenience_fee, commission_amount, rider_id')
    .gte('created_at', `${range.from}T00:00:00${MANILA_OFFSET}`)
    .lt('created_at', until)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) throw error;
  const orders = (data ?? []) as Record<string, unknown>[];

  const byService: Record<ServiceType, number> = { food: 0, pabili: 0, padala: 0 };
  const dailyMap = new Map<string, number>();
  const riderMap = new Map<string, { delivered: number; commission: number }>();
  let delivered = 0, cancelled = 0, gmv = 0, commissionRevenue = 0, convenienceRevenue = 0;

  // Seed every day in range so the trend has no gaps.
  for (let i = 0; i < days; i++) dailyMap.set(shiftDay(range.from, i), 0);

  for (const o of orders) {
    const service = o.service_type as ServiceType;
    if (service in byService) byService[service]++;
    const day = dayKey(o.created_at as string);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);

    const status = o.status as string;
    if (status === 'cancelled') { cancelled++; continue; }
    gmv += num(o.goods_cost) + num(o.delivery_fee) + num(o.store_fee_total) + num(o.convenience_fee);

    if (status === 'delivered') {
      delivered++;
      commissionRevenue += num(o.commission_amount);
      convenienceRevenue += num(o.convenience_fee);
      const rid = o.rider_id as string | null;
      if (rid) {
        const cur = riderMap.get(rid) ?? { delivered: 0, commission: 0 };
        cur.delivered++; cur.commission += num(o.commission_amount);
        riderMap.set(rid, cur);
      }
    }
  }

  // Resolve rider names for the leaderboard.
  const ids = [...riderMap.keys()];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: rs } = await db.from('riders').select('id, name').in('id', ids);
    names = new Map((rs ?? []).map((r) => [r.id as string, r.name as string]));
  }
  const riders: RiderRank[] = ids
    .map((id) => ({ riderId: id, name: names.get(id) ?? '—', ...riderMap.get(id)! }))
    .sort((a, b) => b.commission - a.commission)
    .slice(0, 5);

  return {
    rangeDays: days,
    range,
    totalOrders: orders.length,
    delivered, cancelled,
    gmv: round(gmv),
    commissionRevenue: round(commissionRevenue),
    convenienceRevenue: round(convenienceRevenue),
    byService,
    daily: [...dailyMap.entries()].map(([day, count]) => ({ day, count })),
    riders,
  };
}

const num = (v: unknown) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;
