# MOSAIC web app

Next.js 16 (App Router, TypeScript, Tailwind) with its own server backend. Shared data lives in Upstash Redis. The contract rules run in a fast simulation, and when the server has testnet keys the main actions are also sent to the real Soroban contract (see the [root README](../README.md)).

## Run

```sh
npm install
npm run dev        # http://localhost:3000, no keys needed (data in .local-data/)
npm run build      # production build
npm test           # engine + cloud + browser tests (browser tests need Google Chrome)
```

## Environment variables (names only; never commit values)

| Variable | Needed for |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared cloud data on Vercel (required there) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Emailed one-time codes for issuer sign-up |
| `RESET_PASSWORD` | Password for "Reset the demo". Leave unset to let anyone reset it |
| `STELLAR_SECRET_ADMIN`, `_SUPPLIER`, `_PAYMENT_APP`, `_QUICKSUPPLY`, `_SELFDEALER`, `_LENDER` | Testnet keys. With them, actions are also sent to the contract (mark them Secret in Vercel) |
| `MOSAIC_CONTRACT_ID`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Optional; defaults point at the testnet contract |
| `CHAIN_MIRROR=off`, `AUTO_DEMO=off`, `MAX_CODES_PER_HOUR` | Optional switches |

Check a deployment at `/api/health`: it shows storage, email, whether the reset is protected, and `chain` (`mirroring_to_testnet` or `simulation_only`).

## Deploy to Vercel

1. Import the repo, set **Root Directory** to `web` (framework: Next.js).
2. Add Upstash Redis from the Vercel Storage tab (adds the two Redis variables).
3. Add the other variables above, then redeploy.
4. Open `/api/health`, then press **Reset the demo** once.

## Folder map

```
app/            pages: / (landing), my-shop, issuer, lender, admin, shop/[id]; api/ (health, reset, rpc, version)
components/     UI pieces (Shell, ui, OnChainPanel, TxRef, CheckList, TrustGraph, ...)
lib/engine/     the contract simulation + rules: contract.ts, backend.ts, rules.ts, loans.ts, onboarding.ts, demo.ts, data.ts
lib/server/     chain.ts (testnet bridge), storage.ts (Redis), email.ts, log.ts
lib/mock/       the browser's client for the server (the pages only talk to this)
lib/            small helpers: format, session, checks, lender, hooks, useChainMode
tests/          engine tests (*.test.ts), cloud stand-ins, browser test (e2e.mjs)
screenshots/    proof screenshots at 1440px (d-*) and 390px (m-*)
```

## The six checks

1 issuer registry (contract) · 2 payment match and 4 net flow (payment-app records, never the supplier's own numbers) · 3 independence from the shop · 5 30 USDC stake (contract) · 6 stacking counter (contract). Rules are in `lib/engine/rules.ts`.
