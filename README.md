# MOSAIC

**A business shouldn't need a credit history to prove it has a real economic history.**

Small shops (Indian kiranas) with no credit file get **verifiable credentials** from the businesses they already trade with: their **suppliers** ("regular buyer for 18 months, pays on time") and **payment providers** ("UPI receipts above Rs 50,000/month for 6 months", conclusion only). Microfinance **lenders pay 1 USDC** to verify a shop, and the fee is split among the issuers. Shops pay nothing and never touch crypto. Missing evidence means **Unknown**, never "bad".

Built for the *Blockchain Innovation Challenge powered by Stellar*, Problem Space 2: Verification Infrastructure for the Next Billion Customers.

## What's in this repo

| Folder | What | Status |
|---|---|---|
| [`web/`](web/) | The app: Next.js site + server backend, cloud data (Upstash Redis), real email codes (Resend), logs, reset | Complete flow for shopkeepers, issuers, lenders and the admin, with a minimalist responsive design. **The blockchain is simulated on the server** with the contract's rules. See [`web/README.md`](web/README.md). |
| [`contracts/mosaic/`](contracts/mosaic/) | The Soroban smart contract (Rust) | In progress: issuer registry, credentials with a 30 USDC stake, revoke, expiry. Tests pass (`cargo test`). Not yet deployed. |

## How it works

1. **Issuers apply.** A supplier or payment provider submits its details and verifies its email with a 6-digit code. Automatic checks run (GST / RBI registration, applicant is the registered owner, contact matches the registry, bank name, trading history, independence from shops, blacklist). The admin approves, optionally after a manual review.
2. **Issuers vouch.** An approved issuer signs a one-line claim about a shop and **locks 30 USDC** behind it. Only the conclusion and a hash of the evidence are recorded.
3. **Lenders verify.** A lender pays 1 USDC and sees every credential with six fraud checks: (1) issuer registry, (2) payment match ≥ 70%, (3) independence, (4) net flow minus round-trips, (5) stake at risk, (6) how many lenders checked this shop in 30 days.
4. **The admin checks the shop against its receipts.** Month by month: the payments behind each claim, money that came straight back, whether purchases fit sales, and whether the issuers are independent of each other. Verdict: looks genuine / needs review / not enough evidence.
5. **False claims cost money.** A lender disputes. If the admin upholds it, the stake goes to the lender, and 2 upheld disputes suspend the issuer.

## Run it

```sh
cd web && npm install && npm run dev      # http://localhost:3000 (works with no keys)
cargo test                                # contract tests, from the repo root
```

Deploying the app (Vercel + Upstash + Resend, step by step): see [`web/README.md`](web/README.md#deploy-to-vercel-step-by-step).

## Honest limits

- The web app does not talk to Stellar yet. Its server runs the same rules as the contract, so the flow can be shown end to end. The next step is connecting the deployed contract and a wallet (`web/README.md` > "Connecting the real contract").
- Without wallets, "Acting as" lets any visitor play any role. That's fine for a demo, and wallet signatures will fix it.
- Registry lookups (GST, RBI, sales) and payment records are fake demo data.
- Not a KYC replacement: MOSAIC shows trading relationships, not identity.
