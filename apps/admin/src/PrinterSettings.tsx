import { useEffect, useState } from 'react';
import { errMessage } from '@ebd/shared';
import { getAppSettings, updateAppSettings } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import {
  choosePrinter, forgetPrinter, lastPrinterName, paperWidth, setPaperWidth,
  printingSupport,
} from './lib/printer.ts';
import { TestPrintButton, refreshShopIdentity } from './PrintReceipt.tsx';

const inp = 'w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green';

/**
 * Pairing a Bluetooth receipt printer, and saying plainly when the browser
 * simply cannot.
 *
 * Web Bluetooth is a narrow door: Chrome, over https, and never from an iPhone,
 * because Safari does not implement the API and no amount of wanting will
 * change that. Somebody standing at a counter with a printer that will not
 * pair deserves to be told which of those they have hit, rather than watching a
 * button do nothing.
 */
export function PrinterSettings() {
  const support = printingSupport();
  const [width, setWidth] = useState<32 | 48>(paperWidth() === 48 ? 48 : 32);
  const [name, setName] = useState<string | null>(lastPrinterName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // What the paper says above and below the bill.
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [footer, setFooter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    getAppSettings(supabase).then((s) => {
      setAddress(s.receipt_address ?? '');
      setContact(s.receipt_contact ?? '');
      setFooter(s.receipt_footer ?? '');
    }).catch(() => { /* pre-0083 database; the fields simply stay blank */ });
  }, []);

  async function saveHeader() {
    if (!supabase) return;
    setSaving(true); setErr(null); setSaved(false);
    try {
      await updateAppSettings(supabase, {
        receipt_address: address.trim() || null,
        receipt_contact: contact.trim() || null,
        receipt_footer: footer.trim() || null,
      });
      refreshShopIdentity();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr(errMessage(e)); }
    finally { setSaving(false); }
  }

  async function pair() {
    setBusy(true); setErr(null);
    try { setName(await choosePrinter()); }
    catch (e) {
      const msg = errMessage(e);
      // Dismissing the picker is a decision, not an error worth shouting about.
      if (!/cancell?ed|User cancelled|chooser|No device selected/i.test(msg)) setErr(msg);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h3 className="font-semibold">Receipt printer</h3>
      <p className="mb-3 mt-0.5 text-sm text-black/55">
        A Bluetooth thermal printer, for handing a customer a paper receipt at the counter.
      </p>

      {/* Worth setting whether or not this device can print — the receipt is
          the same on every till, and a slip with no way to find you again is
          not much of a record. */}
      <div className="mb-4 space-y-2 rounded-xl bg-black/[0.02] p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-black/45">What the receipt says</p>
        <label className="block text-xs font-medium text-black/60">Shop address
          <input className={inp + ' mt-1'} value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Mabical, Floridablanca, Pampanga" /></label>
        <label className="block text-xs font-medium text-black/60">Phone number
          <input className={inp + ' mt-1'} value={contact} onChange={(e) => setContact(e.target.value)}
            placeholder="0917 000 0000" /></label>
        <label className="block text-xs font-medium text-black/60">Footer line
          <input className={inp + ' mt-1'} value={footer} onChange={(e) => setFooter(e.target.value)}
            placeholder="Thank you for ordering!" /></label>
        <div className="flex items-center gap-3">
          <button onClick={() => void saveHeader()} disabled={saving || !supabase}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-green-700">✓ Saved</span>}
        </div>
        <p className="text-[11px] text-black/40">Leave a line blank and it is left off the paper.</p>
      </div>

      {!support.ok ? (
        <p className="rounded-lg bg-brand-yellow/20 px-3 py-2.5 text-sm ring-1 ring-brand-yellow">
          {support.detail}
        </p>
      ) : (
        <>
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-black/60">Paper width</p>
            <div className="flex flex-wrap gap-1.5">
              {([32, 48] as const).map((w) => (
                <button key={w} onClick={() => { setWidth(w); setPaperWidth(w); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
                    width === w ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'
                  }`}>
                  {w === 32 ? '58 mm (32 columns)' : '80 mm (48 columns)'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-black/40">
              58 mm is the small handheld roll most stalls use. Wrong setting and the prices won’t line up.
            </p>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => void pair()} disabled={busy}
              className="rounded-lg border border-black/15 px-3 py-2 text-sm font-medium disabled:opacity-50">
              {busy ? 'Pairing…' : name ? 'Pair a different printer' : 'Pair a printer'}
            </button>
            {name && (
              <>
                <span className="text-sm text-black/60">
                  Last used: <span className="font-medium text-black/80">{name}</span>
                </span>
                <button onClick={() => { forgetPrinter(); setName(null); }}
                  className="text-xs text-black/40 underline">Forget</button>
              </>
            )}
          </div>

          {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          <TestPrintButton />

          <p className="mt-3 text-xs text-black/40">
            Turn the printer on and hold it near this device. Your browser will ask which one to use —
            pick the name printed on the case. Printing works in Chrome on Android or a computer; iPhone
            and iPad can’t, because Safari doesn’t support Web Bluetooth.
          </p>
        </>
      )}
    </div>
  );
}
