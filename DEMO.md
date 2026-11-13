# MOSAIC: 60-second demo script

Live app: https://mosiac-eight.vercel.app  (spelled "mosiac")

**Before you record:** open the site once so the example data loads. On the Admin page press **Reset all data** only if you want a clean start (it asks for the reset password). The real transaction links in steps 5–6 appear only when the server has the testnet keys; the On-chain panel says "Actions are sent to the contract" when it does. If it says "Simulation only", the toasts will say "Simulated" instead, so say so out loud rather than claim a real transaction.

| Time | Click | Say |
|---|---|---|
| 0:00 | Home page | "A small shop can trade for ten years and still have no credit history. MOSAIC lets its distributor and its payment app vouch for it, with money behind their word, so a lender can check that proof on Stellar." |
| 0:08 | **Try the demo with Sharma Store** | "Sharma Store is a corner shop. It pays nothing and never touches crypto." |
| 0:14 | Menu > **You are** > **Lender 1**, then **Review** on Shop 1, then **Check the shop** | "A lender pays one test USDC to check the shop. That fee is the business model." |
| 0:24 | Point at **Recommend approve**, the limit, and one check's *Numbers* and source line | "Six checks, each showing Passed, Failed or Unknown, the numbers, and whose data it used. Payment match and net flow use the payment app's records, never the supplier's own numbers." |
| 0:34 | Scroll to **Not counted** (Issuer 3 and Issuer 4) | "QuickSupply claimed ₹1,50,000 a month, but ₹1,40,000 came straight back, so it fails. This other issuer shares the shop's phone and bank account, so it's not independent. Both are ignored, and the shop is not blamed." |
| 0:43 | **Demo: 2 other lenders also check this shop** | "Three lenders checked this shop in 30 days: a stacking warning, and the limit is halved." |
| 0:50 | Click **View on Stellar Expert** in the toast from the check (or the link in the On-chain panel) | "And this is a real transaction on the Stellar testnet. The lender paid 1 USDC; the contract paid 0.70 to the supplier and 0.30 to the platform." |
| 0:58 | Stay on Stellar Expert | "Issuers stake 30 USDC per claim. A false claim, after a default, loses it to the lender. MOSAIC." |

**Fallback if the live link is slow:** the 5 contract transactions in the README table ("Verified on testnet") are permanent. Open the fee-split one and show the two transfers.
