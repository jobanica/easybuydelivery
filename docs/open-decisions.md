# Open Decisions

Track these before / while building. Recommendations noted where the spec gives one.

| # | Decision | Options | Recommendation / status |
|---|---|---|---|
| 1 | **Commission formula** | — | ✅ **RESOLVED:** `(Delivery Fee + ₱25 × added stores) × 15%` |
| 2 | **Convenience fee treatment** | Inside the 15% base, or flat pass-through to admin | **Flat pass-through** (simpler, more common) unless operator says otherwise |
| 3 | **Delivery fee model** | Flat, per-km, or per-zone | Open — affects both the customer quote and the 15% math |
| 4 | **Rider float / cash risk** | — | Define: **daily cutoff time** for settlement; **settlement method** (GCash/cash/bank) + manual-confirm vs auto-verify; **cancellation/no-show policy** (rider out real cash if customer cancels after pickup or refuses at door) |
| 5 | **Pabili over-budget** | — | Define the rule when actual cost exceeds the customer's cap (confirm with customer / buffer / rider absorbs) |
| 6 | **Online payment provider** | PayMongo vs Xendit vs direct GCash/Maya | Also: rider QR — personal GCash/Maya QR **or** platform-generated QR routing to operator? Big difference — **decides who the money lands on first** and whether commission stays off the rider's books |
| 7 | **Rider assignment** | First-come-accept (open pool), admin-assigned, or nearest-rider auto-dispatch | Open |
| 8 | **Customer accounts** | Full signup, or phone + OTP lightweight | **Phone + OTP** likely better for a municipality audience |
| 9 | **Live tracking transport** | Supabase Realtime (rider lat/lng every few sec) vs lightweight websocket | **Supabase Realtime**, **3–5s** update interval. Map: Google (best PH coverage, costs per load) vs **Mapbox / Leaflet + OSM** (near-zero cost for municipality scale). Track **only during active delivery** |

## Notes on the cash-risk decisions (#4)

The rider fronts real money for goods **and** holds the operator's commission
until daily settlement. The unresolved pieces:

- **Daily cutoff time** — when "the day" rolls over and yesterday's balance
  becomes due (midnight vs start of next operating day).
- **Settlement payment method** — GCash/Maya to operator's number, cash drop, or
  bank; then admin manual-confirm or auto-verify by reference.
- **Cancellation / no-show policy** — what happens when a customer cancels after
  pickup or refuses to pay at the door and the rider is out real cash.

## Notes on payment routing (#6)

- **Personal rider QR** → money lands on the rider → that order **still generates
  a settlement balance** (rider holds operator's cut).
- **Platform-routed QR** → money lands on the operator → **no settlement balance**
  for that order (like any online payment).

This choice interacts directly with the settlement ledger (see
[commission-and-settlement.md](commission-and-settlement.md)).
