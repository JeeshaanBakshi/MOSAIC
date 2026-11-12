# MOSAIC web

The MOSAIC app: a Next.js site with its own server backend. Data is saved in the cloud (Upstash Redis) and shared by everyone, verification codes are sent by real email (Resend), and every action is logged.

**The blockchain is still simulated.** The server runs a faithful copy of the contract's rules (same functions, same errors), so the whole flow works today. Connecting the real Stellar contract later means swapping what happens behind the same function names (see "Connecting the real contract").

Next.js 16 · TypeScript · Tailwind · Lucide icons (the only icon set) · Hanken Grotesk · `@xyflow/react` (trust graph) · `sonner` (toasts) · `@upstash/redis` (cloud data) · Resend (email, called over its HTTP API).

## Design

A calm, minimalist look, set up so the whole interface uses **one hue family** (mineral pine) plus a single muted clay that only ever means "did not pass". Colours are tokens in `app/globals.css` (`paper`, `surface`, `ink`, `quiet`, `line`, `pine`, `clay`). Structure comes from hairlines and spacing rather than shadows or boxes, and only the one primary action on a page sits in a panel. Type is one family (Hanken Grotesk) with light large headings and tabular numerals for money. Status is never colour alone: every badge and check has an icon and a word. Keyboard focus is always visible, and reduced-motion is respected.

Layout adapts from a fixed side rail on large screens to a top bar with a drawer on tablets and phones. Tables scroll sideways inside their own container, so no page ever scrolls sideways (tested at 320, 390, 820 and desktop widths). All icons come from `lucide-react`. There are no emoji.

## Written for a Canadian audience, built for India

Amounts are in Indian rupees (₹) with standard digit grouping, with a rough Canadian-dollar equivalent (CA$) beside loan amounts. The rates in `lib/format.ts` are indicative constants, not quotes. Dates are Canadian style (Nov 11, 2026) and spelling is Canadian (authorized, neighbourhood). The home page defines the India-specific terms in plain words: kirana, UPI, GSTIN (not the Canadian GST), RBI, USDC and stake. USDC is described as "a digital US dollar".

## How it fits together

```
Browser (pages)  --->  lib/mock/index.ts   thin client: every call becomes POST /api/rpc
                              |
Server           --->  app/api/rpc         allow-list of functions, logs every write and every refusal
                       lib/engine/*        the rules: contract (fraud checks 1, 5, 6), backend (2-4), onboarding
                       lib/server/storage  Upstash Redis (cloud) with a lock, so two visitors never overwrite each other
                       lib/server/email    Resend: sends the 6-digit code
                       lib/server/log      one JSON line per event -> Vercel > Logs
```

| Route | What it does |
|---|---|
| `POST /api/rpc` | Runs one engine function: `{ "fn": "contract.verify", "args": [...] }` |
| `POST /api/reset` | **Wipes all data for everyone** (`{ "password": "...", "loadDemo": false }`) |
| `GET /api/version` | A number that goes up on every change. Open browsers poll it every 5 s and refresh themselves. |
| `GET /api/health` | Shows whether storage and email are wired up. Safe to open, never shows keys. |

## Run it locally

```sh
npm install
cp .env.example .env.local   # optional: fill in keys to use real Redis / real email
npm run dev                  # http://localhost:3000
```

With no keys set, it still works: data is saved to `.local-data/state.json`, and codes show in an on-screen "prototype inbox". **In production, cloud storage is required.** The app refuses to run on memory there, so nothing silently disappears.

## Deploy to Vercel (step by step)

1. **Push the repo to GitHub** (without `.env.local`, which is gitignored).
2. **Vercel > Add New > Project >** import the repo. Set **Root Directory = `web`**. The framework is detected as Next.js.
3. **Cloud data:** in the project, go to **Storage / Marketplace > Upstash for Redis > Create** and connect it to the project. This adds `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) automatically.
4. **Email:** create an API key at **resend.com > API Keys**. Add it in **Settings > Environment Variables** as `RESEND_API_KEY`.
   - With the default sender (`onboarding@resend.dev`), Resend only delivers to the email you signed up with. To email anyone (e.g. judges), verify a domain in Resend and set `EMAIL_FROM`, e.g. `MOSAIC <no-reply@yourdomain.com>`.
5. **Reset password:** set `RESET_PASSWORD` before you share the link, so a visitor can't wipe everything.
6. **Deploy.** Then open `https://<your-app>/api/health`. You want `"ok": true`, `"storage": "redis"`, `"email": "configured"`, `"resetProtected": true`.
7. Open the site, press **Reset all data** once (or visit `/?reset=1`), and you start from empty.

