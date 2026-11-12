import "server-only";
// MOCK-ONLY helper behind the "Load demo" button.
// Load demo replays the first steps of the flow through the SAME contract functions the pages use,
// so the activity log shows exactly what happened.
// CONNECT: delete this file. On the real chain you run scripts/seed.sh (or click through the UI) instead.

import { ACCOUNTS } from "./accounts";
import { addIssuer, issueCredential, requestIssuer } from "./contract";
import { syncChecks } from "./backend";
import { markRequested, seedVerifiedApplication } from "./onboarding";
import { requestLoan } from "./loans";
import { logEvent } from "./store";
import { claimHash } from "./util";

/** Fill an EMPTY world with the demo. (The /api/reset route wipes first.) */
export async function loadDemo() {
  const { admin, gupta, paylink, quick } = ACCOUNTS;

  // 1. Each issuer applies (email already verified), then the admin approves all three.
  //    In the real flow the admin reviews each application first (see the Admin page). Load demo skips that.
  for (const a of [gupta, paylink, quick]) {
    const app = await seedVerifiedApplication(a.id);
    await requestIssuer(a.address, app.businessName, app.kind, app.evidenceHash);
    await markRequested(a.address);
    await addIssuer(admin.address, a.address, a.name, a.kind!);
  }

  // 2. Each issuer signs a claim about shop-1 and locks 30 USDC.
  const claims = [
    { by: gupta, type: "buyer", summary: "Regular buyer for 18 months, buys ₹45,000 a month, pays on time" },
    { by: paylink, type: "receipts", summary: "Payment-app (UPI) receipts above ₹50,000 a month for 6 months" },
    { by: quick, type: "buyer", summary: "Buys ₹2,00,000 a month from us for 12 months" },
  ];
  for (const c of claims) {
    const hash = await claimHash({ shop_id: "shop-1", issuer: c.by.address, claim_type: c.type, summary: c.summary });
    await issueCredential(c.by.address, "shop-1", c.type, c.summary, hash);
  }
  await syncChecks("shop-1"); // the backend checks the claims and tells the contract which passed

  // 3. Shop 1 asks for a loan, so the lender has something to decide.
  await requestLoan("shop-1", 20000, 6, "Extra stock for the festival season");
  logEvent("info", "demo_loaded", "Demo loaded: 3 issuers approved, 3 credentials issued, and Shop 1 asked for a ₹20,000 loan.");
}
