import "server-only";
// MOCK-ONLY helper behind the "Load demo" button.
// Load demo replays the first steps of the flow through the SAME contract functions the pages use,
// so the activity log shows exactly what happened.
// CONNECT: delete this file. On the real chain you run scripts/seed.sh (or click through the UI) instead.

import { ACCOUNTS } from "./accounts";
import { addIssuer, getCredentials, issueCredential, openDispute, requestIssuer, resolveDispute } from "./contract";
import { confirmInvoice, confirmSupplierLink, rejectInvoice, requestSupplierLink, submitInvoice, submitPaymentFeed, submitPaymentRecord, submitStatement, syncChecks, verifiedAccountOf } from "./backend";
import { MONTH_LABEL } from "./evidence";
import { sampleBillPdf } from "../server/pdf";
import type { FeedMonth } from "./rules";
import { markRequested, seedVerifiedApplication } from "./onboarding";
import { requestLoan } from "./loans";
import { logEvent, patchState, withoutChain } from "./store";
import { claimHash } from "./util";

/**
 * Six months of the payment app's records for Sharma Store (Sharma). Fixed numbers, so the demo is repeatable.
 *  - Gupta Wholesale (honest supplier): the shop pays its account ₹45,500 a month; one ₹2,000 credit note in August.
 *  - QuickSupply (QuickSupply): the shop pays its account ₹1,50,000 a month and ₹1,40,000 comes straight back.
 *  - Anand Traders (self-dealing): the shop pays its account ₹45,000 a month (but it shares the shop's phone and bank account).
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
 * Three deterministic invoice scenarios for Sharma Store (shop-1). The same rules that run for real users judge them;
 * nothing is bent to make them pass.
 *   A  Gupta Wholesale INV-GW-1042  Rs 45,000, PayLink saw Rs 45,000, the shop CONFIRMED   -> strong evidence
 *   B  QuickSupply     INV-QS-0731  Rs 45,000, the shop REJECTED it (it never ordered)     -> flagged
 *   C  Gupta Wholesale INV-GW-1051  Rs 45,000, PayLink saw only Rs 15,000, shop undecided  -> partly matched, review
 */
async function loadInvoiceScenarios() {
  const { gupta, paylink, quick } = ACCOUNTS;
  const cred = async (issuer: string) => (await getCredentials("shop-1")).find((v) => v.credential.issuer === issuer)!.credential.id;
  const guptaCred = await cred(gupta.address), quickCred = await cred(quick.address);
  const guptaAccount = verifiedAccountOf("gupta")!;

  const a = await submitInvoice(gupta.address, "shop-1", guptaCred, { ref: "INV-GW-1042", amountInr: 45000, date: "2026-10-28", category: "Groceries and staples", description: "Monthly stock: rice, atta, oil, pulses", evidenceRef: "Sample GST e-invoice IRN (demo data)", validDays: 90 });
  await submitPaymentRecord(paylink.address, "shop-1", { payeeAccount: guptaAccount, amountInr: 45000, date: "2026-10-30", reference: "UPI/INV-GW-1042" });
  await confirmInvoice("shop-1", a);

  const b = await submitInvoice(quick.address, "shop-1", quickCred, { ref: "INV-QS-0731", amountInr: 45000, date: "2026-10-20", category: "Packaged goods", description: "Bulk packaged goods", evidenceRef: "Sample invoice scan (demo data)", validDays: 90 });
  await rejectInvoice("shop-1", b, "We never ordered this and no goods arrived.");

  await submitInvoice(gupta.address, "shop-1", guptaCred, { ref: "INV-GW-1051", amountInr: 45000, date: "2026-11-02", category: "Groceries and staples", description: "Festival season stock", evidenceRef: "Sample GST e-invoice IRN (demo data)", validDays: 90 });
  await submitPaymentRecord(paylink.address, "shop-1", { payeeAccount: guptaAccount, amountInr: 15000, date: "2026-11-03", reference: "UPI/INV-GW-1051" });
}

/**
 * Supplier proof for Sharma Store (shop-1), all made-up sample bills:
 *   Gupta Wholesale  six monthly bills that match what the shop paid, and the shop CONFIRMED it is its supplier -> verified supplier
 *   QuickSupply      three monthly bills of Rs 1,50,000, but almost all of it came straight back, and the shop has not answered -> flagged
 *   Anand Traders    nothing uploaded -> not verified yet
 */
async function loadSupplierProof() {
  const { gupta, quick } = ACCOUNTS;
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const upload = async (a: typeof gupta, name: string, month: string, total: number, bills: number) => {
    const pdf = sampleBillPdf({ supplier: name, customer: "Sharma Store", monthLabel: MONTH_LABEL[month], total, bills });
    await submitStatement(a.address, "shop-1", { month, billedInr: total, billCount: bills, nameOnBill: "Sharma Store", fileName: `${name.toLowerCase().replace(/\s+/g, "-")}-${month}.pdf` }, pdf);
  };
  await requestSupplierLink(gupta.address, "shop-1");
  await confirmSupplierLink("shop-1", gupta.address);
  for (const m of months) await upload(gupta, "Gupta Wholesale", m, 45_500, 4);
  await requestSupplierLink(quick.address, "shop-1");
  for (const m of months.slice(0, 3)) await upload(quick, "QuickSupply", m, 150_000, 6);
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

  // 2. Each issuer signs a claim and locks the stake (20 USDC).
  //    Sharma Store (Sharma): honest supplier + payment app, a round-tripping supplier, a self-dealing supplier.
  //    Sunrise Mart: listed and vouched for by QuickSupply alone, with no payment-app records.
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

  // 3. The payment app shares Sharma Store's records. The checks use THIS, never what a supplier typed.
  await submitPaymentFeed(paylink.address, "shop-1", sharmaFeed());
  await syncChecks("shop-1"); // the backend checks the claims and tells the contract which passed
  await syncChecks("shop-3");

  // Shop 3's only voucher, QuickSupply, was proven wrong: after the shop defaulted, a lender's dispute was upheld and the
  // 20 USDC stake was paid out. The real testnet contract shows the same, so the page and the On-chain panel agree.
  patchState((s) => { s.verifiers["shop-3"] = ["lender-2"]; s.defaults["shop-3"] = s.now; });
  const fakeCred = (await getCredentials("shop-3"))[0].credential.id;
  const dispute = await openDispute("lender-2", fakeCred);
  await resolveDispute(admin.address, dispute.result, true);

  // 3b. Three invoice scenarios on Sharma Store, so the lender's report shows what the new evidence layer does.
  //     Everything here is made-up sample data. A = genuine, B = a supplier's claim the shop denies, C = an inflated invoice.
  await loadInvoiceScenarios();
  await loadSupplierProof();

  // 4. Both shops ask for a loan, so the lender has something to decide.
  await requestLoan("shop-3", 100000, 6, "Opening stock for a new shop");
  await requestLoan("shop-1", 20000, 6, "Extra stock for the festival season");
  logEvent("info", "demo_loaded", "Demo loaded: 4 issuers approved, 5 credentials issued, 3 invoice scenarios, Sharma Store (honest) and Sunrise Mart (vouched only by QuickSupply) asked for loans.");
}
