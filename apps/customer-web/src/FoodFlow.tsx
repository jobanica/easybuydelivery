import { useEffect, useMemo, useState } from 'react';
import {
  summarizeCart,
  distinctStoreCount,
  collectibleAtDoor,
  resolveDeliveryFee,
  lineUnitPrice,
  DEFAULT_DISTANCE_FEE_CONFIG,
  DEFAULT_FEE_CONFIG,
  MAX_STORES_PER_ORDER,
  type CartLine,
  type CartOption,
  type DeliveryFeeModel,
  type DistanceFeeConfig,
  type FeeConfig,
} from '@ebd/shared';
import { listAvailableStores, listMenu, buildFoodOrder, createFoodOrder, getAppSettings } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { SAMPLE_STORES, type SampleStore } from './food/sampleData.ts';
import { peso, PaymentChoice, type PayChoice } from './ui.tsx';
import { LocationPicker, type LatLngValue } from './LocationPicker.tsx';
import { useAuth } from './auth/AuthContext.tsx';

const DELIVERY_FEE = 50;

interface Choice { name: string; priceDelta: number }
interface CustomGroup { id: string; name: string; required: boolean; multi: boolean; choices: Choice[] }
interface MenuItem { id: string; name: string; price: number; description?: string; image_url?: string | null; category_id: string | null; groups: CustomGroup[] }
interface Category { id: string; title: string }
interface Store { id: string; name: string; category: string; items: MenuItem[]; categories: Category[]; lat: number | null; lng: number | null; logo_url?: string | null }

/** Unique cart key for an item + chosen size (different sizes are separate lines). */
const lineKey = (l: CartLine) => `${l.menuItemId ?? l.name}|${(l.options ?? []).map((o) => o.name).join(',')}`;

interface FeeSettings {
  model: DeliveryFeeModel;
  flatFee: number;
  distance: DistanceFeeConfig;
  config: FeeConfig; // perStoreFee, commissionRate, convenienceFee
}
const DEFAULT_FEE_SETTINGS: FeeSettings = {
  model: 'flat', flatFee: DELIVERY_FEE, distance: DEFAULT_DISTANCE_FEE_CONFIG, config: DEFAULT_FEE_CONFIG,
};

