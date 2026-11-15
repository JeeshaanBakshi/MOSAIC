// Supplier proof: monthly bill uploads (PDF), bills against payments, "is this really the shop's supplier?".
import { supplierProof, EVIDENCE_MONTHS, type ProofInput } from "../lib/engine/evidence";
import { contract as c, backend as b, demo, ACCOUNTS as A, withState, resetEverything } from "./engine";
import { getCaseReport } from "../lib/engine/cases";
import { caseReportPdf, sampleBillPdf } from "../lib/server/pdf";
import { readStatementFile } from "../lib/server/statementFiles";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const rejects = async (n: string, code: string, f: () => Promise<unknown>) => {
  try { await f(); ok(n, false, "(it did not throw)"); } catch (e) { ok(n, (e as { code?: string }).code === code, `(${(e as { code?: string }).code})`); }
};

const flowsOf = (net: number, paid = net) => Object.fromEntries(EVIDENCE_MONTHS.map((m) => [m, { paid, returned: paid - net, net }]));
const good = (o: Partial<ProofInput> = {}): ProofInput => ({
  shopName: "Sharma Store", shopOwner: "Suresh Sharma", link: "confirmed",
  statements: EVIDENCE_MONTHS.map((m, i) => ({ id: i + 1, month: m, billed: 45000, billCount: 4, nameOnBill: "Sharma Store", fileHash: `h${i}` })),
  flows: flowsOf(45000), reusedHashes: new Set(), independence: "pass", ...o,
});
const line = (r: ReturnType<typeof supplierProof>, id: string) => r.lines.find((l) => l.id === id)!;

