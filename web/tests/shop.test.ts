import { contract as c, backend as b, demo, ACCOUNTS as A, withState, resetEverything } from "./engine";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const chk = (r: any, id: string) => r.checks.find((x: any) => x.id === id);

(async () => {
  console.log("-- issuer identity: someone using Issuer 1's GST number with their own details");
  await resetEverything();
  await withState(async () => {
    const g = b.exampleApplication("gupta")!;
    await b.submitApplication(A.gupta.address, { ...g, ownerName: "Jeeshaan Bakshi", phone: "5485773822", email: "someone@gmail.com" });
    const r = (await b.getReview(A.gupta.address))!;
    ok("registration still passes (the business exists)", chk(r, "registration").result === "pass");
    ok("but the applicant is NOT the registered owner", chk(r, "owner").result === "fail", chk(r, "owner").reason);
    ok("and the contact does NOT match the registry", chk(r, "contact").result === "fail", chk(r, "contact").reason);
    ok("the contact reason masks the email on record", chk(r, "contact").reason.includes("i***@issuer1.example") && !chk(r, "contact").reason.includes("issuer1@"));
    ok("-> recommend reject, approval blocked without a manual review", r.verdict === "recommend_reject" && !r.approval.allowed);
    await b.submitApplication(A.gupta.address, g);
    const r2 = (await b.getReview(A.gupta.address))!;
    ok("the real owner + registered email pass both new checks", chk(r2, "owner").result === "pass" && chk(r2, "contact").result === "pass");
    ok("a slightly different spelling of the owner still passes (Issuer 1 Owner Kumar)", await (async () => { await b.submitApplication(A.gupta.address, { ...g, ownerName: "Issuer 1 Owner Kumar" }); return chk((await b.getReview(A.gupta.address))!, "owner").result === "pass"; })());
    ok("matching phone alone is enough for the contact check", await (async () => { await b.submitApplication(A.gupta.address, { ...g, email: "anil.personal@gmail.com" }); return chk((await b.getReview(A.gupta.address))!, "contact").result === "pass"; })());
    await b.submitApplication(A.paylink.address, b.exampleApplication("paylink")!);
    const p = (await b.getReview(A.paylink.address))!;
    ok("Issuer 2: owner on the RBI licence matches (Issuer 2 Owner)", chk(p, "owner").result === "pass" && chk(p, "contact").result === "pass");
    ok("8 checks in total", p.checks.length === 8);
  });

  console.log("-- shop review: Shop 1 after Load demo");
  await resetEverything();
  await withState(() => demo.loadDemo());
  await withState(async () => {
    const r = await b.getShopReview("shop-1");
    ok("verdict: looks genuine", r.verdict === "looks_genuine", r.verdictReason);
    ok("the reason says the failed claims (Issuer 3, Issuer 4) are ignored", r.verdictReason.includes("Issuer 3") && r.verdictReason.includes("Issuer 4"));
    ok("4 issuers, 6 months of records each", r.issuers.length === 4 && r.issuers.every((i: any) => i.months.length === 6));
    const g = r.issuers.find((i: any) => i.issuerName === "Issuer 1")!;
    ok("Issuer 1: credit note subtracted in August", g.months.find((m: any) => m.month === "2026-08")!.returned === 2000);
    ok("Issuer 1: average net purchases ~Rs 45,167", Math.round(g.avgNet) === 45167, String(Math.round(g.avgNet)));
    const q = r.issuers.find((i: any) => i.issuerName === "Issuer 3")!;
    ok("Issuer 3: Rs 1,50,000 paid, Rs 1,40,000 back every month -> net 10,000", q.months.every((m: any) => m.paid === 150000 && m.returned === 140000 && m.net === 10000));
    ok("receipts cover all 6 months", chk(r, "coverage").result === "pass");
    ok("purchases are 77% of receipts (failed claims are not counted)", chk(r, "ratio").result === "pass" && chk(r, "ratio").reason.includes("77%"), chk(r, "ratio").reason);
    ok("issuers independent of each other", chk(r, "issuers_independent").result === "pass");
    ok("claims backed: fails, naming Issuer 3, blaming the issuer not the shop", chk(r, "claims_backed").result === "fail" && chk(r, "claims_backed").reason.includes("not the shop"));
    const m = await b.getShopReview("shop-2");
    ok("Shop 2 (no credentials): not enough evidence, never 'bad'", m.verdict === "not_enough_evidence" && m.verdictReason.includes("Unknown is not bad"));
    const u = await b.getShopReview("nobody");
    ok("unknown shop id: not on file -> unknown", chk(u, "on_file").result === "unknown" && u.verdict === "not_enough_evidence");
  });

  console.log("-- shop review: only one kind of evidence / only a bad claim");
  await resetEverything();
  await withState(async () => {
    for (const r of ["gupta", "quick"] as const) await c.addIssuer(A.admin.address, A[r].address, A[r].name, "Supplier");
    await c.addIssuer(A.admin.address, A.paylink.address, A.paylink.name, "PaymentProvider"); // shares records, but makes no claim of its own
    await c.issueCredential(A.quick.address, "shop-1", "buyer", "Buys Rs 2,00,000/month", "00");
    let r = await b.getShopReview("shop-1");
    ok("only Quick's claim, no payment-app records -> not enough evidence", r.verdict === "not_enough_evidence");
    const acct = (n: "gupta" | "quick") => b.verifiedAccountOf(n)!;
    await b.submitPaymentFeed(A.paylink.address, "shop-1", Array.from({ length: 6 }, () => ({ receipts: 60000 + 190000, payees: { [acct("gupta")]: { out: 45000, back: 0 }, [acct("quick")]: { out: 200000, back: 190000 } } })));
    r = await b.getShopReview("shop-1");
    ok("with records, Quick's round-trip claim fails -> still not enough evidence", r.verdict === "not_enough_evidence");
    await c.issueCredential(A.gupta.address, "shop-1", "buyer", "Buys Rs 45,000/month", "00");
    r = await b.getShopReview("shop-1");
    ok("one honest supplier, no payment provider -> needs review (one kind of evidence)", r.verdict === "needs_review" && r.verdictReason.includes("one kind"), r.verdictReason);
    ok("ratio is unknown without a payment provider", chk(r, "ratio").result === "unknown");
  });

  console.log("-- shop review: issuers secretly connected");
  await resetEverything();
  await withState(() => demo.loadDemo());
  await withState(async () => {
    const p = b.exampleApplication("paylink")!;
    await b.submitApplication(A.paylink.address, { ...p, phone: "+91 97300 33333" }); // Issuer 2's application now shows Issuer 1's phone
    const r = await b.getShopReview("shop-1");
    ok("two issuers sharing a phone -> independence fails", chk(r, "issuers_independent").result === "fail", chk(r, "issuers_independent").reason);
    ok("-> verdict needs review", r.verdict === "needs_review");
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
