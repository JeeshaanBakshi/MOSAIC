// The evidence layer: invoice-to-payment matching, evidence freshness, issuer reliability, two-sided confirmation,
// and the three demo scenarios. Pure rules first, then the workflows through the same functions the pages call.
import { matchInvoice, freshness, reliability, DAY, EVIDENCE_CONFIG, type InvoiceInput, type PaymentInput, type ReliabilityMetrics } from "../lib/engine/evidence";
import { contract as c, backend as b, demo, ACCOUNTS as A, withState, resetEverything } from "./engine";

let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const rejects = async (n: string, code: string, f: () => Promise<unknown>) => {
  try { await f(); ok(n, false, "(it did not throw)"); } catch (e) { ok(n, (e as { code?: string }).code === code, `(${(e as { code?: string }).code})`); }
};

const T = Date.UTC(2026, 10, 11) / 1000;
const SUP = "supplier-1", ACCT = "ICIC-0009012-11122233";
const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({ id: 2, ref: "INV-1", supplierId: SUP, supplierAccount: ACCT, shopId: "shop-1", amount: 45000, currency: "INR", date: T - 10 * DAY, cancelled: false, creditNotes: [], ...o });
const pay = (o: Partial<PaymentInput> = {}): PaymentInput => ({ id: 1, ref: "UPI/INV-1", shopId: "shop-1", payeeAccount: ACCT, amount: 45000, currency: "INR", date: T - 9 * DAY, status: "settled", ...o });
const m = (i: InvoiceInput, p: PaymentInput[], others: Pick<InvoiceInput, "id" | "ref" | "supplierId">[] = []) => matchInvoice(i, p, others, T);

