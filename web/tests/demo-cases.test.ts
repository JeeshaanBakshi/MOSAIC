// The 5 demo cases the lender sees, end to end: Load demo, then read exactly what the Lender page reads.
import { contract as c, backend as b, demo, ACCOUNTS as A, withState, resetEverything } from "./engine";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const rule = (d: any, id: string) => d.rules.find((r: any) => r.id === id);

(async () => {
  await resetEverything();
  await withState(async () => {
    await demo.loadDemo();
    const open = await b.listLoans({ status: "requested" });
    ok("both demo shops have a loan request waiting", open.some((l) => l.shopId === "shop-1") && open.some((l) => l.shopId === "shop-3"));

    console.log("-- case 1: Sharma Store (honest): supplier + payment app, every check passes, a limit is shown");
    const sharma = await b.getChecks("shop-1");
    const by = (n: string) => sharma.find((e) => e.issuerName === n)!;
    ok("supplier (Issuer 1): checks 2, 3 and 4 all pass -> verified", by("Issuer 1").overall === "verified" && by("Issuer 1").checks.every((x) => x.result === "pass"));
    ok("payment app (Issuer 2): checks 2, 3 and 4 all pass -> verified", by("Issuer 2").overall === "verified" && by("Issuer 2").checks.every((x) => x.result === "pass"));
    const d = await b.getLoanDecision("shop-1", 20000, 6);
    ok("recommendation: approve, with a limit of Rs 22,500", d.outcome === "approve" && d.limitInr === 22500, d.summary);
    ok("no stacking warning yet", rule(d, "stacking").result === "pass");

    console.log("-- payment match and net flow use PAYMENT-APP data, never the supplier's own numbers");
    ok("Issuer 1's payment match names the payment app and the verified account", by("Issuer 1").checks[0].source.includes("Issuer 2") && by("Issuer 1").checks[0].source.includes(by("Issuer 1").verifiedAccount!));
    ok("Issuer 1's net flow subtracts the Rs 2,000 credit note (net Rs 45,167)", by("Issuer 1").checks[2].numbers.includes("₹45,167"), by("Issuer 1").checks[2].numbers);
    await b.submitSupplierSays(A.quick.address, "shop-1", [150000, 150000, 150000, 150000, 150000, 150000], 0); // QuickSupply says: sold 1.5 lakh, nothing sent back
    const q2 = (await b.getChecks("shop-1")).find((e) => e.issuerName === "Issuer 3")!;
    ok("QuickSupply's own rosy numbers are shown as 'Supplier says'...", q2.supplierSays?.avgPurchases === 150000 && q2.supplierSays.sentBackPerMonth === 0);
    ok("...but its claim still fails (checks use the payment app)", q2.overall === "failed" && q2.checks[2].result === "fail");

    console.log("-- case 2: fake shop, vouched only by QuickSupply, no payment-app receipts");
    const fake = await b.getChecks("shop-3");
    ok("one credential, from Issuer 3", fake.length === 1 && fake[0].issuerName === "Issuer 3");
    ok("payment match and net flow are UNKNOWN (no payment-app records), not failed", fake[0].checks[0].result === "unknown" && fake[0].checks[2].result === "unknown" && fake[0].overall === "unknown", fake[0].checks.map((x) => x.result).join(","));
    const fd = await b.getLoanDecision("shop-3", 100000, 6);
    ok("recommendation: not enough evidence, NO limit", fd.outcome === "not_enough_evidence" && fd.limitInr === 0, fd.summary);
    ok("the reason: needs an independent payment app. Unknown.", rule(fd, "evidence").reason.includes("Needs an independent payment app. Unknown"), rule(fd, "evidence").reason);

    console.log("-- case 3: self-dealing issuer shares the shop's phone and bank account");
    const sd = by("Issuer 4");
    ok("independence FAILS and says which fields matched", sd.checks[1].result === "fail" && sd.checks[1].reason.includes("phone") && sd.checks[1].reason.includes("bank account"), sd.checks[1].reason);
    ok("its claim is not counted (failed) and the lender is told why", sd.overall === "failed" && rule(d, "evidence").reason.includes("Issuer 4: independence failed"), rule(d, "evidence").reason);

    console.log("-- case 4: QuickSupply claims Rs 1,50,000 a month; payment app: Rs 1,50,000 out, Rs 1,40,000 back");
    const qk = by("Issuer 3");
    ok("payment match alone would pass (gross Rs 1,50,000)", qk.checks[0].result === "pass" && qk.checks[0].numbers.includes("₹1,50,000"));
    ok("net flow FAILS: Rs 1,40,000 came back, net Rs 10,000 vs Rs 1,05,000 needed", qk.checks[2].result === "fail" && qk.checks[2].numbers.includes("₹1,40,000") && qk.checks[2].numbers.includes("₹10,000") && qk.checks[2].numbers.includes("₹1,05,000"), qk.checks[2].numbers);
    ok("claim not counted, with the reason", rule(d, "evidence").reason.includes("Not counted: Issuer 3") && qk.overall === "failed");
    ok("the shop is NOT blamed: the failed claim does not lower Sharma's limit", d.limitInr === 22500);

    console.log("-- case 5: stacking, Sharma checked by 3 lenders in 30 days");
    await c.verify(A.asha.address, "shop-1");
    ok("after 1 check: still normal", rule(await b.getLoanDecision("shop-1", 20000, 6), "stacking").result === "pass");
    await c.simulateOtherLenderChecks("shop-1", 2);
    ok("the counter reads 3", (await c.checksLast30Days("shop-1")) === 3);
    const st = await b.getLoanDecision("shop-1", 20000, 6);
    ok("warning shown: stacking FAILS, outcome needs judgment, limit halved to Rs 11,000", rule(st, "stacking").result === "fail" && st.outcome === "review" && st.limitInr === 11000, `${st.outcome} ${st.limitInr}`);
    ok("30 days later the old checks fall out of the window", await (async () => { await c.advanceTime(31); return (await c.checksLast30Days("shop-1")) === 0; })());
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
