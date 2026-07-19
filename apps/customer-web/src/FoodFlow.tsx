import { useEffect, useMemo, useState } from 'react';
import {
  summarizeCart,
  distinctStoreCount,
  collectibleAtDoor,
  MAX_STORES_PER_ORDER,
  type CartLine,
} from '@ebd/shared';
import { listAvailableStores, listMenu, buildFoodOrder, createFoodOrder } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { SAMPLE_STORES, type SampleStore } from './food/sampleData.ts';
import { peso, PaymentChoice, type PayChoice } from './ui.tsx';
import { useAuth } from './auth/AuthContext.tsx';

const DELIVERY_FEE = 50;

interface MenuItem { id: string; name: string; price: number; description?: string }
interface Store { id: string; name: string; category: string; items: MenuItem[] }

export function FoodFlow() {
  const { customerId, mobile } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pay, setPay] = useState<PayChoice>('cod');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (supabase && isSupabaseConfigured) {
          const rows = await listAvailableStores(supabase);
          const withMenus: Store[] = [];
          for (const s of rows as { id: string; name: string; category: string | null }[]) {
            const menu = await listMenu(supabase, s.id);
            withMenus.push({
              id: s.id, name: s.name, category: s.category ?? '',
              items: (menu.items as MenuItem[]),
            });
          }
          setStores(withMenus);
        } else {
          setStores(SAMPLE_STORES as SampleStore[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const summary = useMemo(() => summarizeCart(cart, DELIVERY_FEE), [cart]);
  const storeCount = distinctStoreCount(cart);
  const openStore = stores.find((s) => s.id === openStoreId) ?? null;

  function addToCart(store: Store, item: MenuItem) {
    setError(null);
    const existing = cart.find((l) => l.menuItemId === item.id);
    let next: CartLine[];
    if (existing) {
      next = cart.map((l) => (l.menuItemId === item.id ? { ...l, qty: l.qty + 1 } : l));
    } else {
      next = [...cart, { storeId: store.id, menuItemId: item.id, name: item.name, unitPrice: item.price, qty: 1 }];
    }
    if (new Set(next.map((l) => l.storeId)).size > MAX_STORES_PER_ORDER) {
      setError(`An order can span at most ${MAX_STORES_PER_ORDER} stores.`);
      return;
    }
    setCart(next);
  }

  function changeQty(menuItemId: string, delta: number) {
    setCart((c) =>
      c.map((l) => (l.menuItemId === menuItemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function checkout() {
    setError(null);
    const input = {
      customerId: customerId ?? 'preview-customer',
      customerContact: mobile || '09171234567',
      deliveryFee: DELIVERY_FEE,
      lines: cart,
      paymentMethod: (pay === 'online' ? 'online' : 'cod') as 'online' | 'cod',
      paid: pay === 'online',
    };
    try {
      if (supabase && isSupabaseConfigured) {
        setCreatedId(await createFoodOrder(supabase, input));
      } else {
        buildFoodOrder(input); // validates the cart locally
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
        <button onClick={() => { setCart([]); setCreatedId(null); setOpenStoreId(null); }}
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
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <button onClick={() => setOpenStoreId(null)} className="mb-3 text-sm text-brand-purple">← All stores</button>
          <h2 className="font-bold">{openStore.name}</h2>
          <p className="mb-3 text-xs text-black/50">{openStore.category}</p>
          <ul className="divide-y divide-black/5">
            {openStore.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="text-sm font-medium">{it.name}</span>
                  {it.description && <span className="block text-xs text-black/40">{it.description}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm">{peso(it.price)}</span>
                  <button onClick={() => addToCart(openStore, it)}
                    className="rounded-md bg-brand-green px-2.5 py-1 text-xs font-semibold text-white">Add</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="grid gap-3">
          {stores.map((s) => (
            <button key={s.id} onClick={() => setOpenStoreId(s.id)}
              className="flex items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-black/5 hover:ring-brand-green/40">
              <span>
                <span className="block font-semibold">{s.name}</span>
                <span className="text-xs text-black/50">{s.category}</span>
              </span>
              <span className="text-brand-purple">→</span>
            </button>
          ))}
        </section>
      )}

      {cart.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <h3 className="mb-2 font-bold">Your cart {storeCount > 1 && <span className="text-xs font-normal text-black/50">· {storeCount} stores</span>}</h3>
          <ul className="mb-3 divide-y divide-black/5">
            {cart.map((l) => (
              <li key={l.menuItemId} className="flex items-center justify-between py-2 text-sm">
                <span>{l.name}</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.menuItemId!, -1)} className="h-6 w-6 rounded bg-black/5">−</button>
                  <span className="w-4 text-center">{l.qty}</span>
                  <button onClick={() => changeQty(l.menuItemId!, +1)} className="h-6 w-6 rounded bg-black/5">+</button>
                  <span className="w-16 text-right font-medium">{peso(l.unitPrice * l.qty)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-black/5 pt-2">
            <Row label="Goods" value={peso(summary.goodsCost)} />
            <Row label="Delivery fee" value={peso(summary.deliveryFee)} />
            {summary.storeFeeTotal > 0 && <Row label={`Store fee (${storeCount - 1} added)`} value={peso(summary.storeFeeTotal)} />}
            <div className="mt-1 flex justify-between border-t border-black/5 pt-2 text-sm font-bold">
              <span>Total</span><span>{peso(summary.customerTotal)}</span>
            </div>
            {pay === 'online' && (
              <div className="mt-1 flex justify-between text-xs text-black/50">
                <span>Collected at door (goods)</span><span>{peso(collectibleAtDoor(summary, 'online'))}</span>
              </div>
            )}
          </div>
          <div className="mt-4"><PaymentChoice value={pay} onChange={setPay} /></div>
          <button onClick={checkout}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white transition hover:brightness-95">
            {pay === 'online' ? 'Pay online & order' : 'Place order (COD)'}
          </button>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between py-0.5 text-sm text-black/70"><span>{label}</span><span>{value}</span></div>;
}
