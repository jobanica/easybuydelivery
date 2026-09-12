import { useEffect, useRef, useState } from 'react';
import { isInstalledApp } from '@ebd/supabase';
import { isInAppBrowser, inAppBrowserName, isAndroid, openInChrome } from './inAppBrowser.tsx';
import { isIOS } from './geo.ts';

/**
 * The Chrome/Android install event, which the browser fires at most once and
 * only when it judges the app installable. Capturing it is the only way to show
 * an install button at a moment of our choosing rather than Chrome's.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SNOOZE_KEY = 'ebd.customer.installSnoozedUntil';
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch { return false; }
}

function snooze(): void {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)); }
  catch { /* private mode — it'll ask again, which is survivable */ }
}

/**
 * "Install Easy Buy Delivery" — the banner that turns a browser tab into an
 * app on the home screen.
 *
 * Three different browsers, three different truths:
 *
 *  - Chrome on Android fires `beforeinstallprompt`, so there is a real button
 *    that opens the real install dialog.
 *  - Safari on iOS has no such event and never will. The only route is Share →
 *    Add to Home Screen, so all we can do is say so, clearly.
 *  - Messenger and Instagram's in-app browsers cannot install anything at all.
 *    Offering a button there would be a lie; the honest move is to send them to
 *    Chrome.
 *
 * Waits a few seconds before appearing — a banner that beats the page to the
 * screen reads as an ad for something the customer hasn't seen yet.
 */
/** How long to wait for `appinstalled` before assuming the install failed. */
const INSTALL_TIMEOUT_MS = 12_000;

export function InstallApp() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(() => snoozed() || isInstalledApp());
  const [iosHelp, setIosHelp] = useState(false);
  // Accepting the dialog is not the same as ending up with an app. Play Protect
  // blocks the install outright on some devices, and the page is told nothing.
  const [blocked, setBlocked] = useState(false);
  const installed = useRef(false);
  const waitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Without preventDefault Chrome shows its own mini-infobar and we lose
      // the event, which is how "install" ends up buried in a browser menu.
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
    };
    const onInstalled = () => { installed.current = true; setGone(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const t = setTimeout(() => setReady(true), 3500);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(t);
      if (waitRef.current) clearTimeout(waitRef.current);
    };
  }, []);

  if (gone || (!ready && !blocked)) return null;

  const inApp = isInAppBrowser();
  const ios = isIOS();
  // Nothing to offer: a desktop browser, or one that never fired the event.
  if (!evt && !ios && !inApp && !blocked) return null;

  function dismiss() { snooze(); setGone(true); }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // Declined is an answer. Asking again tomorrow is how a banner becomes an
    // advert people learn to swipe away without reading.
    if (outcome === 'dismissed') { dismiss(); setEvt(null); return; }
    setEvt(null);
    // They said yes — but Android may still refuse. `appinstalled` is the only
    // proof it worked, and nothing tells us when it didn't, so wait and assume
    // the worst rather than leaving them staring at a banner that vanished.
    waitRef.current = setTimeout(() => {
      if (!installed.current) setBlocked(true);
    }, INSTALL_TIMEOUT_MS);
  }

  return (
    <div className="fixed inset-x-0 bottom-[4.25rem] z-40 px-3 pb-1">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-3 shadow-lg ring-1 ring-black/10">
        <div className="flex items-start gap-3">
          <img src="/icons/pwa-192x192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-black/10" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-brand-ink">
              {blocked ? 'Your phone blocked the install' : 'Install Easy Buy Delivery'}
            </p>
            <p className="mt-0.5 text-xs text-black/55">
              {blocked
                ? 'Nothing is wrong with your phone or with us — there\'s another way in.'
                : inApp
                  ? `Opening in ${inAppBrowserName()} — install from Chrome instead.`
                  : 'Add it to your home screen: opens full screen, remembers your address, no browser bar.'}
            </p>
          </div>
          <button onClick={dismiss} aria-label="Not now"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-black/35">×</button>
        </div>

        {blocked ? (
          <div className="mt-2.5 space-y-2">
            <ol className="space-y-1 rounded-xl bg-brand-green/[0.06] p-3 text-xs text-black/70">
              <li>1. Tap the <b>⋮</b> menu at the top right of Chrome.</li>
              <li>2. Tap <b>Add to Home screen</b>, then <b>Add</b>.</li>
              <li>3. The Easy Buy icon appears with your other apps.</li>
            </ol>
            <p className="text-[11px] text-black/45">
              This keeps you signed in and puts us one tap away. To get the full app instead,
              update Chrome and the Play Store from Google Play, then try Install again.
            </p>
            <button onClick={dismiss}
              className="w-full rounded-xl border border-black/10 py-2 text-xs font-semibold text-black/60">
              Got it
            </button>
          </div>
        ) : inApp ? (
          <div className="mt-2.5 flex gap-2">
            {isAndroid() && (
              <button onClick={openInChrome}
                className="flex-1 rounded-xl bg-brand-green py-2.5 text-sm font-bold text-white">
                Open in Chrome
              </button>
            )}
            {!isAndroid() && (
              <p className="text-xs text-black/55">
                Tap the ••• menu at the top right, then <b>Open in browser</b>, and install from there.
              </p>
            )}
          </div>
        ) : evt ? (
          <button onClick={() => void install()}
            className="mt-2.5 w-full rounded-xl bg-brand-green py-2.5 text-sm font-bold text-white">
            Install app
          </button>
        ) : (
          <>
            <button onClick={() => setIosHelp((v) => !v)}
              className="mt-2.5 w-full rounded-xl bg-brand-green py-2.5 text-sm font-bold text-white">
              {iosHelp ? 'Hide the steps' : 'Show me how'}
            </button>
            {iosHelp && (
              <ol className="mt-2 space-y-1 rounded-xl bg-brand-green/[0.06] p-3 text-xs text-black/70">
                <li>1. Tap the <b>Share</b> button at the bottom of Safari — the square with an arrow going up.</li>
                <li>2. Scroll down and tap <b>Add to Home Screen</b>.</li>
                <li>3. Tap <b>Add</b>. The Easy Buy icon appears with your other apps.</li>
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
