import { useState } from 'react';
import { isSupabaseConfigured } from './lib/supabase.ts';
import { PadalaForm } from './PadalaForm.tsx';
import { FoodFlow } from './FoodFlow.tsx';

type Service = 'food' | 'padala';

export function App() {
  const [service, setService] = useState<Service>('food');
  return (
    <div className="min-h-screen">
      <header className="bg-brand-green text-white">
        <div className="mx-auto max-w-xl px-5 py-4">
          <h1 className="text-xl font-bold tracking-tight">Easy Buy Delivery</h1>
          <p className="text-sm/5 opacity-90">Pabili • Padala Delivery Services</p>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-5">
        <nav className="mt-4 flex gap-2">
          <ServiceTab active={service === 'food'} onClick={() => setService('food')}>Order Food</ServiceTab>
          <ServiceTab active={service === 'padala'} onClick={() => setService('padala')}>Send Padala</ServiceTab>
        </nav>
      </div>

      <main className="mx-auto max-w-xl px-5 py-5">
        {!isSupabaseConfigured && (
          <p className="mb-4 rounded-lg border border-brand-yellow bg-brand-yellow/20 px-3 py-2 text-sm">
            Preview mode — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to place real orders.
          </p>
        )}
        {service === 'food' ? <FoodFlow /> : <PadalaForm />}
      </main>
    </div>
  );
}

function ServiceTab({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-brand-purple text-white' : 'bg-white text-black/60 ring-1 ring-black/10'
      }`}>
      {children}
    </button>
  );
}
