# MOSAIC: demo script

Live app: https://mosiac-eight.vercel.app (spelled "mosiac")

## Before you record (2 minutes)

1. On the home page press **Reset the demo**, then (Admin, **Tools and logs** tab) **Load demo**. This clears the stacking counter and brings back the example data.
2. Check https://mosiac-eight.vercel.app/api/health says `"chain": "mirroring_to_testnet"`. If it says `simulation_only`, say "simulated" out loud instead of calling a transaction real.
3. Know the difference, so you can answer it: the **lender check, credentials and disputes** are sent to the real testnet contract. **Invoices, bills, shop confirmations, rejection cases and warnings are off-chain** (the MOSAIC backend). The website's rules use a **5 USDC fee, 50/50 split and 20 USDC stake**; the contract deployed on testnet was set up with **1 USDC, 70/30 and 30 USDC**, which cannot be edited after deploy. On a real check the screen shows what the chain actually moved.
4. The demo can be played once per fresh data set. Reset again before a second take.

## The 60-second cut (for the submission video)

| Time | Click | Say |
|---|---|---|
| 0:00 | Home page, then **Explore the demo** | "A shop with no credit history can still have a real trading history. MOSAIC lets its supplier and its payment app vouch for it, with money behind their word, and lenders check that proof on Stellar." |
| 0:10 | **Check the shop** | "The lender pays a small fee to check the shop. That fee is the business model: half goes to the suppliers who vouched." |
| 0:18 | Point at the verdict card, then open the **Report** tab | "A signature only shows who made a claim. This report looks at the evidence behind it: did the shop confirm, do the invoices match the payments, is the evidence recent." |
| 0:30 | Point at **INV-GW-1042** (strong) and **QuickSupply** (flagged) | "This invoice is confirmed by the shop and matched by payments: strong evidence. QuickSupply's claim is signed and valid on-chain, but the shop says it never ordered it. Flagged." |
| 0:40 | Switch "You are" to **Mosaic admin**, **Cases** tab, **Download the case file (PDF)** | "A rejection opens a case. The admin gets a PDF with the reason, the checks and the evidence, and decides." |
| 0:50 | Type a note, press **Approve: deduct stake and warn** | "Approved: the supplier's stake is deducted and it gets warning 1 of 3. The third warning removes it from the system." |
| 0:57 | Open **Testnet** in the menu | "And this is the real contract on Stellar testnet, read live: every credential and every transaction." |

## The full walk-through (about 3 minutes)

1. **Home** (0:00): the pitch, the banner ("testnet prototype, made-up shops"), then **Built on Stellar**: real transactions anyone can open.
2. **Explore the demo** (0:20): you are now Saathi Microfinance, the lender, looking at Sharma Store's loan request. The shop pays nothing and never touches crypto.
3. **Check the shop** (0:30): the verdict card answers first (**Approve up to ₹22,500**, **6 of 6 checks passed**), then where the fee went. Note: this is an example lender policy, not a validated lending model; the evidence is what counts.
4. **Report tab** (0:50): per credential, the five questions: issuer verified, business confirmed, invoice and payment matched, evidence disputed, how fresh. Open **Why it was judged this way** on **INV-GW-1051**: ₹45,000 billed, ₹15,000 paid, 33.3% matched, needs review.
5. **Supplier proof** (1:10): open "Is QuickSupply really this shop's supplier?". Its ₹1,50,000 bills are **not backed**: almost all the money came straight back. Gupta's six monthly bills all match what the shop paid.
6. **Six checks tab** (1:25): every check shows its numbers and whose data it used. QuickSupply fails net flow; Anand Traders shares the shop's phone and bank account, so it fails independence.
7. **Sunrise Mart** (1:35): go back, **Review** it, **Check the shop**. A new shop vouched for only by QuickSupply: **Unknown, not bad**. No limit.
8. **Two-sided confirmation** (1:45): switch to **Sharma Store**, **My shop**, **To confirm** tab. The shop can confirm, reject or dispute a supplier's claim. Press **Dispute** on INV-GW-1051 and write a reason.
9. **Admin** (2:05): **Cases** tab. Download the PDF, add a note, **Approve**. The stake is deducted (simulated) and the supplier is warned; three warnings remove it.
10. **Testnet** (2:30): the real contract: settings, issuers, credentials with their decoded values, and every transaction with the USDC that moved.

## If something goes wrong

- **Live site slow:** the README table "Verified on testnet" lists permanent real transactions. Open the fee-split one and show the two transfers.
- **A check shows "Not sent to Stellar":** a testnet key is missing on Vercel. Say "this action is simulated" and continue, or switch role.
- **The stacking warning appears too early:** three lender checks on Sharma Store in 30 days trigger it. **Reset the demo** and **Load demo**.
