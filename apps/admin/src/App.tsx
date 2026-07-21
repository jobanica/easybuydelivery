import { useState } from 'react';
import { isSupabaseConfigured } from './lib/supabase.ts';
import { Dashboard } from './Dashboard.tsx';
import { Stores } from './Stores.tsx';
import { RiderApplications } from './RiderApplications.tsx';
import { LiveOrders } from './LiveOrders.tsx';
import { Settlements } from './Settlements.tsx';
import { Settings } from './Settings.tsx';
import { Broadcast } from './Broadcast.tsx';
import { OrderHistory } from './OrderHistory.tsx';
import {
  IconDashboard, IconStore, IconRiders, IconOrders, IconHistory, IconWallet,
  IconSettings, IconMegaphone, IconSearch, IconMenu, IconScooter,
} from './icons.tsx';

type Tab = 'dashboard' | 'stores' | 'riders' | 'orders' | 'history' | 'settlements' | 'settings' | 'broadcast';

const NAV: { key: Tab; label: string; icon: () => React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { key: 'stores', label: 'Stores & menus', icon: IconStore },
  { key: 'riders', label: 'Rider applications', icon: IconRiders },
  { key: 'orders', label: 'Live orders', icon: IconOrders },
  { key: 'history', label: 'Order history', icon: IconHistory },
  { key: 'settlements', label: 'Settlements', icon: IconWallet },
  { key: 'broadcast', label: 'Broadcast SMS', icon: IconMegaphone },
  { key: 'settings', label: 'Settings', icon: IconSettings },
];

const TITLES: Record<Tab, string> = {
  dashboard: 'Dashboard', stores: 'Stores & menus', riders: 'Rider applications',
  orders: 'Live orders', history: 'Order history', settlements: 'Settlements',
  broadcast: 'Broadcast SMS', settings: 'Settings',
};

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [open, setOpen] = useState(false); // mobile sidebar

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-brand-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-brand-green text-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 hover:bg-white/15 lg:hidden">
            <IconMenu />
          </button>
          <div className="flex items-center gap-2 font-extrabold text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20"><IconScooter /></span>
            Easy Buy
          </div>
          <div className="mx-auto hidden max-w-md flex-1 items-center gap-2 rounded-xl bg-white/15 px-3 py-2 md:flex">
            <span className="opacity-90"><IconSearch /></span>
            <input placeholder="Search orders, riders, stores"
              className="w-full bg-transparent text-sm text-white placeholder-white/70 outline-none" />
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-xl bg-white/15 py-1 pl-1 pr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-purple text-xs font-bold">EB</span>
            <span className="text-sm font-semibold">Admin</span>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-20 w-60 transform bg-white pt-16 shadow-lg transition-transform lg:static lg:translate-x-0 lg:pt-0 lg:shadow-none ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <nav className="p-4">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-black/40">Main Menu</p>
            <ul className="space-y-1">
              {NAV.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <li key={key}>
                    <button onClick={() => { setTab(key); setOpen(false); }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        active ? 'bg-brand-green text-white shadow-sm' : 'text-black/60 hover:bg-black/[0.04]'
                      }`}>
                      <Icon />
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* Backdrop for mobile */}
        {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-10 bg-black/30 lg:hidden" />}

        {/* Content */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold">{TITLES[tab]}</h1>
            <p className="text-sm text-black/50">Easy Buy Delivery — operator console</p>
          </div>

          {!isSupabaseConfigured && (
            <p className="mb-4 rounded-xl border border-brand-yellow bg-brand-yellow/20 px-3 py-2 text-sm">
              Preview mode — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to load live data.
            </p>
          )}

          {tab === 'dashboard' && <Dashboard onNavigate={(t) => setTab(t as Tab)} />}
          {tab === 'stores' && <Stores />}
          {tab === 'riders' && <RiderApplications />}
          {tab === 'orders' && <LiveOrders />}
          {tab === 'history' && <OrderHistory />}
          {tab === 'settlements' && <Settlements />}
          {tab === 'broadcast' && <Broadcast />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
