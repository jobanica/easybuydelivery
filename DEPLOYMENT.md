# Deployment

## Live URLs

| App | URL | Backend |
|---|---|---|
| Customer web | https://ebd-customer-web.vercel.app | Supabase project `difvleyqqixettmbkkno` |
| Admin dashboard | https://ebd-admin.vercel.app | same |

Both are static Vite SPAs on Vercel, talking to the hosted Supabase project over
its REST/Realtime API with the public **anon** key. Row Level Security governs
access; the anon key is safe to ship in the client bundle.

## Supabase (backend)

The schema lives in [`supabase/migrations/`](supabase/migrations) (`0001`–`0006`).
Apply it to a project with the CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

`0006_grants.sql` is required — without the table GRANTs, PostgREST returns
"permission denied" even with RLS policies in place.

## Vercel (frontends)

Each app is a static build. Environment (baked in at build time by Vite):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Build and deploy one app (from the repo root):

```bash
# hosted env in apps/<app>/.env, then:
npm run build --workspace @ebd/<app>        # -> apps/<app>/dist
cd apps/<app>/dist && vercel deploy --prod --yes
```

`vercel.json` in each app adds an SPA rewrite so any path serves `index.html`.

## Google Play Store (Android)

The Play Store only accepts signed Android App Bundles (`.aab`) — you wrap each
web app in a native shell. Two shells, matched to each app's needs.

### Prerequisites (one-time, account-bound)

- **Google Play Developer account** — $25 one-time at play.google.com/console.
- **Signing key** — generate a keystore (or use Play App Signing); keep it safe.
- **Privacy policy URL**, Data safety form (location + phone), content rating.

### Customer app → TWA (wraps the installable PWA)

The customer app is a full PWA (manifest + service worker + icons). Wrap it with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://ebd-customer-web.vercel.app/manifest.webmanifest
bubblewrap build          # produces app-release-signed.aab
```

Then publish `/.well-known/assetlinks.json` on the domain with the **SHA-256
fingerprint** of your signing key (template committed at
`apps/customer-web/public/.well-known/assetlinks.json` — replace the placeholder,
package `com.easybuydelivery.customer`). This removes the browser URL bar.

### Rider app → Capacitor (native, background GPS)

The rider app is wrapped with Capacitor (`apps/rider/android/`), appId
`com.easybuydelivery.rider`. It needs background location, which a TWA can't do.

```bash
cd apps/rider
npm run build && npx cap sync android
npx cap open android      # Android Studio: Build > Generate Signed Bundle / AAB
```

The manifest already declares `ACCESS_FINE_LOCATION`,
`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, and
`POST_NOTIFICATIONS`. **`useLocationPublisher`** uses the Capacitor Geolocation
plugin on native and the browser API on web.

- ⚠️ **Background location review:** Google reviews `ACCESS_BACKGROUND_LOCATION`
  strictly — justify it with the live delivery-tracking use case and usually
  submit a short screen recording. Budget extra review time.
- **App-closed tracking is wired** via `@capacitor-community/background-geolocation`.
  On native, `useLocationPublisher` starts a foreground-service watcher (persistent
  notification) that keeps streaming location to the order's Realtime channel even
  when the app is backgrounded or closed; the web build polls in the foreground.
  The watcher auto-starts on pickup and stops on delivery, so location is never
  shared while idle.

### Upload

Play Console → create app → complete the forms → upload the `.aab` to an internal
testing track → promote to production after review.

## Incoming-order notifications (rider)

Two layers:

1. **Live (app open)** — the rider app subscribes to Supabase Realtime
   (`subscribeToNewOrders`, `postgres_changes` on `orders` INSERT). A banner shows
   and the pool refreshes instantly. `orders` is in the `supabase_realtime`
   publication (migration `0007`). Note: Realtime honours RLS, so the rider must
   be signed in for pool visibility.
2. **App closed** — FCM push. The native app registers on launch
   (`usePushRegistration`) and stores its token in `rider_push_tokens`. A server
   Edge Function sends the push:

```bash
# one-time: create a Firebase project, get the FCM server key
supabase secrets set FCM_SERVER_KEY=<key>
supabase functions deploy notify-riders
# Dashboard → Database → Webhooks: on orders INSERT → call notify-riders
```

The function (`supabase/functions/notify-riders`) reads approved/unlocked riders'
tokens and pushes the order summary. Adjust the audience query to your
rider-assignment model (open decision #7).

## Store SMS on a new order (optional)

Text each store its items when a food order comes in — complements the rider
call, off by default (preserves the no-merchant-onboarding model).

```bash
# enable the toggle
update app_settings set sms_notify_stores = true;
# secrets
supabase secrets set SEMAPHORE_API_KEY=<key>       # https://semaphore.co
supabase secrets set SEMAPHORE_SENDER_NAME=EasyBuy # optional, must be registered
supabase functions deploy notify-store
# Dashboard → Database → Webhooks: on orders INSERT → call notify-store
```

`supabase/functions/notify-store` groups `order_items` by `store_id`, composes
the message (`composeStoreOrderSms` in `@ebd/shared`), and sends via Semaphore to
each store's `contact_number` (stores without a number are skipped — the rider
still calls). Only fires for food orders when the toggle is on.

## Authentication (phone OTP)

Both apps gate real actions behind Supabase Auth phone OTP:

- Customer: `AuthGate` → sign in → `ensureCustomer` → orders use the authenticated
  customer id (RLS-permitted).
- Rider: `RiderGate` → sign in → `ensureRider` (application `pending`) → the app
  unlocks once an admin approves; the pool is RLS-filtered to the signed-in rider.

**Enable it in production:** configure an SMS provider (Dashboard → Authentication
→ Providers → Phone; e.g. Twilio). Without a provider, OTP codes can't be
delivered. Email OTP works with the built-in mailer if you prefer email sign-in.

> The public customer deploy currently runs the **pre-auth build** (browsable
> without sign-in) so it's demoable before an SMS provider is set up. Redeploy the
> auth build once the provider is configured.

## Notes / current limits

- The apps are browsable (public store/menu reads) but **placing orders needs an
  authenticated customer** — the signup/OTP flow (open decision #8) is not built
  yet, so anon order inserts are correctly blocked by RLS.
- Live tracking uses Supabase Realtime; a real rider publishing GPS requires the
  rider app running with location permission.