export function FoodFlow() {
  const { ensureContact, mobile } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  const [menuCat, setMenuCat] = useState<string>(''); // '' = all categories
  const [menuSearch, setMenuSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState(''); // filter the restaurant list
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pay, setPay] = useState<PayChoice>('cod');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fees, setFees] = useState<FeeSettings>(DEFAULT_FEE_SETTINGS);
  const [dropoff, setDropoff] = useState<LatLngValue | null>(null);
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  // Prefill the delivery contact with the account's verified phone.
  useEffect(() => { if (mobile && !contact) setContact(mobile); }, [mobile]);

  useEffect(() => {
    (async () => {
      try {
        if (supabase && isSupabaseConfigured) {
          const [rows, settings] = await Promise.all([
            listAvailableStores(supabase),
            getAppSettings(supabase).catch(() => null),
          ]);
          if (settings) {
            setFees({
              model: settings.delivery_fee_model,
              flatFee: settings.default_delivery_fee,
              distance: {
                baseFare: settings.delivery_base_fare,
                baseKm: settings.delivery_base_km,
                perKm: settings.delivery_per_km,
              },
              config: {
                perStoreFee: settings.per_store_fee,
                commissionRate: settings.commission_rate,
                convenienceFee: settings.convenience_fee,
              },
            });
          }
          const withMenus: Store[] = [];
          for (const s of rows as { id: string; name: string; category: string | null; lat: number | null; lng: number | null; logo_url: string | null }[]) {
            const menu = await listMenu(supabase, s.id);
            const allOpts = (menu.options ?? []) as { group_id: string | null; option_name: string; price_delta: number }[];
            const groupsByItem = new Map<string, CustomGroup[]>();
            for (const g of (menu.optionGroups ?? []) as { id: string; menu_item_id: string; name: string; required: boolean; multi_select: boolean }[]) {
              const choices = allOpts.filter((o) => o.group_id === g.id).map((o) => ({ name: o.option_name, priceDelta: Number(o.price_delta) }));
              const arr = groupsByItem.get(g.menu_item_id) ?? [];
              arr.push({ id: g.id, name: g.name, required: g.required, multi: g.multi_select, choices });
              groupsByItem.set(g.menu_item_id, arr);
            }
            withMenus.push({
              id: s.id, name: s.name, category: s.category ?? '',
              lat: s.lat, lng: s.lng, logo_url: s.logo_url,
              categories: ((menu.categories ?? []) as { id: string; title: string }[]).map((c) => ({ id: c.id, title: c.title })),
              items: (menu.items as { id: string; name: string; price: number; description?: string; image_url?: string | null; category_id?: string | null }[])
                .map((it) => ({ ...it, category_id: it.category_id ?? null, groups: groupsByItem.get(it.id) ?? [] })),
            });
          }
          setStores(withMenus);
        } else {
          setStores((SAMPLE_STORES as SampleStore[]).map((s) => ({
            ...s, lat: null, lng: null, categories: [],
            items: s.items.map((it) => ({ ...it, category_id: null, groups: [] })),
          })));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Distinct store locations touched by the cart, for the distance-based fee.
  const cartStoreLocations = useMemo(() => {
    const ids = new Set(cart.map((l) => l.storeId));
    return stores.filter((s) => ids.has(s.id)).map((s) => ({ lat: s.lat, lng: s.lng }));
  }, [cart, stores]);

  const deliveryFee = useMemo(() => resolveDeliveryFee({
    model: fees.model, flatFee: fees.flatFee, distanceConfig: fees.distance,
    storeLocations: cartStoreLocations.map((s) => (s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null)),
    dropoff,
  }), [fees, cartStoreLocations, dropoff]);

  const summary = useMemo(() => summarizeCart(cart, deliveryFee, fees.config), [cart, deliveryFee, fees.config]);
  const storeCount = distinctStoreCount(cart);
  const openStore = stores.find((s) => s.id === openStoreId) ?? null;
  // Under per-km pricing we need the drop-off pin before we can price/checkout.
  const needsDropoff = fees.model === 'per_km' && !dropoff;

  // Reset menu filters whenever the open restaurant changes.
  useEffect(() => { setMenuCat(''); setMenuSearch(''); setCustomizingId(null); }, [openStoreId]);

  // Restaurants filtered by the search box (name or category).
  const shownStores = stores.filter((s) => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
  });

  // Menu items filtered by the selected category + search box.
  const menuItems = (openStore?.items ?? []).filter((it) => {
    if (menuCat && it.category_id !== menuCat) return false;
    if (menuSearch.trim() && !it.name.toLowerCase().includes(menuSearch.trim().toLowerCase())) return false;
    return true;
  });

  // Cart grouped by store (one order → one rider visits each store).
  const cartByStore = useMemo(() => {
    const map = new Map<string, { name: string; lines: CartLine[] }>();
    for (const l of cart) {
      if (!map.has(l.storeId)) map.set(l.storeId, { name: stores.find((s) => s.id === l.storeId)?.name ?? 'Store', lines: [] });
      map.get(l.storeId)!.lines.push(l);
    }
    return [...map.values()];
  }, [cart, stores]);
  const canAddStore = storeCount < MAX_STORES_PER_ORDER;

  function addToCart(store: Store, item: MenuItem, options?: CartOption[]) {
    setError(null);
    const opts = options && options.length ? options : undefined;
    const newLine: CartLine = {
      storeId: store.id, menuItemId: item.id,
      name: opts ? `${item.name} — ${opts.map((o) => o.name).join(', ')}` : item.name,
      unitPrice: item.price, qty: 1, options: opts,
    };
    const key = lineKey(newLine);
    const existing = cart.find((l) => lineKey(l) === key);
    const next = existing
      ? cart.map((l) => (lineKey(l) === key ? { ...l, qty: l.qty + 1 } : l))
      : [...cart, newLine];
    if (new Set(next.map((l) => l.storeId)).size > MAX_STORES_PER_ORDER) {
      setError(`An order can span at most ${MAX_STORES_PER_ORDER} stores.`);
      return;
    }
    setCart(next);
  }

  function changeQty(key: string, delta: number) {
    setCart((c) =>
      c.map((l) => (lineKey(l) === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function checkout() {
    setError(null);
    if (needsDropoff) { setError('Please set your delivery location first.'); return; }
    if (!contact.trim()) { setError('Please enter your mobile number so the rider can reach you.'); return; }
    try {
      if (supabase && isSupabaseConfigured) {
        const customerId = await ensureContact(contact.trim());
        setCreatedId(await createFoodOrder(supabase, {
          customerId,
          customerContact: contact.trim(),
          deliveryFee,
          lines: cart,
          notes: note.trim() || undefined,
          deliveryLat: dropoff?.lat,
          deliveryLng: dropoff?.lng,
          paymentMethod: (pay === 'online' ? 'online' : 'cod') as 'online' | 'cod',
          paid: pay === 'online',
        }, fees.config));
      } else {
        buildFoodOrder({
          customerId: 'preview-customer', customerContact: contact.trim() || '09171234567',
          deliveryFee, lines: cart, paymentMethod: pay === 'online' ? 'online' : 'cod', paid: pay === 'online',
        }, fees.config);
        setCreatedId('preview-only');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p className="text-sm text-black/50">Loading stores…</p>;

  if (createdId) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">✓</div>
        <h2 className="text-lg font-bold">Order placed</h2>
        <p className="mt-1 text-sm text-black/60">
          {createdId === 'preview-only' ? 'Preview only — connect Supabase to notify riders.' : 'Riders have been notified.'}
        </p>
        <p className="mt-2 font-mono text-xs text-black/40">{createdId}</p>
        <button onClick={() => { setCart([]); setCreatedId(null); setOpenStoreId(null); setDropoff(null); setContact(''); setNote(''); }}
          className="mt-5 rounded-lg border border-brand-purple px-4 py-2 text-sm font-medium text-brand-purple hover:bg-brand-purple/5">
          Order again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {openStore ? (
        <section className="space-y-4">
          <button onClick={() => setOpenStoreId(null)}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-purple px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95">
            <span className="text-base leading-none">←</span> All restaurants
          </button>

          {/* Restaurant hero */}
          <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/[0.04] ring-1 ring-black/5">
              {openStore.logo_url ? <img src={openStore.logo_url} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl">🏪</span>}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-extrabold">{openStore.name}</h2>
              {openStore.category && <p className="text-sm text-black/50">{openStore.category}</p>}
              <p className="mt-0.5 text-xs text-brand-green">● Open now</p>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5">
            <SearchIcon />
            <input value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Search this menu"
              className="w-full bg-transparent text-sm outline-none placeholder-black/40" />
          </div>

          {/* Category pills */}
          {openStore.categories.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <CatPill active={menuCat === ''} onClick={() => setMenuCat('')}>All</CatPill>
              {openStore.categories.map((c) => (
                <CatPill key={c.id} active={menuCat === c.id} onClick={() => setMenuCat(c.id)}>{c.title}</CatPill>
              ))}
            </div>
          )}

          {/* Menu item cards */}
          <div className="space-y-3">
            {menuItems.map((it) => (
              <div key={it.id} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <div className="flex gap-3 p-3">
                  <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.04]">
                    {it.image_url ? <img src={it.image_url} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl">🍽️</span>}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="font-semibold leading-tight">{it.name}</p>
                    {it.description && <p className="mt-0.5 line-clamp-2 text-xs text-black/50">{it.description}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-bold text-brand-ink">{peso(it.price)}{it.groups.length > 0 && <span className="text-xs font-normal text-black/40">+</span>}</span>
                      {it.groups.length === 0 ? (
                        <button onClick={() => addToCart(openStore, it)}
                          className="rounded-full bg-brand-green px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-95">＋ Add</button>
                      ) : (
                        <button onClick={() => setCustomizingId(customizingId === it.id ? null : it.id)}
                          className="rounded-full bg-brand-purple px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-95">
                          {customizingId === it.id ? 'Close' : 'Customize'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {customizingId === it.id && it.groups.length > 0 && (
                  <div className="px-3 pb-3">
                    <Customizer item={it} onAdd={(options) => { addToCart(openStore, it, options); setCustomizingId(null); }} />
                  </div>
                )}
              </div>
            ))}
            {menuItems.length === 0 && (
              <p className="rounded-2xl bg-white p-6 text-center text-sm text-black/40 shadow-sm ring-1 ring-black/5">
                {menuSearch || menuCat ? 'No items match your filter.' : 'No items on this menu yet.'}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          {cart.length > 0 && (
            <p className="rounded-lg bg-brand-green/10 px-3 py-2 text-xs text-green-800">
              Pick another store to add to your order — one rider will buy from all of them.
            </p>
          )}

          {/* Search restaurants */}
          <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5">
            <SearchIcon />
            <input value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)}
              placeholder="Search restaurants"
              className="w-full bg-transparent text-sm outline-none placeholder-black/40" />
            {storeSearch && (
              <button onClick={() => setStoreSearch('')} className="text-black/30 hover:text-black/60">✕</button>
            )}
          </div>

          {shownStores.map((s) => (
            <button key={s.id} onClick={() => setOpenStoreId(s.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-black/5 hover:ring-brand-green/40">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.04] ring-1 ring-black/5">
                {s.logo_url ? <img src={s.logo_url} alt="" className="h-full w-full object-cover" /> : <span className="text-xl">🏪</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="text-xs text-black/50">{s.category}</span>
              </span>
              <span className="text-brand-purple">→</span>
            </button>
          ))}
          {shownStores.length === 0 && (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-black/40 shadow-sm ring-1 ring-black/5">
              {storeSearch ? `No restaurants match “${storeSearch}”.` : 'No restaurants available yet.'}
            </p>
          )}
        </section>
      )}

      {cart.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <h3 className="mb-2 font-bold">Your cart {storeCount > 1 && <span className="text-xs font-normal text-black/50">· {storeCount} stores</span>}</h3>

          {/* Items grouped by store — one order, one rider visits each store. */}
          <div className="mb-3 space-y-3">
            {cartByStore.map((grp) => (
              <div key={grp.name}>
                {storeCount > 1 && <p className="mb-1 text-xs font-semibold text-brand-purple">🏪 {grp.name}</p>}
                <ul className="divide-y divide-black/5">
                  {grp.lines.map((l) => (
                    <li key={lineKey(l)} className="flex items-center justify-between py-2 text-sm">
                      <span>{l.name}</span>
                      <span className="flex items-center gap-2">
                        <button onClick={() => changeQty(lineKey(l), -1)} className="h-6 w-6 rounded bg-black/5">−</button>
                        <span className="w-4 text-center">{l.qty}</span>
                        <button onClick={() => changeQty(lineKey(l), +1)} className="h-6 w-6 rounded bg-black/5">+</button>
                        <span className="w-16 text-right font-medium">{peso(lineUnitPrice(l) * l.qty)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Order from more than one store — the same rider buys at each. */}
          {canAddStore ? (
            <button onClick={() => { setOpenStoreId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="mb-3 w-full rounded-lg border border-dashed border-brand-purple/50 py-2.5 text-sm font-semibold text-brand-purple hover:bg-brand-purple/5">
              ＋ Add items from another store
            </button>
          ) : (
            <p className="mb-3 text-center text-xs text-black/40">Up to {MAX_STORES_PER_ORDER} stores per order.</p>
          )}
          {storeCount > 1 && (
            <p className="mb-3 rounded-lg bg-brand-purple/5 px-3 py-2 text-xs text-brand-purple">
              One rider will buy from all {storeCount} stores. The delivery fee is charged for the farthest store only.
            </p>
          )}

          {fees.model === 'per_km' && (
            <div className="mb-3 border-t border-black/5 pt-3">
              <LocationPicker value={dropoff} onChange={setDropoff} />
            </div>
          )}
          <div className="mb-3 border-t border-black/5 pt-3">
            <label className="mb-1 block text-sm font-medium">Your mobile number</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)}
              inputMode="tel" placeholder="0917 123 4567"
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green" />
            <p className="mt-1 text-xs text-black/40">So the rider can reach you. No account needed.</p>
          </div>
          <div className="mb-3 border-t border-black/5 pt-3">
            <label className="mb-1 block text-sm font-medium">Note to the rider <span className="font-normal text-black/40">(optional)</span></label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="e.g. Extra spicy, leave at the gate, call when outside…"
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green" />
          </div>
          <div className="border-t border-black/5 pt-2">
            <Row label="Goods" value={peso(summary.goodsCost)} />
            <Row
              label={fees.model === 'per_km' ? 'Delivery fee (by distance)' : 'Delivery fee'}
              value={needsDropoff ? '—' : peso(summary.deliveryFee)}
            />
            {summary.storeFeeTotal > 0 && <Row label={`Store fee (${storeCount - 1} added)`} value={peso(summary.storeFeeTotal)} />}
            {summary.convenienceFee > 0 && <Row label="Convenience fee" value={peso(summary.convenienceFee)} />}
            <div className="mt-1 flex justify-between border-t border-black/5 pt-2 text-sm font-bold">
              <span>Total</span><span>{needsDropoff ? '—' : peso(summary.customerTotal)}</span>
            </div>
            {pay === 'online' && !needsDropoff && (
              <div className="mt-1 flex justify-between text-xs text-black/50">
                <span>Collected at door (goods)</span><span>{peso(collectibleAtDoor(summary, 'online'))}</span>
              </div>
            )}
          </div>
          <div className="mt-4"><PaymentChoice value={pay} onChange={setPay} /></div>
          <button onClick={checkout} disabled={needsDropoff || !contact.trim()}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-50">
            {needsDropoff ? 'Set delivery location to continue'
              : !contact.trim() ? 'Enter your mobile number'
              : pay === 'online' ? 'Pay online & order' : 'Place order (COD)'}
          </button>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between py-0.5 text-sm text-black/70"><span>{label}</span><span>{value}</span></div>;
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className="shrink-0 text-black/30"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
  );
}

function CatPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ${
        active ? 'bg-brand-green text-white shadow-sm' : 'bg-white text-black/60 ring-1 ring-black/10'
      }`}>
      {children}
    </button>
  );
}

/** Inline panel to pick a customized item (one/many choices per group). */
function Customizer({ item, onAdd }: { item: MenuItem; onAdd: (options: CartOption[]) => void }) {
  // selected choice names per group id — nothing pre-selected; the customer picks.
  const [sel, setSel] = useState<Record<string, string[]>>({});

  function pick(g: CustomGroup, name: string) {
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.multi) return { ...s, [g.id]: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
      return { ...s, [g.id]: [name] };
    });
  }

  const chosen: CartOption[] = item.groups.flatMap((g) =>
    (sel[g.id] ?? []).map((n) => ({ name: n, priceDelta: g.choices.find((c) => c.name === n)?.priceDelta ?? 0 })),
  );
  const missing = item.groups.some((g) => g.required && (sel[g.id] ?? []).length === 0);
  const total = item.price + chosen.reduce((s, o) => s + o.priceDelta, 0);

  return (
    <div className="mt-2 rounded-lg bg-black/[0.02] p-3">
      {item.groups.map((g) => (
        <div key={g.id} className="mb-3">
          <p className="mb-1 text-xs font-semibold text-black/70">
            {g.name}
            <span className="ml-1 font-normal text-black/40">{g.required ? '(required)' : '(optional)'}{g.multi ? ' · pick any' : ''}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.choices.map((c) => {
              const on = (sel[g.id] ?? []).includes(c.name);
              return (
                <button key={c.name} type="button" onClick={() => pick(g, c.name)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                    on ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'
                  }`}>
                  {c.name}{c.priceDelta !== 0 && <span className={on ? 'opacity-80' : 'text-black/40'}> {c.priceDelta > 0 ? '+' : ''}{peso(c.priceDelta)}</span>}
                </button>
              );
            })}
            {g.choices.length === 0 && <span className="text-xs text-black/30">No choices set.</span>}
          </div>
        </div>
      ))}
      <button onClick={() => onAdd(chosen)} disabled={missing}
        className="w-full rounded-lg bg-brand-green py-2 text-sm font-semibold text-white disabled:opacity-50">
        {missing ? 'Choose required options' : `Add to cart · ${peso(total)}`}
      </button>
    </div>
  );
}
