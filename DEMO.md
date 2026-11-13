# MOSAIC: 2-minute demo script

Live app: https://mosiac-eight.vercel.app (spelled "mosiac")

**Before you record**
- Open the site once so the example data loads (it loads itself on the first visit).
- Check the **On-chain** panel at the bottom of the Lender page. If it says *Actions are sent to the contract*, every check, dispute and slash shows a real Stellar Expert link. If it says *Simulation only*, the toasts say "Simulated" instead: say so out loud rather than call it a real transaction.
- The demo can only be played through once per fresh data set: after the dispute in step 9 is upheld, press **Reset the demo** on the home page (it asks for the reset password) before the next take. The stacking warning also appears after three checks on Sharma Store; the reset clears it.

| Time | Click | Say |
|---|---|---|
| 0:00 | Home page | "A small shop in India can trade for ten years and still have no credit history. MOSAIC lets its distributor and its payment app vouch for it, with money behind their word, and lenders check that proof on Stellar." |
| 0:10 | Point at the banner and **Built on Stellar** | "This is a testnet prototype: real Stellar testnet transactions, test USDC, made-up shops. The contract is public and these transactions are real." |
| 0:18 | **Try the demo with Sharma Store** | "Sharma Store is a corner shop in Delhi. It pays nothing and never touches crypto. We're now the lender, Saathi Microfinance, looking at its loan request." |
| 0:26 | **Check the shop** | "The lender pays one test USDC to check the shop. That fee is the business model." |
| 0:36 | Point at the verdict card: **Approve up to ₹22,500**, **6 of 6 checks passed**, the fee line | "The answer comes first: approve up to ₹22,500. And the fee: 0.70 USDC went to the issuers whose claims passed, 0.30 to the platform, read from the actual transaction." |
| 0:46 | Click **View on Stellar Expert** in the card (new tab), then come back | "Here is that transaction on Stellar Expert: the contract paid the supplier and the platform in one step." |
| 0:56 | Scroll to **Passed**, point at one check's reason and its source line | "Every check shows its reason, the numbers, and whose data it used. Payment match and net flow use the payment app's records, never the supplier's own numbers." |
| 1:06 | Scroll to **Not counted** and open **QuickSupply** | "QuickSupply claimed ₹1,50,000 a month, but ₹1,40,000 came straight back within 30 days, so it fails net flow. Anand Traders shares the shop's phone and bank account, so it isn't independent. Neither counts, and the shop isn't blamed." |
| 1:20 | Back to the list, **Review** on **Sunrise Mart**, then **Check the shop** | "A brand-new shop vouched for only by QuickSupply, with no payment-app receipts. The answer is Unknown, not bad: no limit, and it says it needs an independent payment app." |
| 1:32 | Back to **Sharma Store**, press **Demo: 2 other lenders also check this shop** | "Three lenders checked this shop in 30 days: a stacking warning, and the limit is halved." |
| 1:40 | On QuickSupply press **Open dispute**, then **Report a default**; switch "You are" to **Mosaic admin** and press **Uphold and slash** | "Issuers stake 30 USDC per claim. After a default, the lender disputes, the admin upholds it, and the stake is paid to the lender. Two upheld disputes suspend the issuer." |
| 1:52 | Click **View on Stellar Expert** on the slash outcome | "And that slash is a real transaction too. MOSAIC: trading history as credit history." |

**Fallback if the live link is slow:** the README table "Verified on testnet" lists permanent transactions: the lender fee split, the dispute and the slash. Open the fee-split one and show the two transfers (0.70 and 0.30 USDC).
