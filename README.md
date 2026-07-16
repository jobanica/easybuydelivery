# Easy Buy Delivery

**Pabili • Padala Delivery Services**

A local, single-municipality delivery platform built as a set of thin frontends
over one shared Supabase backend. It runs three service types — **Food**,
**Pabili** (buy-anything), and **Padala** (point-to-point courier) — on a single
rider network.

The defining model: **no merchant onboarding.** Stores are not partners and do
not log in. The admin manually adds every store and its menu. Riders act as the
bridge — they call the store, pay for the goods out of their own pocket, deliver,
then collect from the customer on delivery.

---

## Why this design

- **Near-zero operator overhead.** No merchant relationships to manage; the admin
  owns all store/menu data.
- **One rider serves multiple stores per trip** (up to 3), which drives the
  per-store fee in the commission math.
- **One backend, several frontends.** A web order and a mobile order are identical
  rows in the same queue — no syncing to build.

## The three apps (roles)

| App | Who | Purpose |
|---|---|---|
| **Customer** | The buyer | Browse stores/menus, place Food / Pabili / Padala orders, pay COD or online, track the rider live. Ships as a **native mobile app** and a **web ordering site**. |
| **Rider** | The courier | Receive & accept orders, call the store, front cash for goods, deliver, collect payment, settle daily commission. |
| **Admin** | The operator | Add stores + menus, manage riders, set fees/commission, control operating hours, monitor orders, run settlements. |

## The three service types

| Service | What it is | Customer pays | Rider fronts cash? |
|---|---|---|---|
| **Food** | Order from stores the admin added | Goods cost + delivery fee | Yes |
| **Pabili** | "Buy this for me" — anything | Actual goods cost (per receipt) + delivery fee | Yes |
| **Padala** | Point-to-point courier, nothing bought | Delivery fee only | No |

Padala is the **lowest-risk service to launch first** — no rider cash float.

## Commission (locked formula)

```
Commission = (Delivery Fee + ₱25 × number of added stores) × 15%
```

"Added stores" = stores beyond the first. Commission is charged on the
**delivery fee + store fees — never on the cost of goods** (goods are a straight
pass-through the rider fronts and the customer repays).

Because most orders are COD, the rider physically holds the operator's
commission. It is collected through a **daily settlement gate**: yesterday's
commission balance must be paid before the rider's account reactivates.

See [`docs/commission-and-settlement.md`](docs/commission-and-settlement.md) for
the full math and settlement flow.

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Multi-surface architecture, stack, how the shared backend works |
| [docs/service-flows.md](docs/service-flows.md) | Step-by-step flows for Food, Pabili, and Padala |
| [docs/commission-and-settlement.md](docs/commission-and-settlement.md) | Commission formula, convenience fee, rider settlement gate |
| [docs/data-model.md](docs/data-model.md) | Proposed tables, relationships, and key fields |
| [docs/feature-checklist.md](docs/feature-checklist.md) | Full feature list per app (Customer / Rider / Admin) |
| [docs/open-decisions.md](docs/open-decisions.md) | Decisions to lock before/while building |
| [docs/branding.md](docs/branding.md) | Brand palette and design direction |
| [docs/roadmap.md](docs/roadmap.md) | Suggested build order (Padala-first) |

## Suggested stack

- **Frontend:** React / Vite / TailwindCSS (web); React Native / Expo (native).
- **Backend/DB:** Supabase (Postgres + RLS + Realtime).
- **Payments (later):** PayMongo / Xendit.
- **SMS/OTP:** Semaphore.
- **Deploy:** Vercel / Railway.

Ship as one PWA with role-based views first, split into native later where
background GPS is required (rider app).

## Status

This repository currently contains the **project overview and specification**.
No application code has been scaffolded yet — see
[docs/roadmap.md](docs/roadmap.md) for the proposed build order.