All variables are listed in [`.env.example`](.env.example).

## Reset

The red **Reset all data** button (top bar), and any URL ending in `?reset=1`, **wipe everything in the cloud for every visitor**: issuers, applications, credentials, disputes, balances, both logs, the fake clock. The app starts again from empty. If `RESET_PASSWORD` is set, the app asks for it. **Load demo** does the same wipe, then approves 3 issuers and issues 3 credentials.

## Logs

- **"What the contract did"** (bottom of every page): every blockchain-style transaction, with the money it moved.
- **"System log"** (below it): the backend's events. That covers applications, emails sent or failed, wrong or expired codes, lockouts, manual reviews, refused calls (with the error name), demo loads and resets.
- **Server log** (Vercel > your project > Logs): the same events as JSON lines, plus every write call with its timing, and any server error. Codes, keys and full email addresses are never logged. Emails appear as `a***@domain`.

## Using the app

The home page asks who you are: a shopkeeper, a supplier or payment app, a lender, or the platform admin. Each has its own page. **"You are"** in the side menu switches person at any time (shopkeepers: Sharma General Store, or Mehta Kirana which is new and has no credentials; issuers: Gupta Wholesale, PayLink, Quick Traders; lender: Asha Microfinance). The **Admin** page holds the test tools, the balances and both logs, so the other pages stay clean.

Quick start: Admin, then **Load demo**. That creates three issuers, three claims about Sharma General Store and a loan request waiting for a lender.

### The shopkeeper (My shop)

Shopkeepers never need a wallet or crypto. They see who vouches for them and whether each claim counts, how lenders will see them, and a loan request form that shows a suggested amount before they ask. Lenders pay the checking fee.

### The lender: loan requests

Pick a request, pay 1 USDC to check the shop, and read a recommendation built only from numbers the receipts back up: at least two independent issuers (a supplier and a payment app), issuers independent of each other, purchases of 40 to 90% of receipts, six months of receipts, no loan stacking (3 or more lender checks in 30 days halves the limit), and a limit of half the lowest verified monthly figure. Approve or decline. Going beyond the recommendation needs a written note, which stays on the record.

### Joining the registry (how an issuer applies)

