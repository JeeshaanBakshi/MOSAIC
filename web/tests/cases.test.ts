// Rejection cases: a rejection opens a case, the admin gets a PDF and rules, approval deducts the stake and warns the issuer,
// the 3rd warning removes the issuer. Through the same functions the pages call.
import { contract as c, backend as b, demo, ACCOUNTS as A, withState, resetEverything } from "./engine";
import { getCaseReport } from "../lib/engine/cases";
import { caseReportPdf, makePdf } from "../lib/server/pdf";

let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const rejects = async (n: string, code: string, f: () => Promise<unknown>) => {
  try { await f(); ok(n, false, "(it did not throw)"); } catch (e) { ok(n, (e as { code?: string }).code === code, `(${(e as { code?: string }).code})`); }
};
const USDC = 10_000_000;
const cred = async (issuer: string, shop = "shop-1") => (await c.getCredentials(shop)).find((v) => v.credential.issuer === issuer)!.credential;

(async () => {
  await resetEverything();
  await withState(async () => {
    await demo.loadDemo();

    console.log("-- a rejection opens a case by itself");
    let cases = await b.getCases();
    const first = cases.find((x) => x.file.kind === "shop_rejection")!;
    ok("the shop's rejection of QuickSupply's invoice opened a case", !!first && first.issuerName === "QuickSupply" && first.file.status === "open" && first.file.reason.includes("never ordered"));
    ok("the case is about the invoice and the credential, and the supplier is recorded", !!first.file.invoiceId && first.file.issuer === A.quick.address);
    ok("with no lender involved, a deducted stake would go to the platform", first.file.beneficiary === A.admin.address);
    ok("the supplier has no warnings yet", first.warnings === 0 && first.warningLimit === 3);

    console.log("-- a lender can reject a claim (wrong information)");
    await rejects("a lender who never checked the shop cannot reject its claims", "Forbidden", () => b.flagClaim(A.asha.address, 4, "wrong amount"));
    await c.verify(A.asha.address, "shop-1");
    await rejects("a reason is required", "InvalidInput", () => b.flagClaim(A.asha.address, 4, " "));
    await rejects("the credential must exist", "NotFound", () => b.flagClaim(A.asha.address, 999, "wrong amount"));
    const anand = await cred(A.selfdeal.address);
    const lenderCase = await b.flagClaim(A.asha.address, anand.id, "The supplier is the shop owner's own company.");
    ok("the lender's rejection opened a case (the lender would get the stake)", (await b.getCases()).find((x) => x.file.id === lenderCase)!.file.beneficiary === A.asha.address);
    await rejects("the same lender cannot open a second case on the same claim while one is open", "AlreadyAnswered", () => b.flagClaim(A.asha.address, anand.id, "again"));

    console.log("-- the admin's case file (PDF)");
    const report = await getCaseReport(first.file.id);
    const pdf = caseReportPdf(report);
    const text = pdf.toString("latin1");
    ok("it is a PDF: starts with the header and ends with %%EOF", text.startsWith("%PDF-1.4") && text.trim().endsWith("%%EOF"));
    const startx = Number(text.match(/startxref\n(\d+)/)![1]);
    ok("the cross-reference table is where the trailer says", text.slice(startx, startx + 4) === "xref");
    const size = Number(text.match(/\/Size (\d+)/)![1]);
    const offsets = [...text.slice(startx).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    ok("every object starts exactly where the table says", offsets.length === size - 1 && offsets.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj`)), `${offsets.length} objects`);
    ok("it says what the case is about, in plain words", ["MOSAIC case file #1", "QuickSupply", "never ordered", "INV-QS-0731", "Rs 45,000", "Your decision", "If you APPROVE", "If you DISMISS", "0 of 3"].every((s) => text.includes(s)));
    ok("it shows the checks and the supplier's record", text.includes("Check 4") && text.includes("Reliability"));
    ok("it never writes the rupee sign (the standard fonts cannot)", !text.includes("₹"));
    const long = makePdf(Array.from({ length: 140 }, (_, i) => ({ t: "p" as const, text: `Line ${i} ` + "word ".repeat(30) })), "test");
    ok("a long document is split into several pages", (long.toString("latin1").match(/\/Type \/Page /g) ?? []).length > 1);
    await rejects("a case that does not exist has no file", "NotFound", () => getCaseReport(999));

    console.log("-- the admin approves: stake deducted, issuer warned");
    await rejects("only the admin can rule", "Forbidden", () => b.decideCase(A.asha.address, first.file.id, "approve", "ok"));
    await rejects("the admin must leave a note", "InvalidInput", () => b.decideCase(A.admin.address, first.file.id, "approve", " "));
    await rejects("the decision must be approve or dismiss", "InvalidInput", () => b.decideCase(A.admin.address, first.file.id, "maybe" as never, "note"));
    const platformBefore = await c.getBalance(A.admin.address), quickCred = await cred(A.quick.address);
    ok("QuickSupply's credential has its 20 USDC locked", quickCred.stake === 20 * USDC && !quickCred.revoked);
    const out = await b.decideCase(A.admin.address, first.file.id, "approve", "Confirmed by the delivery records.");
    ok("approving deducted the 20 USDC stake and gave warning 1 of 3", out.stakeDeducted === 20 * USDC && out.warnings === 1 && !out.removed);
    ok("the stake moved to the platform", (await c.getBalance(A.admin.address)) === platformBefore + 20 * USDC);
    const after = await cred(A.quick.address);
    ok("the credential is revoked and holds no stake", after.revoked && after.stake === 0);
    ok("the case is approved, with the ruling and its note kept", (await b.getCases({ status: "approved" }))[0].file.decision?.note.includes("delivery records") === true);
    await rejects("a ruling cannot be changed afterwards", "AlreadyAnswered", () => b.decideCase(A.admin.address, first.file.id, "dismiss", "changed my mind"));
    ok("the warning shows in the supplier's record and the category moves to 'under review'", (await b.getIssuerWarnings(A.quick.address)).warnings === 1 && (await b.getIssuerReliability(A.quick.address)).category === "under_review");
    ok("the invoice carries the ruling for the lender's report", (await b.getInvoices({ issuer: A.quick.address })).find((v) => v.claim.ref === "INV-QS-0731")!.claim.resolution?.upheld === true);

    console.log("-- a lender's case: the lender receives the stake");
    const lenderBefore = await c.getBalance(A.asha.address);
    await b.decideCase(A.admin.address, lenderCase, "approve", "Shares the shop's phone and bank account.");
    ok("the deducted stake went to the lender who rejected the claim", (await c.getBalance(A.asha.address)) === lenderBefore + 20 * USDC);

    console.log("-- the admin dismisses: no penalty");
    const gupta = await cred(A.gupta.address);
    const dismissCase = await b.flagClaim(A.asha.address, gupta.id, "I think the amount is too high.");
    const warnBefore = (await b.getIssuerWarnings(A.gupta.address)).warnings, balBefore = await c.getBalance(A.asha.address);
    const d = await b.decideCase(A.admin.address, dismissCase, "dismiss", "The records match the claim.");
    ok("dismissing deducts nothing and gives no warning", d.stakeDeducted === 0 && d.warnings === warnBefore && (await c.getBalance(A.asha.address)) === balBefore);
    ok("the credential keeps its stake and stays verified", (await cred(A.gupta.address)).stake === 20 * USDC && (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!.overall === "verified");

    console.log("-- a dismissed shop rejection no longer holds the credential back");
    const inv = await b.submitInvoice(A.gupta.address, "shop-1", gupta.id, { ref: "INV-GW-3000", amountInr: 10000, date: "2026-11-08", category: "Staples", description: "", evidenceRef: "", validDays: 30 });
    await b.rejectInvoice("shop-1", inv, "Not ours.");
    ok("while the rejection stands, Gupta's credential fails", (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!.overall === "failed");
    const rejCase = (await b.getCases({ status: "open" })).find((x) => x.file.invoiceId === inv)!;
    await b.decideCase(A.admin.address, rejCase.file.id, "dismiss", "Delivery note signed by the shop.");
    ok("after the admin dismisses it, the credential is verified again", (await b.getChecks("shop-1")).find((e) => e.issuerName === "Gupta Wholesale")!.overall === "verified");
    ok("and the invoice is no longer flagged", (await b.getInvoices({ issuer: A.gupta.address })).find((v) => v.claim.id === inv)!.trust !== "flagged");

    console.log("-- three warnings: out of the system");
    ok("before the last warning, the case file says it would be the last", (await b.getCases()).every((x) => x.file.issuer !== A.quick.address || x.removesIssuer === (x.warnings + 1 >= 3)));
    const w2 = await b.flagClaim(A.asha.address, quickCred.id, "Second wrong claim.");
    const r2 = await b.decideCase(A.admin.address, w2, "approve", "Second proven case.");
    ok("warning 2 of 3: still in the system", r2.warnings === 2 && !r2.removed && (await c.getIssuer(A.quick.address))!.active);
    const w3 = await b.flagClaim(A.asha.address, quickCred.id, "Third wrong claim.");
    ok("the case file warns that approving would remove the supplier", (await getCaseReport(w3)).ifApproved.some((t) => t.includes("REMOVED")));
    const r3 = await b.decideCase(A.admin.address, w3, "approve", "Third proven case.");
    ok("warning 3 of 3: removed from the system", r3.warnings === 3 && r3.removed && !(await c.getIssuer(A.quick.address))!.active);
    await rejects("a removed supplier cannot sign new credentials", "IssuerSuspended", () => c.issueCredential(A.quick.address, "shop-2", "buyer", "Buys Rs 1,000 a month", "0".repeat(63) + "1"));
    ok("its record says restricted", (await b.getIssuerReliability(A.quick.address)).category === "restricted");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