(async () => {
  console.log("-- invoice matching (pure rules)");
  let r = m(inv(), [pay()]);
  ok("exact match: fully matched, 100%, nothing outstanding", r.status === "fully_matched" && r.matchingPercentage === 100 && r.outstandingAmount === 0 && r.matchedAmount === 45000);
  ok("every check line says what was found and why it matters", r.lines.length === 7 && r.lines.every((l) => l.found && l.why));
  r = m(inv(), [pay({ amount: 15000 })]);
  ok("partial payment: partially matched, 33.3%, Rs 30,000 outstanding", r.status === "partially_matched" && r.matchingPercentage === 33.3 && r.outstandingAmount === 30000, `${r.status} ${r.matchingPercentage}%`);
  ok("the shortfall is explained as a warning", r.warnings.some((w) => w.includes("33.3%")));
  r = m(inv(), [pay({ amount: 60000 })]);
  ok("overpayment: requires review, never 'fully matched'", r.status === "requires_review" && r.failedChecks.includes("Amounts"), r.status);
  r = m(inv(), [pay({ payeeAccount: "HDFC-9999" })]);
  ok("wrong supplier: requires review even though the amount is exact", r.status === "requires_review" && r.failedChecks.includes("Payer and payee") && r.matchedAmount === 0, r.status);
  r = m(inv(), [pay({ shopId: "shop-2" })]);
  ok("wrong business paid: requires review", r.status === "requires_review" && r.failedChecks.includes("Payer and payee"));
  r = m(inv({ id: 5 }), [pay()], [{ id: 2, ref: "inv-1", supplierId: SUP }]);
  ok("duplicate invoice (same supplier, same reference, later claim): duplicate", r.status === "duplicate" && r.failedChecks.includes("Duplicate evidence"));
  r = m(inv({ id: 2 }), [pay()], [{ id: 5, ref: "INV-1", supplierId: SUP }]);
  ok("the FIRST claim is not the duplicate", r.status === "fully_matched");
  r = m(inv(), [pay({ status: "reversed" })]);
  ok("reversed payment: requires review and counts for nothing", r.status === "requires_review" && r.matchedAmount === 0 && r.failedChecks.includes("Returns and cancellations"));
  r = m(inv({ cancelled: true }), [pay()]);
  ok("cancelled invoice: cancelled", r.status === "cancelled");
  r = m(inv({ creditNotes: [30000] }), [pay({ amount: 15000 })]);
  ok("credit note: Rs 30,000 off means Rs 15,000 fully covers the Rs 15,000 owed", r.status === "fully_matched" && r.effectiveAmount === 15000 && r.creditNotes === 30000, r.status);
  r = m(inv(), []);
  ok("no payment evidence: UNMATCHED and unknown, not failed", r.status === "unmatched" && r.failedChecks.length === 0 && r.lines.some((l) => l.result === "unknown" && l.missing));
  r = m(inv(), [pay({ date: T + 100 * DAY })]);
  ok("a payment far outside the date window needs review", r.status === "requires_review" && r.failedChecks.includes("Dates"));
  r = m(inv(), [pay({ status: "pending" })]);
  ok("a pending payment is not counted yet", r.matchedAmount === 0 && r.warnings.some((w) => w.includes("pending")));
  r = m(inv(), [pay({ ref: "UPI/OTHER-9" })]);
  ok("a payment that does not quote the invoice is not matched to it", r.status === "unmatched");
  r = m(inv({ supplierAccount: null }), [pay()]);
  ok("no verified supplier account on file: unknown, never a pass", r.lines.find((l) => l.id === "entities")!.result === "unknown" && r.status !== "fully_matched", r.status);

  console.log("-- evidence freshness (thresholds come from one config)");
  const fr = (days: number, ttl = 365) => freshness({ issuedAt: T - days * DAY, expiresAt: T - days * DAY + ttl * DAY, evidenceAt: [], transactionAt: [], now: T });
  ok("4 days: recent", fr(4).status === "recent" && fr(4).daysSinceVerified === 4);
  ok("45 days: ageing", fr(45).status === "ageing");
  ok("180 days: stale", fr(180).status === "stale");
  ok("past its expiry: expired (even if the evidence is new)", fr(10, 5).status === "expired");
  ok("the boundaries follow the config", fr(EVIDENCE_CONFIG.recentDays).status === "recent" && fr(EVIDENCE_CONFIG.recentDays + 1).status === "ageing" && fr(EVIDENCE_CONFIG.ageingDays + 1).status === "stale");
  ok("newer evidence (a confirmation) freshens an old credential", freshness({ issuedAt: T - 200 * DAY, expiresAt: T + 100 * DAY, evidenceAt: [T - 2 * DAY], transactionAt: [T - 5 * DAY], now: T }).status === "recent");
  ok("last transaction date is reported", freshness({ issuedAt: T - 5 * DAY, expiresAt: T + DAY, evidenceAt: [], transactionAt: [T - 8 * DAY, T - 3 * DAY], now: T }).lastTransactionAt === T - 3 * DAY);

  console.log("-- issuer reliability (categories, with the reasons)");
  const base: ReliabilityMetrics = { credentialsIssued: 0, confirmed: 0, rejected: 0, disputed: 0, pending: 0, upheldOnChain: 0, upheldInvoice: 0, warnings: 0, duplicates: 0, revoked: 0, suspended: false, approved: true };
  const rel = (o: Partial<ReliabilityMetrics>) => reliability({ ...base, ...o });
  ok("small sample and no disputes: LIMITED HISTORY, not established", rel({ credentialsIssued: 2 }).category === "limited_history");
  ok("enough history, nothing wrong: established", rel({ credentialsIssued: 3, confirmed: 8 }).category === "established");
  ok("one upheld dispute: under review", rel({ credentialsIssued: 6, confirmed: 8, upheldOnChain: 1 }).category === "under_review");
  ok("repeated upheld disputes: restricted", rel({ credentialsIssued: 6, confirmed: 8, upheldOnChain: 2 }).category === "restricted");
  ok("a suspended issuer: restricted", rel({ credentialsIssued: 6, confirmed: 8, suspended: true }).category === "restricted");
  ok("two rejected claims: under review", rel({ credentialsIssued: 3, confirmed: 5, rejected: 2 }).category === "under_review");
  ok("one rejection out of one claim is not enough to condemn a new issuer", rel({ credentialsIssued: 1, rejected: 1 }).category === "limited_history");
  ok("every category explains itself", [rel({}), rel({ credentialsIssued: 9 }), rel({ upheldOnChain: 1 }), rel({ suspended: true })].every((x) => x.reasons.length > 0));

  console.log("-- two-sided confirmation, through the real engine");
  await resetEverything();
  await withState(async () => {
    await demo.loadDemo();
    const all = await b.getInvoices({ shopId: "shop-1" });
    const byRef = (ref: string) => all.find((v) => v.claim.ref === ref)!;

    console.log("-- scenario A: genuine");
    const a = byRef("INV-GW-1042");
    ok("A: the shop confirmed it", a.state === "confirmed");
    ok("A: invoice fully matched by payments (100%)", a.match.status === "fully_matched" && a.match.matchingPercentage === 100);
    ok("A: strong supporting evidence", a.trust === "strong", a.trustReasons.join(" "));
    ok("A: no duplicate detected", a.match.lines.find((l) => l.id === "duplicates")!.result === "pass");

    console.log("-- scenario B: a valid signature, but the shop says it never happened");
    const bq = byRef("INV-QS-0731");
    ok("B: rejected by the business, with its reason kept", bq.state === "rejected" && bq.claim.reason!.includes("never ordered"));
    ok("B: flagged for the lender", bq.trust === "flagged");
    ok("B: the issuer's signature is still valid on-chain (a valid credential is not a true transaction)", (await c.getCredentials("shop-1")).find((v) => v.credential.issuer === A.quick.address)!.status === "Valid");
    ok("B: the issuer's original identity is recorded", bq.claim.issuer === A.quick.address && bq.claim.history[0].action === "submitted");

    console.log("-- scenario C: an inflated invoice");
    const cc = byRef("INV-GW-1051");
    ok("C: partially matched, 33.3%, Rs 30,000 outstanding", cc.match.status === "partially_matched" && cc.match.matchingPercentage === 33.3 && cc.match.outstandingAmount === 30000, `${cc.match.status} ${cc.match.matchingPercentage}`);
    ok("C: the shop has not answered yet (pending, not 'confirmed' just because it was signed)", cc.state === "pending");
    ok("C: the lender gets a review warning", cc.trust === "review" && cc.trustReasons.join(" ").includes("33.3%"));

    console.log("-- the lender's report");
    const rep = await b.getVerificationReport("shop-1");
    const gupta = rep.credentials.find((x) => x.issuerName === "Gupta Wholesale")!;
    const quick = rep.credentials.find((x) => x.issuerName === "QuickSupply")!;
    ok("report: Gupta's six checks passed (issuer verified)", gupta.issuerVerified === "yes");
    ok("report: Gupta has one confirmed and one pending invoice, so a mixed picture: review", gupta.trust === "review" && gupta.confirmation === "pending");
    ok("report: QuickSupply is flagged, disputed, and says why", quick.trust === "flagged" && quick.disputed && quick.confirmation === "rejected" && quick.trustReasons.length > 0);
    ok("report: freshness is recent and reported per credential", rep.credentials.every((x) => x.freshness.status === "recent"));
    ok("report: it says what is on-chain and what is not", rep.provenance.onChain.length > 0 && rep.provenance.offChain.length > 0);
    ok("report: the existing six checks are untouched (Gupta still verified, QuickSupply still failed)", (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!.overall === "verified");
    ok("report: a shop with no invoices says 'awaiting', not 'flagged'", (await b.getVerificationReport("shop-3")).credentials.every((x) => x.trust !== "strong"));

    console.log("-- permissions");
    await rejects("another business cannot confirm Sharma's invoice", "Forbidden", () => b.confirmInvoice("shop-2", cc.claim.id));
    await rejects("another business cannot reject it either", "Forbidden", () => b.rejectInvoice("shop-2", cc.claim.id, "not mine"));
    await rejects("a decision is not silently overwritten: confirming a rejected claim fails", "AlreadyAnswered", () => b.confirmInvoice("shop-1", bq.claim.id));
    await rejects("a confirmed claim cannot be confirmed twice", "AlreadyAnswered", () => b.confirmInvoice("shop-1", a.claim.id));
    await rejects("rejecting needs a reason", "InvalidInput", () => b.rejectInvoice("shop-1", cc.claim.id, " "));
    await rejects("only the supplier who submitted can cancel", "Forbidden", () => b.cancelInvoice(A.paylink.address, cc.claim.id));
    await rejects("a payment app cannot issue invoices", "Forbidden", () => b.submitInvoice(A.paylink.address, "shop-1", 2, { ref: "X-1", amountInr: 100, date: "2026-11-01", category: "x", description: "", evidenceRef: "", validDays: 30 }));
    await rejects("a supplier can only attach an invoice to its own credential", "InvalidInput", () => b.submitInvoice(A.gupta.address, "shop-1", bq.claim.credentialId, { ref: "X-2", amountInr: 100, date: "2026-11-01", category: "x", description: "", evidenceRef: "", validDays: 30 }));
    await rejects("a lender (not an approved issuer) cannot submit invoices", "IssuerNotApproved", () => b.submitInvoice(A.asha.address, "shop-1", 1, { ref: "X-3", amountInr: 100, date: "2026-11-01", category: "x", description: "", evidenceRef: "", validDays: 30 }));
    await rejects("only the admin can rule on a dispute", "Forbidden", () => b.resolveInvoiceDispute(A.gupta.address, cc.claim.id, true, "no"));

    console.log("-- the shop's answers change the verdict");
    ok("a rejected invoice makes the credential 'failed' in the six-check engine (it stops earning fees)", (await b.getChecks("shop-1")).find((e) => e.issuerName === "QuickSupply")!.invoiceBlock?.result === "fail");
    await b.disputeInvoice("shop-1", cc.claim.id, "We only received half of the goods.");
    let g = (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!;
    ok("an open dispute holds Gupta's credential back (unknown), until the admin decides", g.overall === "unknown" && g.invoiceBlock?.result === "unknown");
    ok("the dispute is visible to the lender", (await b.getVerificationReport("shop-1")).credentials.find((x) => x.issuerName === "Gupta Wholesale")!.disputed);
    await b.resolveInvoiceDispute(A.admin.address, cc.claim.id, true, "Delivery note shows half the goods.");
    g = (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!;
    ok("after the admin upholds it, the credential fails", g.overall === "failed");
    ok("the upheld dispute counts against the issuer's reliability", (await b.getIssuerReliability(A.gupta.address)).metrics.upheldInvoice === 1);
    await rejects("a ruling cannot be changed afterwards", "AlreadyAnswered", () => b.resolveInvoiceDispute(A.admin.address, cc.claim.id, false, "changed my mind"));
    ok("the whole history is kept", (await b.getInvoices({ shopId: "shop-1" })).find((v) => v.claim.id === cc.claim.id)!.claim.history.map((h) => h.action).join(",") === "submitted,disputed,dispute_upheld");

    console.log("-- credit notes, cancellations and reversals through the engine");
    // The upheld dispute revoked Gupta's first credential (case penalty), so he issues a new one to keep trading.
    const fresh = await c.issueCredential(A.gupta.address, "shop-1", "on_time", "Pays on time, about Rs 40,000 a month", "0".repeat(63) + "2");
    const id2 = await b.submitInvoice(A.gupta.address, "shop-1", fresh.result, { ref: "INV-GW-2000", amountInr: 20000, date: "2026-11-05", category: "Staples", description: "", evidenceRef: "", validDays: 30 });
    const pid = await b.submitPaymentRecord(A.paylink.address, "shop-1", { payeeAccount: gupta.issuer ? "ICIC-0009012-11122233" : "", amountInr: 12000, date: "2026-11-06", reference: "UPI/INV-GW-2000" });
    await b.addCreditNote(A.gupta.address, id2, 8000, "CN-1");
    ok("a credit note lowers what is owed, so Rs 12,000 now fully matches", (await b.getInvoices({ shopId: "shop-1" })).find((v) => v.claim.id === id2)!.match.status === "fully_matched");
    await rejects("a credit note cannot exceed the invoice", "InvalidInput", () => b.addCreditNote(A.gupta.address, id2, 99999, "CN-2"));
    await b.reversePayment(A.paylink.address, pid);
    ok("a reversed payment stops counting and needs review", (await b.getInvoices({ shopId: "shop-1" })).find((v) => v.claim.id === id2)!.match.status === "requires_review");
    await rejects("only the recording payment app can reverse a payment", "Forbidden", () => b.reversePayment(A.quick.address, pid));
    await b.cancelInvoice(A.gupta.address, id2);
    ok("a cancelled invoice is cancelled", (await b.getInvoices({ shopId: "shop-1" })).find((v) => v.claim.id === id2)!.match.status === "cancelled");
    await rejects("a cancelled invoice cannot be answered", "InvalidInput", () => b.confirmInvoice("shop-1", id2));

    console.log("-- duplicates across credentials");
    const dup = await b.submitInvoice(A.gupta.address, "shop-1", fresh.result, { ref: "inv-gw-1042", amountInr: 45000, date: "2026-10-28", category: "Staples", description: "", evidenceRef: "", validDays: 30 });
    const dv = (await b.getInvoices({ shopId: "shop-1" })).find((v) => v.claim.id === dup)!;
    ok("re-using an invoice reference is detected as a duplicate and flagged", dv.match.status === "duplicate" && dv.trust === "flagged");
    ok("duplicates count in the issuer's reliability metrics", (await b.getIssuerReliability(A.gupta.address)).metrics.duplicates >= 1);

    console.log("-- issuer reliability in the engine");
    const list = await b.listIssuerReliability();
    ok("every registered issuer has a category and reasons", list.length === 4 && list.every((x) => x.reasons.length > 0));
    ok("new issuers with little history are 'limited history', never 'established'", list.filter((x) => x.name === "PayLink" || x.name === "Anand Traders").every((x) => x.category === "limited_history"));
    ok("the admin's attention list includes the rejected claim", (await b.getEvidenceAttention()).some((v) => v.claim.ref === "INV-QS-0731"));

    console.log("-- freshness moves with the clock");
    await c.advanceTime(45);
    ok("45 days later the evidence is ageing", (await b.getVerificationReport("shop-1")).credentials.find((x) => x.issuerName === "PayLink")!.freshness.status === "ageing");
    await c.advanceTime(30);
    ok("75 days later it is stale (credentials last 90 days)", (await b.getVerificationReport("shop-1")).credentials.find((x) => x.issuerName === "PayLink")!.freshness.status === "stale");
    ok("old evidence does not disappear: the invoices are still listed", (await b.getInvoices({ shopId: "shop-1" })).length >= 4);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