1. **Apply** (Issuer page): business name, type, GST number (suppliers) or RBI licence number (payment providers), owner, phone, email, bank account holder name. ("Fill example" saves typing. The example email addresses can't receive mail, so type your own to receive the code.)
2. **Email code:** a 6-digit code is emailed. It works for 10 minutes and allows 3 tries. After that, or after a resend, the old code stops working. The server stores only a hash of the code, and it never appears on screen or in logs. If sending fails, the page shows the reason and offers "Send a new code".
3. **Sign the request** on-chain (`request_issuer`). Only a hash of the details goes on-chain.
4. **Automatic checks** run for the admin:

| Check | Supplier | Payment provider |
|---|---|---|
| Registered | GST number: valid format, found, Active | RBI licence: found, Authorised |
| Applicant is the registered owner | the person applying matches the owner on record | the authorised person on the licence |
| Contact matches the registry | email (or its domain) or phone matches the contact on record | same |
| Email verified | entered the emailed code | same |
| Bank account name | matches the registered name (60% word overlap) | same |
| Real trading | sold to at least 3 shops over 6 months | serves at least 3 merchants over 6 months |
| Independent | no shared phone or owner with any shop | same |
| Not blacklisted | not suspended before | same |

   The "owner" and "contact" checks stop someone from applying with another business's GST number. Typing a real GST number with your own name and email now fails both.
   Missing evidence is **unknown**, never "bad". The GST / RBI / sales data are fake tables in `lib/engine/data.ts`.

5. **Manual review (optional):** the admin can tick each check they verified by hand and write a note. If everything passed, they can approve straight away. If anything did not pass, Approve stays disabled until there is a note and every failed check is ticked. That is how an automatic "fail" is overruled, on the record. Or the admin rejects, and the applicant can apply again.

### Shop checks: is the shop genuine? (Admin page > "Shop checks")

For each shop, the admin sees the **payments behind every claim, month by month**: what was paid, what came straight back within 30 days (round-tripping), and the net. Then:

| Shop check | Rule |
|---|---|
| Shop on file | we have a profile and records for this shop |
| Receipts cover the last 6 months | money came in every month (from the payment provider's settlements) |
| Purchases are in line with sales | net purchases from suppliers are 40–90% of receipts (a kirana buys stock with what it earns) |
| Issuers are independent of each other | no two issuers share an owner or phone (stops a ring vouching for each other) |
| Every claim is backed by receipts | each credential passed fraud checks 2–4. A claim that isn't backed counts against the **issuer**, not the shop |

**Verdict:** *Looks genuine* (at least 2 independent issuers, a supplier and a payment provider, whose numbers agree), *Needs review* (only one kind of evidence, or a check above failed), or *Not enough evidence* (Unknown, never "bad"). Claims that fail are ignored, so the shop is judged only on what the receipts back up.

### The rest of the flow

Issuers sign credentials and lock **30 USDC** each. The shop's trust graph lights up. A lender pays **1 USDC** (70% to issuers with a valid credential, 30% to the platform) and sees all six fraud checks plus the stacking counter. A false claim can be disputed. If the admin upholds it, the stake goes to the lender, and two upheld disputes suspend the issuer. **+30 / +90 days** moves the fake clock (expiry, stake release).

## Tests

```sh
npm run test:engine   # rules: contract (32), onboarding (46), shop review (27), loans (24), rate limit (5)
npm run test:cloud    # the real Upstash and Resend client code against local stand-ins (31)
npm run test:e2e      # builds the app and clicks through it in Chrome (needs Google Chrome; CHROME_PATH if not at the macOS default)
npm test              # all three
```

The cloud and browser tests start small local stand-ins for Upstash and Resend (`tests/fakes.mjs`), so they need no accounts or keys and never email anyone. They cover 25 parallel writers with no lost updates, the plain code never being stored, email failure, the password-protected reset, a second visitor seeing changes by themselves, someone applying with another business's GSTIN, the shop checks, the full loan flow, and layout at 320, 390 and 820 px wide. `npm run build` and `npm run lint` are clean.

Not tested: real Upstash and Resend accounts (they need your keys), and actual inbox delivery.

## Known limits (be honest about these)

- **No real signatures yet.** "Acting as" is a selector. The server trusts the address the browser sends, so any visitor can act as the admin. This is fine for a demo, and it's exactly what Stellar's `require_auth` + a wallet fixes.
- **One shared world.** All visitors share the data, so two judges testing at once will see each other's actions.
- The whole state is one Redis record behind a lock. That's simple and safe at demo scale, not for thousands of users.
- Without a verified domain, Resend's test sender only emails your own address.
- Code emails are limited to 5 per address per hour (`MAX_CODES_PER_HOUR`). There is no other rate limiting yet, and the Admin page is not password-protected. Both matter once the link is public.
- Shops are fixed demo data. There is no "register my shop" step, no shop consent before an issuer vouches, and loans end at "approved": repayment is not tracked yet.

## Connecting the real contract

Pages only import from `@/lib/mock` (the thin client). To go live on Stellar:

1. Add `request_issuer` and `reject_issuer` to the Rust contract. The engine has both, plus everything else the pages call.
2. Make `contract.*` in `lib/mock/index.ts` call the deployed contract (build → simulate → wallet signs → send), and keep the same names and return shapes. `grep -rn CONNECT lib components app` lists every spot.
3. Replace "Acting as" with Stellar Wallets Kit / Freighter (`lib/session.ts`, `components/Header.tsx`).
4. Read lists (`listIssuers`, `listDisputes`, the activity log) from contract events.
5. Remove the prototype-only parts: `PrototypeBar`, `ResetOnLoad`, the fake clock, `demo`, `suspendIssuer`, `examples.ts`.
