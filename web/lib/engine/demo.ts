import "server-only";
// MOCK-ONLY helper behind the "Load demo" button.
// Load demo replays the first steps of the flow through the SAME contract functions the pages use,
// so the activity log shows exactly what happened.
// CONNECT: delete this file. On the real chain you run scripts/seed.sh (or click through the UI) instead.

import { ACCOUNTS } from "./accounts";
import { addIssuer, issueCredential, requestIssuer } from "./contract";
import { submitPaymentFeed, syncChecks, verifiedAccountOf } from "./backend";
import type { FeedMonth } from "./rules";
import { markRequested, seedVerifiedApplication } from "./onboarding";
import { requestLoan } from "./loans";
import { logEvent, withoutChain } from "./store";
import { claimHash } from "./util";

/**
 * Six months of the payment app's records for Shop 1 (Sharma). Fixed numbers, so the demo is repeatable.
 *  - Issuer 1 (honest supplier): the shop pays its account ₹45,500 a month; one ₹2,000 credit note in August.
 *  - Issuer 3 (QuickSupply): the shop pays its account ₹1,50,000 a month and ₹1,40,000 comes straight back.
 *  - Issuer 4 (self-dealing): the shop pays its account ₹45,000 a month (but it shares the shop's phone and bank account).
 *  - Receipts = customer sales + every transfer back (money in is money in), so the payment app's own claim
 *    only passes once the round trips are taken out (check 4).
 */
function sharmaFeed(): FeedMonth[] {
  const sales = [58000, 60800, 55200, 59600, 60400, 56800];
  const gupta = verifiedAccountOf("gupta")!, quick = verifiedAccountOf("quick")!, selfdeal = verifiedAccountOf("selfdeal")!;
  return sales.map((customerSales, i) => {
    const guptaBack = i === 3 ? 2000 : 0;
    const quickBack = 140_000;
    return {
      receipts: customerSales + guptaBack + quickBack,
      payees: {
        [gupta]: { out: 45_500, back: guptaBack },
        [quick]: { out: 150_000, back: quickBack },
        [selfdeal]: { out: 45_000, back: 0 },
      },
    };
  });
}

/**
 * Fill an EMPTY world with the demo. (The /api/reset route wipes first.)
 * The demo is SIMULATED only: it makes dozens of transactions, so none of them are sent to Stellar.
 * The real testnet copy of the demo is made once by scripts/seed.sh.
 */
export async function loadDemo() {
  return withoutChain(loadDemoSimulated);
}

async function loadDemoSimulated() {
  const { admin, gupta, paylink, quick, selfdeal } = ACCOUNTS;

  // 1. Each issuer applies (email already verified), then the admin approves all four.
  //    In the real flow the admin reviews each application first (see the Admin page). Load demo skips that.
  for (const a of [gupta, paylink, quick, selfdeal]) {
    const app = await seedVerifiedApplication(a.id);
    await requestIssuer(a.address, app.businessName, app.kind, app.evidenceHash);
    await markRequested(a.address);
    await addIssuer(admin.address, a.address, a.name, a.kind!);
  }

  // 2. Each issuer signs a claim and locks 30 USDC.
  //    Shop 1 (Sharma): honest supplier + payment app, a round-tripping supplier, a self-dealing supplier.
  //    Shop 3: listed and vouched for by Issuer 3 alone, with no payment-app records.
  const claims = [
    { by: gupta, shop: "shop-1", type: "buyer", summary: "Regular buyer for 18 months, buys ₹45,000 a month, pays on time" },
    { by: paylink, shop: "shop-1", type: "receipts", summary: "Payment-app (UPI) receipts above ₹50,000 a month for 6 months" },
    { by: quick, shop: "shop-1", type: "buyer", summary: "Buys ₹1,50,000 a month from us for 12 months" },
    { by: selfdeal, shop: "shop-1", type: "buyer", summary: "Regular buyer for 12 months, buys ₹45,000 a month, pays on time" },
    { by: quick, shop: "shop-3", type: "buyer", summary: "Buys ₹1,50,000 a month from us for 6 months" },
  ];
  for (const c of claims) {
    const hash = await claimHash({ shop_id: c.shop, issuer: c.by.address, claim_type: c.type, summary: c.summary });
    await issueCredential(c.by.address, c.shop, c.type, c.summary, hash);
  }

  // 3. The payment app shares Shop 1's records. The checks use THIS, never what a supplier typed.
  await submitPaymentFeed(paylink.address, "shop-1", sharmaFeed());
  await syncChecks("shop-1"); // the backend checks the claims and tells the contract which passed
  await syncChecks("shop-3");

  // 4. Both shops ask for a loan, so the lender has something to decide.
  await requestLoan("shop-3", 100000, 6, "Opening stock for a new shop");
  await requestLoan("shop-1", 20000, 6, "Extra stock for the festival season");
  logEvent("info", "demo_loaded", "Demo loaded: 4 issuers approved, 5 credentials issued, Shop 1 (honest) and Shop 3 (vouched only by Issuer 3) asked for loans.");
}
