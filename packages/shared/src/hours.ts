/**
 * Store opening hours. A store carries an optional daily open/close time
 * (`opensAt`/`closesAt` as "HH:MM" or "HH:MM:SS"). The effective "open now"
 * state is derived from the current wall-clock time in the Philippines, so a
 * store auto-opens and auto-closes on schedule without any background job.
 */

const MANILA_TZ = 'Asia/Manila';

/** Parse "HH:MM[:SS]" to minutes since midnight, or null if absent/invalid. */
export function parseHm(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Current time-of-day in Manila, as minutes since midnight. */
export function manilaMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const min = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + min;
}

/**
 * Whether a store is open right now given its schedule. No schedule (either
 * bound null) → always open. Supports overnight windows (e.g. 18:00–02:00).
 */
export function isOpenNow(opensAt?: string | null, closesAt?: string | null, now: Date = new Date()): boolean {
  const o = parseHm(opensAt);
  const c = parseHm(closesAt);
  if (o == null || c == null) return true; // no schedule set → open when available
  if (o === c) return true;                // equal bounds → treated as 24 hours
  const cur = manilaMinutes(now);
  return o < c ? cur >= o && cur < c       // same-day window
               : cur >= o || cur < c;      // window crosses midnight
}

/** Format "HH:MM[:SS]" as a friendly 12-hour label, e.g. "9:00 AM". */
export function formatHm(t?: string | null): string {
  const mins = parseHm(t);
  if (mins == null) return '';
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** A short human label for a store's hours, e.g. "9:00 AM – 9:00 PM". */
export function scheduleLabel(opensAt?: string | null, closesAt?: string | null): string {
  const o = formatHm(opensAt);
  const c = formatHm(closesAt);
  return o && c ? `${o} – ${c}` : 'Open 24 hours';
}
