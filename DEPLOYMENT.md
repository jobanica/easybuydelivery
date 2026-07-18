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

### Notes / current limits

- The apps are browsable (public store/menu reads) but **placing orders needs an
  authenticated customer** — the signup/OTP flow (open decision #8) is not built
  yet, so anon order inserts are correctly blocked by RLS.
- Live tracking uses Supabase Realtime; a real rider publishing GPS requires the
  rider app running with location permission.
