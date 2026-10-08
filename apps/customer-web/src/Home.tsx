/**
 * The first thing a signed-in customer sees: pick a service.
 *
 * Four things Easy Buy does, laid out as tiles rather than hidden behind a tab
 * bar that opened on Food whether or not that was the errand. A customer after
 * shampoo would never have thought to tap "Food" to find it.
 *
 * A service the operator has switched off is not shown at all — a greyed tile
 * invites a tap that goes nowhere.
 */

export type HomeService = 'shop' | 'food' | 'pabili' | 'padala';

interface Tile {
  key: HomeService;
  title: string;
  blurb: string;
  emoji: string;
  /** Tailwind classes for the tile's own colour, so each reads as its own thing. */
  tint: string;
}

const TILES: Tile[] = [
  {
    key: 'shop', title: 'Easy Buy Shop', emoji: '🛍️',
    blurb: 'Our own shelves — snacks, household, everyday things.',
    tint: 'from-brand-purple/15 to-brand-purple/5 ring-brand-purple/25',
  },
  {
    key: 'food', title: 'Food', emoji: '🍽️',
    blurb: 'Order from restaurants near you.',
    tint: 'from-brand-green/15 to-brand-green/5 ring-brand-green/25',
  },
  {
    key: 'pabili', title: 'Pabili', emoji: '🛒',
    blurb: "Anything from any store — we'll buy it for you.",
    tint: 'from-brand-yellow/25 to-brand-yellow/10 ring-brand-yellow',
  },
  {
    key: 'padala', title: 'Padala', emoji: '📦',
    blurb: 'Send a parcel across town.',
    tint: 'from-black/[0.06] to-black/[0.02] ring-black/10',
  },
];

export function Home({ enabled, onPick, name }: {
  enabled: Record<HomeService, boolean>;
  onPick: (s: HomeService) => void;
  name?: string | null;
}) {
  const shown = TILES.filter((t) => enabled[t.key]);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-black leading-tight">
          {name ? `Hi ${name.split(' ')[0]}, what do you need?` : 'What do you need today?'}
        </h2>
        <p className="mt-1 text-sm text-black/50">One rider, one order — pick where to start.</p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-black/60 shadow-sm ring-1 ring-black/5">
          All services are temporarily unavailable. Please check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((t) => (
            <button key={t.key} onClick={() => onPick(t.key)}
              className={`flex flex-col rounded-2xl bg-gradient-to-br p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${t.tint}`}>
              <span className="text-3xl leading-none">{t.emoji}</span>
              <span className="mt-2.5 text-base font-extrabold leading-tight">{t.title}</span>
              <span className="mt-1 text-xs leading-snug text-black/55">{t.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
