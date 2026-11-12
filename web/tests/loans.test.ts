import { contract as c, backend as b, demo, ACCOUNTS as A, ApiError, withState, resetEverything } from "./engine";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const rejects = async (n: string, f: () => Promise<unknown>, part = "") => { try { await f(); ok(n, false, "(no error)"); } catch (e) { ok(n, e instanceof ApiError && (e as Error).message.includes(part), (e as Error).message); } };
const rule = (d: any, id: string) => d.rules.find((r: any) => r.id === id);

import { suggestedAmount, distinctValidIssuers } from "../lib/lender";
(async () => {
  await resetEverything();
  await withState(() => demo.loadDemo());
  await withState(async () => {
    console.log("-- the demo's loan request");
    const open = await b.listLoans({ status: "requested" });
    ok("Shop 1 asked for Rs 20,000 over 6 months", open.length === 1 && open[0].shopId === "shop-1" && open[0].amountInr === 20000 && open[0].shopName === "Shop 1");

    console.log("-- the recommendation");
    let d = await b.getLoanDecision("shop-1", 20000, 6);
    ok("approve, limit Rs 22,500 (half of Issuer 1's verified Rs 45,167/month)", d.outcome === "approve" && d.limitInr === 22500, d.summary);
    ok("Issuer 3' failed claim is not counted as evidence", !rule(d, "evidence").reason.includes("Quick"));
    d = await b.getLoanDecision("shop-1", 30000, 6);
    ok("asking for more than the limit: approve UP TO the limit", d.outcome === "approve" && d.summary.includes("up to ₹22,500") && rule(d, "limit").result === "fail", d.summary);
    const m = await b.getLoanDecision("shop-2", 10000, 3);
    ok("Shop 2: not enough evidence, limit 0", m.outcome === "not_enough_evidence" && m.limitInr === 0);

    console.log("-- the shopkeeper's side");
    await rejects("a second open request is refused", () => b.requestLoan("shop-1", 5000, 3, "rent"), "already have a request");
    await rejects("too small an amount", () => b.requestLoan("shop-2", 500, 3, "stock"), "between ₹1,000");
    await rejects("too long a term", () => b.requestLoan("shop-2", 5000, 60, "stock"), "between 1 and 36");
    await rejects("no purpose", () => b.requestLoan("shop-2", 5000, 3, " "), "what the loan is for");
    await rejects("unknown shop", () => b.requestLoan("nobody", 5000, 3, "stock"), "don't know this shop");
    const mehta = await b.requestLoan("shop-2", 10000, 3, "New fridge");
    ok("Shop 2 can ask", mehta.status === "requested");

    console.log("-- the lender's side");
    await rejects("approving Shop 2 (not enough evidence) without a note is blocked", () => b.decideLoan(A.asha.address, mehta.id, true, 10000, ""), "Write a note");
    const sharma = open[0];
    await rejects("approving more than they asked for is refused", () => b.decideLoan(A.asha.address, sharma.id, true, 25000, ""), "they asked for");
  });

  console.log("-- decisions, withdrawal, stacking, expiry");
  await resetEverything();
  await withState(() => demo.loadDemo());
  await withState(async () => {
    const [sharma] = await b.listLoans({ shopId: "shop-1" });
    const done = await b.decideLoan(A.asha.address, sharma.id, true, 20000, "");
    ok("following the recommendation needs no note", done.status === "approved" && done.approvedInr === 20000 && done.recommendation === "approve");
    await rejects("a decided request can't be decided again", () => b.decideLoan(A.asha.address, sharma.id, false, 0, ""), "already approved");
    const log = await b.listAuditLog();
    ok("the decision is in the system log", log.some((l: any) => l.event === "loan_approved" && l.detail.includes("Lender 1")));

    const again = await b.requestLoan("shop-1", 15000, 6, "More stock");
    await b.withdrawLoan("shop-1", again.id);
    ok("the shop can withdraw a waiting request", (await b.listLoans({ shopId: "shop-1" }))[0].status === "withdrawn");
    const tooBig = await b.requestLoan("shop-1", 30000, 6, "Shop renovation");
    await rejects("approving Rs 25,000 (above the Rs 22,500 limit) without a note is blocked", () => b.decideLoan(A.asha.address, tooBig.id, true, 25000, ""), "Write a note");
    const capped = await b.decideLoan(A.asha.address, tooBig.id, true, 22500, "");
    ok("approving exactly the limit needs no note", capped.status === "approved" && capped.approvedInr === 22500);
    await rejects("a withdrawn request can't be decided", () => b.decideLoan(A.asha.address, again.id, true, 15000, ""), "already withdrawn");

    for (let i = 0; i < 3; i++) await c.verify(A.asha.address, "shop-1");
    const st = await b.getLoanDecision("shop-1", 10000, 6);
    ok("3 lender checks in 30 days: stacking -> review, limit halved to Rs 11,000", st.outcome === "review" && st.limitInr === 11000 && rule(st, "stacking").result === "fail", st.summary);
    const big = await b.requestLoan("shop-1", 22000, 6, "Stock");
    await rejects("approving during stacking without a note is blocked", () => b.decideLoan(A.asha.address, big.id, true, 10000, ""), "Write a note");
    const over = await b.decideLoan(A.asha.address, big.id, true, 10000, "Known customer for 3 years, called the shop.");
    ok("with a note, the lender can go beyond the recommendation (on the record)", over.status === "approved" && over.recommendation === "review" && !!over.note);

    await c.advanceTime(70); // credentials have under 30 days left
    const late = await b.getLoanDecision("shop-1", 5000, 6);
    ok("credentials about to expire don't count -> not enough evidence", late.outcome === "not_enough_evidence", late.summary);
  });
  console.log("-- lender helpers");
  ok("no verified numbers -> NO suggestion (0), not the amount asked for", suggestedAmount(100000, 0) === 0);
  ok("a limit lower than the ask -> suggest the limit", suggestedAmount(100000, 40000) === 40000);
  ok("an ask lower than the limit -> suggest the ask", suggestedAmount(20000, 40000) === 20000);
  const views = [
    { status: "Valid", credential: { issuer: "A" } }, { status: "Valid", credential: { issuer: "A" } }, { status: "Valid", credential: { issuer: "A" } },
    { status: "Valid", credential: { issuer: "B" } }, { status: "Revoked", credential: { issuer: "C" } }, { status: "Expired", credential: { issuer: "D" } },
  ];
  ok("6 credentials from 2 issuers with a valid status -> 2 distinct issuers", distinctValidIssuers(views) === 2);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