(async () => {
  console.log("-- the seven checks (pure rules)");
  let r = supplierProof(good());
  ok("everything in order: verified supplier, 7 lines passed", r.status === "verified" && r.lines.length === 7 && r.lines.every((l) => l.result === "pass"));
  ok("every line says what was found and why it matters", r.lines.every((l) => l.found && l.why));
  r = supplierProof(good({ link: "rejected" }));
  ok("the shop denies it is its supplier: flagged", r.status === "flagged" && line(r, "link").result === "fail");
  r = supplierProof(good({ link: "pending" }));
  ok("the shop has not answered: unknown, not failed", line(r, "link").result === "unknown" && r.status === "partial");
  r = supplierProof(good({ statements: good().statements.slice(0, 3) }));
  ok("3 of 6 months uploaded: unknown (missing months named), not failed", line(r, "coverage").result === "unknown" && line(r, "coverage").missing!.includes("Aug 2026") && r.status === "partial");
  r = supplierProof(good({ flows: flowsOf(10000, 150000) }));
  ok("bills of Rs 45,000 against Rs 10,000 net paid: flagged, months named", r.status === "flagged" && line(r, "payments").result === "fail" && line(r, "payments").found.includes("May 2026"));
  r = supplierProof(good({ flows: flowsOf(33000) }));
  ok("73% paid is enough (the rule is 70%)", line(r, "payments").result === "pass");
  r = supplierProof(good({ flows: null }));
  ok("no payment records: unknown, never failed", line(r, "payments").result === "unknown" && line(r, "trail").result === "unknown" && r.status !== "flagged");
  r = supplierProof(good({ flows: flowsOf(0, 0) }));
  ok("bills but no payment at all in the records: the trail fails", line(r, "trail").result === "fail");
  r = supplierProof(good({ statements: good().statements.map((s, i) => (i === 2 ? { ...s, nameOnBill: "Some Other Traders" } : s)) }));
  ok("a bill made out to someone else: flagged, month named", r.status === "flagged" && line(r, "name").found.includes("Jul 2026"));
  r = supplierProof(good({ statements: good().statements.map((s, i) => (i === 0 ? { ...s, nameOnBill: "Suresh Sharma" } : s)) }));
  ok("a bill made out to the shop's owner is accepted", line(r, "name").result === "pass");
  r = supplierProof(good({ reusedHashes: new Set(["h1", "h4"]) }));
  ok("the same file used twice: flagged", r.status === "flagged" && line(r, "reuse").result === "fail" && line(r, "reuse").found.includes("Jun 2026"));
  r = supplierProof(good({ independence: "fail" }));
  ok("a supplier tied to the shop: flagged", r.status === "flagged" && line(r, "independent").result === "fail");
  r = supplierProof(good({ statements: [], flows: null, link: "none", independence: "unknown" }));
  ok("nothing at all: 'not verified yet' (unknown, not bad)", r.status === "unverified" && r.lines.every((l) => l.result === "unknown"));
  r = supplierProof(good());
  ok("the month table shows billed, paid and share for each month", r.months.length === 6 && r.months.every((m) => m.uploaded && m.share === 1));

  await resetEverything();
  await withState(async () => {
    await demo.loadDemo();
    const shop = "shop-1";
    const pdf = (n: number) => sampleBillPdf({ supplier: "Gupta Wholesale", customer: "Sharma Store", monthLabel: "May 2026", total: 1000 + n, bills: 1 });
    const form = (o = {}) => ({ month: "2026-05", billedInr: 45500, billCount: 4, nameOnBill: "Sharma Store", fileName: "may.pdf", ...o });

    console.log("-- the demo: three suppliers, three outcomes");
    const gp = await b.getSupplierProof(A.gupta.address, shop);
    ok("Gupta Wholesale: verified supplier (shop confirmed, six bills match the payments)", gp.status === "verified", `${gp.status}: ${gp.lines.filter((l) => l.result !== "pass").map((l) => l.id).join(",")}`);
    ok("Gupta's August bill still matches even after the Rs 2,000 credit note", gp.months.find((m) => m.month === "2026-08")!.result === "pass");
    const qp = await b.getSupplierProof(A.quick.address, shop);
    ok("QuickSupply: flagged, because the money for its bills came straight back", qp.status === "flagged" && qp.lines.find((l) => l.id === "payments")!.result === "fail");
    ok("QuickSupply: three months missing is unknown, and the shop has not answered", qp.lines.find((l) => l.id === "coverage")!.result === "unknown" && qp.link?.status === "pending");
    const ap = await b.getSupplierProof(A.selfdeal.address, shop);
    ok("Anand Traders: nothing uploaded, and it shares the shop's phone and bank account: flagged by independence", ap.lines.find((l) => l.id === "independent")!.result === "fail" && ap.statements.length === 0);

    console.log("-- uploading a bill: what is checked");
    await rejects("it must be a PDF", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form(), new TextEncoder().encode("hello, I am not a pdf ".repeat(20))));
    await rejects("not a file at all", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form(), "just text" as never));
    await rejects("too small to be a bill", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form(), new TextEncoder().encode("%PDF-1.4\n%%EOF")));
    await rejects("too big (the cloud database holds the file)", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form(), Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(450_000), Buffer.from("\n%%EOF\n")])));
    await rejects("a PDF with no ending is refused", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form(), Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(500, 97)])));
    await rejects("the month must be in the window", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form({ month: "2025-01" }), pdf(1)));
    await rejects("the total must be above zero", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form({ billedInr: 0 }), pdf(1)));
    await rejects("a bill count is needed", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form({ billCount: 0 }), pdf(1)));
    await rejects("the name on the bill is needed", "InvalidInput", () => b.submitStatement(A.gupta.address, shop, form({ nameOnBill: "" }), pdf(1)));
    await rejects("a payment app does not upload bills", "Forbidden", () => b.submitStatement(A.paylink.address, shop, form(), pdf(1)));
    await rejects("a lender is not an approved issuer", "IssuerNotApproved", () => b.submitStatement(A.asha.address, shop, form(), pdf(1)));
    await rejects("a shop the system does not know", "InvalidInput", () => b.submitStatement(A.gupta.address, "shop-9", form(), pdf(1)));
    await rejects("a supplier with no credential for that shop cannot upload for it", "InvalidInput", () => b.submitStatement(A.gupta.address, "shop-2", form(), pdf(1)));

    console.log("-- a corrected upload replaces the old one (the old one is kept)");
    const before = (await b.listStatements({ issuer: A.gupta.address })).filter((x) => x.month === "2026-05");
    const id = await b.submitStatement(A.gupta.address, shop, form({ billedInr: 46000, billCount: 5 }), pdf(2));
    const after = (await b.listStatements({ issuer: A.gupta.address })).filter((x) => x.month === "2026-05");
    ok("two uploads for May exist now, only the new one is current", after.length === before.length + 1 && after.filter((x) => x.current).length === 1 && after.find((x) => x.current)!.id === id);
    ok("the proof uses the corrected figure", (await b.getSupplierProof(A.gupta.address, shop)).months[0].billed === 46000);

    console.log("-- the file is really stored, and fingerprinted");
    const file = await readStatementFile(id);
    ok("it reads back byte for byte", !!file && Buffer.compare(file.bytes, pdf(2)) === 0);
    ok("the stored fingerprint is the file's SHA-256", (await b.listStatements({ issuer: A.gupta.address })).find((x) => x.id === id)!.fileHash === createHash("sha256").update(pdf(2)).digest("hex"));
    ok("a statement that does not exist has no file", (await readStatementFile(9999)) === null);

    console.log("-- the same PDF reused for another supplier is caught");
    const shared = sampleBillPdf({ supplier: "Copycat", customer: "Sharma Store", monthLabel: "Oct 2026", total: 9999, bills: 1 });
    await b.submitStatement(A.gupta.address, shop, form({ month: "2026-10", billedInr: 45500 }), shared);
    ok("one supplier alone with a new file: fine", (await b.getSupplierProof(A.gupta.address, shop)).lines.find((l) => l.id === "reuse")!.result === "pass");
    await b.submitStatement(A.quick.address, shop, form({ month: "2026-10", billedInr: 150000 }), shared);
    ok("the second supplier uploading the same file flags BOTH", (await b.getSupplierProof(A.gupta.address, shop)).lines.find((l) => l.id === "reuse")!.result === "fail" && (await b.getSupplierProof(A.quick.address, shop)).lines.find((l) => l.id === "reuse")!.result === "fail");

    console.log("-- the shop confirms its supplier");
    await rejects("only a supplier with a credential for the shop can ask", "InvalidInput", () => b.requestSupplierLink(A.gupta.address, "shop-2"));
    await rejects("asking twice while waiting is refused", "AlreadyAnswered", () => b.requestSupplierLink(A.quick.address, shop));
    await rejects("another business cannot answer for Sharma Store", "NotFound", () => b.confirmSupplierLink("shop-2", A.quick.address));
    await rejects("rejecting needs a reason", "InvalidInput", () => b.rejectSupplierLink(shop, A.quick.address, " "));
    await b.rejectSupplierLink(shop, A.quick.address, "We buy from them only sometimes.");
    ok("the shop's denial is recorded with its reason", (await b.getSupplierLinks({ issuer: A.quick.address }))[0].status === "rejected");
    await rejects("an answer is not silently replaced", "AlreadyAnswered", () => b.confirmSupplierLink(shop, A.quick.address));
    ok("a denied supplier is flagged", (await b.getSupplierProof(A.quick.address, shop)).lines.find((l) => l.id === "link")!.result === "fail");
    await b.requestSupplierLink(A.quick.address, shop);
    ok("after a denial the supplier may ask again", (await b.getSupplierLinks({ issuer: A.quick.address }))[0].status === "pending");
    await rejects("already confirmed suppliers cannot ask again", "AlreadyAnswered", () => b.requestSupplierLink(A.gupta.address, shop));

    console.log("-- the lender's report and the admin's case file");
    const rep = await b.getVerificationReport(shop);
    const gc = rep.credentials.find((x) => x.issuerName === "Gupta Wholesale")!, qc = rep.credentials.find((x) => x.issuerName === "QuickSupply")!, pc = rep.credentials.find((x) => x.issuerName === "PayLink")!;
    ok("each supplier's credential carries its proof; a payment app has none", !!gc.proof && !!qc.proof && pc.proof === null);
    ok("a flagged supplier proof flags the credential for the lender, with the reason", qc.trust === "flagged" && qc.trustReasons.some((t) => t.startsWith("Supplier proof")));
    const caseId = (await b.getCases())[0].file.id;
    const pdfText = caseReportPdf(await getCaseReport(caseId)).toString("latin1");
    ok("the admin's case file includes the supplier proof", pdfText.includes("Is this really the shop's supplier?") && pdfText.includes("The shop confirms this supplier"));
    void c;
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
