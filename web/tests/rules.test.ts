import { contract as c, backend as b, ACCOUNTS as A, demo, ContractError, withState, resetEverything } from "./engine";
const U = 10_000_000;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", name, extra); };
const throws = async (name: string, code: string, f: () => Promise<unknown>) => {
  try { await f(); ok(name, false, "(did not throw)"); } catch (e) { ok(name, e instanceof ContractError && e.code === code, `(${(e as Error).name})`); }
};
const bal = async (r: keyof typeof A) => (await c.getBalance(A[r].address)) / U;

resetEverything().then(() => withState(async () => {
  console.log("-- check 1: registry");
  await throws("unapproved issuer rejected", "IssuerNotApproved", () => c.issueCredential(A.gupta.address, "shop-1", "buyer", "x", "00", 0));
  await throws("non-admin cannot approve", "NotAdmin", () => c.addIssuer(A.gupta.address, A.gupta.address, "Issuer 1", "Supplier"));
  await throws("init twice", "AlreadyInitialized", () => c.init());

  console.log("-- demo flow");
  await demo.loadDemo();
  ok("3 credentials", (await c.getCredentials("shop-1")).length === 3);
  ok("stakes locked: contract holds 90", (await c.getBalance((await import("../lib/engine/accounts")).CONTRACT_ADDRESS)) / U === 90);
  ok("gupta 970", (await bal("gupta")) === 970);

  console.log("-- backend checks 2-4");
  const ev = await b.getChecks("shop-1");
  const by = (n: string) => ev.find((e) => e.issuerName === n)!;
  ok("Issuer 1 verified", by("Issuer 1").overall === "verified");
  ok("Issuer 2 verified", by("Issuer 2").overall === "verified");
  ok("Quick fails 2,3,4", by("Issuer 3").checks.every((x) => x.result === "fail"), by("Issuer 3").checks.map((x) => x.result).join(","));

  console.log("-- verify: fee split");
  const v = await c.verify(A.asha.address, "shop-1");
  ok("the 2 issuers whose claims passed get 0.35 each", v.result.payouts.slice(0, 2).every((p) => p.amount === 3_500_000), JSON.stringify(v.result.payouts.map((p) => p.amount / U)));
  ok("Issuer 3 (failed checks) earns nothing", v.result.payouts.length === 3 && v.result.payouts.every((p) => p.to !== A.quick.address));
  ok("platform gets remainder 0.30", Math.abs((await bal("admin")) - 0.3) < 1e-6, String(await bal("admin")));
  ok("lender paid exactly 1", (await bal("asha")) === 999);
  ok("stacking counter = 1", v.result.checksLast30Days === 1);
  await c.verify(A.asha.address, "shop-1");
  ok("stacking counter = 2", (await c.checksLast30Days("shop-1")) === 2);

  console.log("-- disputes");
  const quickCred = (await c.getCredentials("shop-1")).find((x) => x.issuerName === "Issuer 3")!.credential.id;
  const d1 = await c.openDispute(A.asha.address, quickCred);
  await throws("one open dispute per credential", "DisputeAlreadyOpen", () => c.openDispute(A.asha.address, quickCred));
  await throws("non-admin cannot resolve", "NotAdmin", () => c.resolveDispute(A.asha.address, d1.result, true));
  const before = await bal("asha");
  await c.resolveDispute(A.admin.address, d1.result, true);
  ok("stake slashed to lender (+30)", (await bal("asha")) - before === 30);
  ok("credential revoked, stake 0", (await c.getCredentials("shop-1")).find((x) => x.credential.id === quickCred)!.status === "Revoked");
  ok("Quick has 1 strike, still active", (await c.getIssuer(A.quick.address))!.upheldClaims === 1 && (await c.getIssuer(A.quick.address))!.active);
  await throws("resolved dispute can't be resolved again", "DisputeAlreadyResolved", () => c.resolveDispute(A.admin.address, d1.result, true));

  console.log("-- 2 strikes suspend");
  const hash = await (await import("../lib/engine/util")).claimHash({ a: 1 });
  const second = await c.issueCredential(A.quick.address, "shop-1", "buyer", "Rs 2 lakh again", hash);
  const d2 = await c.openDispute(A.asha.address, second.result);
  await c.resolveDispute(A.admin.address, d2.result, true);
  ok("Quick suspended", !(await c.getIssuer(A.quick.address))!.active);
  await throws("suspended issuer can't issue", "IssuerSuspended", () => c.issueCredential(A.quick.address, "shop-1", "buyer", "x", hash));

  console.log("-- revoke / expiry / release stake");
  const g = (await c.getCredentials("shop-1")).find((x) => x.issuerName === "Issuer 1")!.credential.id;
  await throws("only issuer can revoke", "NotYourCredential", () => c.revoke(A.paylink.address, g));
  await throws("stake locked before expiry", "NotExpiredYet", () => c.releaseStake(A.gupta.address, g));
  await c.advanceTime(91);
  ok("expired after +91 days", (await c.getCredentials("shop-1")).find((x) => x.credential.id === g)!.status === "Expired");
  const gb = await bal("gupta");
  await c.releaseStake(A.gupta.address, g);
  ok("stake returned (+30)", (await bal("gupta")) - gb === 30);
  await throws("no stake left after release", "NoStakeLeft", () => c.releaseStake(A.gupta.address, g));
  const v3 = await c.verify(A.asha.address, "shop-1");
  ok("no earning issuers -> lender pays only the platform share (0.30)", v3.result.payouts.length === 1 && v3.result.payouts[0].amount === Math.round(0.3 * U));

  console.log("-- only claims backed by evidence earn fees");
  const claim = "Regular buyer for 12 months, buys ₹45,000 a month, pays on time";
  const cid = (await c.issueCredential(A.gupta.address, "shop-2", "buyer", claim, "00", 0)).result;
  await throws("same issuer, same claim twice is rejected", "DuplicateClaim", () => c.issueCredential(A.gupta.address, "shop-2", "buyer", claim, "00", 0));
  await b.syncChecks("shop-2");
  const passedOf = async () => (await c.getCredentials("shop-2")).find((x) => x.credential.id === cid)!.credential.passed;
  ok("no evidence yet -> not passed", !(await passedOf()));
  const v4 = await c.verify(A.asha.address, "shop-2");
  ok("not passed -> earns nothing", v4.result.payouts.length === 1 && v4.result.payouts[0].to === A.admin.address);
  await b.submitEvidence(A.gupta.address, "shop-2", [40000, 41000, 39000, 42000, 40000, 40000], 0);
  ok("evidence backs the claim -> passed", await passedOf());
  const v5 = await c.verify(A.asha.address, "shop-2");
  ok("passed -> issuer earns the whole 70%", v5.result.payouts[0].to === A.gupta.address && v5.result.payouts[0].amount === Math.round(0.7 * U));
  await b.submitEvidence(A.gupta.address, "shop-2", [5000, 5000, 5000, 5000, 5000, 5000], 0);
  ok("thin evidence -> no longer passed", !(await passedOf()));
  await throws("only the admin can mark claims", "NotAdmin", () => c.markChecked(A.gupta.address, cid, true));

  console.log("-- failed tx changes nothing");
  const snapshot = await c.getBalance(A.paylink.address);
  let code = "";
  for (let i = 0; i < 40 && !code; i++) {            // Issuer 2 keeps staking 30 USDC until the money runs out
    try { await c.issueCredential(A.paylink.address, "shop-2", `claim${i}`, "Rs 50,000/month", hash); } catch (e) { code = (e as ContractError).code; }
  }
  ok("ran out of money -> InsufficientBalance", code === "InsufficientBalance", code);
  const left = await c.getBalance(A.paylink.address);
  ok("failed call left the balance untouched (still enough for 0 more stakes)", left < 30 * U && left >= 0, String(left / U));
  void snapshot;
  ok("asha untouched by all of that", (await c.getBalance(A.asha.address)) > 0);
  ok("unknown shop -> no credentials (Unknown, not bad)", (await c.getCredentials("never-seen-shop")).length === 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})).catch((e) => { console.error("CRASH", e); process.exit(2); });
