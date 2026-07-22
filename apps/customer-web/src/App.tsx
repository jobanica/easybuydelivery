import { useEffect, useState } from 'react';
import { getAppSettings } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { PadalaForm } from './PadalaForm.tsx';
import { PabiliForm } from './PabiliForm.tsx';
import { FoodFlow } from './FoodFlow.tsx';
import { TrackingMap } from './tracking/TrackingMap.tsx';
import { useAuth } from './auth/AuthContext.tsx';

type Service = 'food' | 'pabili' | 'padala';
type ServiceAvailability = Record<Service, boolean>;
const ALL_ON: ServiceAvailability = { food: true, pabili: true, padala: true };

// Demo route for the tracking preview (a municipality-scale hop).
const DEMO_PICKUP = { lat: 14.170, lng: 121.240 };
const DEMO_DROPOFF = { lat: 14.186, lng: 121.256 };

export function App() {
  const { live, signOut } = useAuth();
  const [service, setService] = useState<Service>('food');
  const [tracking, setTracking] = useState(false);
  const [enabled, setEnabled] = useState<ServiceAvailability>(ALL_ON);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;
    getAppSettings(supabase)
      .then((s) => setEnabled({ food: s.service_food, pabili: s.service_pabili, padala: s.service_padala }))
      .catch(() => { /* keep all-on if settings can't load */ });
  }, []);

  // If the selected service gets turned off, fall back to the first enabled one.
  useEffect(() => {
    if (enabled[service]) return;
    const firstOn = (['food', 'pabili', 'padala'] as Service[]).find((k) => enabled[k]);
    if (firstOn) setService(firstOn);
  }, [enabled, service]);

  const noneEnabled = !enabled.food && !enabled.pabili && !enabled.padala;
  return (
    <div className="min-h-screen">
      <header className="bg-brand-green text-white">
        <div className="mx-auto max-w-xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Easy Buy Delivery</h1>
            <p className="text-sm/5 opacity-90">Pabili • Padala Delivery Services</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setTracking((t) => !t)}
              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium">
              {tracking ? 'Back to ordering' : 'Track a delivery'}
            </button>
            {live && (
              <button onClick={() => void signOut()}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium">
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      {!tracking && (
        <div className="mx-auto max-w-xl px-5">
          <nav className="mt-4 flex gap-2">
            <ServiceTab active={service === 'food'} disabled={!enabled.food} onClick={() => setService('food')}>Order Food</ServiceTab>
            <ServiceTab active={service === 'pabili'} disabled={!enabled.pabili} onClick={() => setService('pabili')}>Pabili</ServiceTab>
            <ServiceTab active={service === 'padala'} disabled={!enabled.padala} onClick={() => setService('padala')}>Send Padala</ServiceTab>
          </nav>
        </div>
      )}

      <main className="mx-auto max-w-xl px-5 py-5">
        {!isSupabaseConfigured && (
          <p className="mb-4 rounded-lg border border-brand-yellow bg-brand-yellow/20 px-3 py-2 text-sm">
            Preview mode — set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to place real orders.
          </p>
        )}
        {tracking ? (
          <TrackingMap pickup={DEMO_PICKUP} dropoff={DEMO_DROPOFF} onClose={() => setTracking(false)} />
        ) : noneEnabled ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-black/60 shadow-sm ring-1 ring-black/5">
            All services are temporarily unavailable. Please check back soon.
          </p>
        ) : !enabled[service] ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-black/60 shadow-sm ring-1 ring-black/5">
            This service is temporarily unavailable.
          </p>
        ) : (
          <>
            {service === 'food' && <FoodFlow />}
            {service === 'pabili' && <PabiliForm />}
            {service === 'padala' && <PadalaForm />}
          </>
        )}
      </main>
    </div>
  );
}

function ServiceTab({ active, onClick, children, disabled = false }:
  { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      title={disabled ? 'Temporarily unavailable' : undefined}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
        disabled ? 'cursor-not-allowed bg-black/[0.04] text-black/30 line-through'
        : active ? 'bg-brand-purple text-white' : 'bg-white text-black/60 ring-1 ring-black/10'
      }`}>
      {children}
    </button>
  );
}
