import { useEffect, useState } from 'react';
import { getAnalytics, analyticsRange, type Analytics as Data } from '@ebd/supabase';
import type { DayRange, ServiceType } from '@ebd/shared';
import { errMessage, manilaDay, shiftDay } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { Card, Muted, ErrorNote, peso } from './ui.tsx';

// Validated categorical palette (dataviz six-checks, light surface): fixed order.
const SERVICE_COLOR: Record<ServiceType, string> = {
  food: '#4A9415', pabili: '#7A4FB0', padala: '#C88A00',
};
const TREND = '#4A9415';

const RANGES = [7, 14, 30];
const today = manilaDay();

/** "1 Jul – 15 Jul 2026" — the span the figures cover, spelled out. */
function rangeLabel(r: DayRange): string {
  const fmt = (d: string, withYear: boolean) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  });
  if (r.from === r.to) return fmt(r.from, true);
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return `${fmt(r.from, !sameYear)} – ${fmt(r.to, true)}`;
}

function sample(spec: number | DayRange): Data {
  const range = analyticsRange(spec, today);
  const days = Math.max(1, Math.round(
    (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000) + 1);
  const daily = Array.from({ length: days }, (_, i) => ({
    day: shiftDay(range.from, i),
    count: Math.round(4 + 5 * Math.abs(Math.sin(i / 2))),
  }));
  return {
    rangeDays: days, range, totalOrders: 128, delivered: 112, cancelled: 6,
    gmv: 41850, commissionRevenue: 1284, convenienceRevenue: 560,
    byService: { food: 74, pabili: 33, padala: 21 },
    daily,
    riders: [
      { riderId: 'a', name: 'Ben Cruz', delivered: 41, commission: 486 },
      { riderId: 'b', name: 'Cy Ramos', delivered: 33, commission: 402 },
      { riderId: 'c', name: 'Dina Lim', delivered: 25, commission: 261 },
      { riderId: 'd', name: 'Ed Yu', delivered: 13, commission: 135 },
    ],
  };
}

export function Analytics() {
  const [days, setDays] = useState(14);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(() => shiftDay(today, -13));
  const [to, setTo] = useState(today);
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec: number | DayRange = custom ? { from, to } : days;
  const key = custom ? `${from}..${to}` : String(days);

  useEffect(() => {
    setD(null); setError(null);
    if (!supabase) { setD(sample(spec)); return; }
    getAnalytics(supabase, spec).then(setD).catch((e) => setError(errMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
      on ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'}`;

  const controls = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-black/50">Last</span>
        {RANGES.map((r) => (
          <button key={r} onClick={() => { setDays(r); setCustom(false); }} className={chip(!custom && days === r)}>
            {r} days
          </button>
        ))}
        <button onClick={() => setCustom((v) => !v)} className={chip(custom)}>📅 Pick dates</button>
        {d && <span className="text-xs text-black/40">{rangeLabel(d.range)}</span>}
      </div>
      {custom && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
          <label className="text-[11px] font-medium text-black/45">
            From
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value || from)}
              className="mt-0.5 block rounded-lg border border-black/10 px-2 py-1.5 text-sm text-brand-ink" />
          </label>
          <label className="text-[11px] font-medium text-black/45">
            To
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value || to)}
              className="mt-0.5 block rounded-lg border border-black/10 px-2 py-1.5 text-sm text-brand-ink" />
          </label>
          <span className="pb-1.5 text-xs text-black/40">Business days, Philippine time.</span>
        </div>
      )}
    </div>
  );

  if (error) return <div className="space-y-5">{controls}<ErrorNote msg={error} /></div>;
  if (!d) return <div className="space-y-5">{controls}<Muted>Loading…</Muted></div>;

  return (
    <div className="space-y-5">
      {controls}

      {/* Hero figures */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Commission revenue" value={peso(d.commissionRevenue)} accent />
        <Tile label="GMV" value={peso(d.gmv)} />
        <Tile label="Convenience fees (to riders)" value={peso(d.convenienceRevenue)} />
        <Tile label="Orders" value={`${d.totalOrders}`} sub={`${d.delivered} delivered · ${d.cancelled} cancelled`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Orders by service">
          <ServiceBars byService={d.byService} />
        </Card>
        <Card title={`Orders per day · ${d.rangeDays} day${d.rangeDays === 1 ? '' : 's'}`}>
          <DailyBars daily={d.daily} />
        </Card>
      </div>

      <Card title="Top riders by commission">
        {d.riders.length === 0 ? <p className="text-sm text-black/40">No delivered orders yet.</p>
          : <RiderBars riders={d.riders} />}
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ring-1 ${accent ? 'bg-brand-green text-white ring-brand-green' : 'bg-white ring-black/5'}`}>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className={`text-xs ${accent ? 'text-white/85' : 'text-black/50'}`}>{label}</div>
      {sub && <div className={`mt-0.5 text-[11px] ${accent ? 'text-white/75' : 'text-black/40'}`}>{sub}</div>}
    </div>
  );
}

/** Horizontal categorical bars with direct labels + legend (identity not color-alone). */
function ServiceBars({ byService }: { byService: Record<ServiceType, number> }) {
  const entries = (['food', 'pabili', 'padala'] as ServiceType[]).map((k) => ({ k, v: byService[k] }));
  const max = Math.max(1, ...entries.map((e) => e.v));
  return (
    <div className="space-y-3">
      {entries.map(({ k, v }) => (
        <div key={k} className="flex items-center gap-3">
          <span className="w-16 text-sm capitalize text-black/70">{k}</span>
          <div className="relative h-5 flex-1 rounded bg-black/[0.04]">
            <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(v / max) * 100}%`, background: SERVICE_COLOR[k] }} />
          </div>
          <span className="w-8 text-right text-sm font-semibold tabular-nums">{v}</span>
        </div>
      ))}
      <div className="flex gap-4 pt-1 text-xs text-black/50">
        {entries.map(({ k }) => (
          <span key={k} className="flex items-center gap-1.5 capitalize">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERVICE_COLOR[k] }} />{k}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Single-series vertical bars; hover shows the day + count (no legend needed). */
function DailyBars({ daily }: { daily: { day: string; count: number }[] }) {
  const W = 520, H = 160, pad = 20;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const bw = (W - pad * 2) / daily.length;
  const barW = Math.max(3, bw - 3);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="orders per day">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#00000014" />
      {daily.map((d, i) => {
        const h = ((H - pad * 2) * d.count) / max;
        const x = pad + i * bw;
        const y = H - pad - h;
        const showTick = i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2);
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={TREND}>
              <title>{d.day}: {d.count} order{d.count !== 1 ? 's' : ''}</title>
            </rect>
            {showTick && <text x={x + barW / 2} y={H - 6} fontSize={9} fill="#00000066" textAnchor="middle">{d.day.slice(5)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function RiderBars({ riders }: { riders: { name: string; delivered: number; commission: number }[] }) {
  const max = Math.max(1, ...riders.map((r) => r.commission));
  return (
    <div className="space-y-3">
      {riders.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-28 truncate text-sm text-black/70">{r.name}</span>
          <div className="relative h-5 flex-1 rounded bg-black/[0.04]">
            <div className="absolute inset-y-0 left-0 rounded bg-brand-green" style={{ width: `${(r.commission / max) * 100}%` }} />
          </div>
          <span className="w-20 text-right text-sm font-semibold tabular-nums">{peso(r.commission)}</span>
          <span className="w-16 text-right text-xs text-black/40">{r.delivered} trips</span>
        </div>
      ))}
    </div>
  );
}
