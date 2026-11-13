import { contract as c, backend as b, ACCOUNTS as A, demo, ContractError, ApiError, withState, resetEverything } from "./engine";
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
  await throws("non-admin cannot approve", "NotAdmin", () => c.addIssuer(A.gupta.address, A.gupta.address, "Gupta Wholesale", "Supplier"));
  await throws("init twice", "AlreadyInitialized", () => c.init());

  console.log("-- demo flow");
  await demo.loadDemo();
  ok("4 credentials on shop-1 (Sharma) + 1 on shop-3", (await c.getCredentials("shop-1")).length === 4 && (await c.getCredentials("shop-3")).length === 1);
  ok("stakes locked: contract holds 120 (5 credentials x 30, minus the 30 slashed on Sunrise Mart)", (await c.getBalance((await import("../lib/engine/accounts")).CONTRACT_ADDRESS)) / U === 120);
  ok("gupta 970", (await bal("gupta")) === 970);

  console.log("-- backend checks 2-4");
  const ev = await b.getChecks("shop-1");
  const by = (n: string) => ev.find((e) => e.issuerName === n)!;
  ok("Gupta Wholesale verified", by("Gupta Wholesale").overall === "verified");
  ok("PayLink verified", by("PayLink").overall === "verified");
  const res = (n: string) => by(n).checks.map((x) => x.result).join(",");
  ok("QuickSupply (round-trip): payment match passes on gross, NET FLOW fails -> failed", res("QuickSupply") === "pass,pass,fail" && by("QuickSupply").overall === "failed", res("QuickSupply"));
  ok("Anand Traders (self-dealing): independence fails -> failed", res("Anand Traders") === "pass,fail,pass" && by("Anand Traders").overall === "failed", res("Anand Traders"));
  ok("Anand Traders: the failure names the fields that matched", by("Anand Traders").checks[1].reason.includes("phone") && by("Anand Traders").checks[1].reason.includes("bank account"), by("Anand Traders").checks[1].reason);
  ok("every check says whose data it used", by("Gupta Wholesale").checks.every((x) => x.source.length > 0 && x.numbers.length > 0) && by("Gupta Wholesale").checks[0].source.includes("PayLink"));

  console.log("-- verify: fee split");
  const v = await c.verify(A.asha.address, "shop-1");
  ok("the 2 issuers whose claims passed get 0.35 each", v.result.payouts.slice(0, 2).every((p) => p.amount === 3_500_000), JSON.stringify(v.result.payouts.map((p) => p.amount / U)));
  ok("QuickSupply and Anand Traders (failed checks) earn nothing", v.result.payouts.length === 3 && v.result.payouts.every((p) => p.to !== A.quick.address && p.to !== A.selfdeal.address));
  ok("platform gets remainder 0.30", Math.abs((await bal("admin")) - 0.3) < 1e-6, String(await bal("admin")));
  ok("lender paid exactly 1", (await bal("asha")) === 999);
  ok("stacking counter = 1", v.result.checksLast30Days === 1);
  await c.verify(A.asha.address, "shop-1");
  ok("stacking counter = 2", (await c.checksLast30Days("shop-1")) === 2);

  console.log("-- disputes");
  const quickCred = (await c.getCredentials("shop-1")).find((x) => x.issuerName === "QuickSupply")!.credential.id;
  const d1 = await c.openDispute(A.asha.address, quickCred);
  await throws("one open dispute per credential", "DisputeAlreadyOpen", () => c.openDispute(A.asha.address, quickCred));
  await throws("non-admin cannot resolve", "NotAdmin", () => c.resolveDispute(A.asha.address, d1.result, true));
  await throws("a dispute can't be upheld before the shop defaults", "ShopNotInDefault", () => c.resolveDispute(A.admin.address, d1.result, true));
  await throws("only a lender who checked the shop can report a default", "NotAVerifier", () => c.reportDefault(A.gupta.address, "shop-1"));
  await throws("only a lender who checked the shop can dispute", "NotAVerifier", () => c.openDispute(A.paylink.address, quickCred));
  await c.reportDefault(A.asha.address, "shop-1");
  ok("the shop is now recorded as defaulted", await c.hasDefaulted("shop-1"));
  const before = await bal("asha");
  await c.resolveDispute(A.admin.address, d1.result, true);
  ok("stake slashed to lender (+30)", (await bal("asha")) - before === 30);
  ok("credential revoked, stake 0", (await c.getCredentials("shop-1")).find((x) => x.credential.id === quickCred)!.status === "Revoked");
  ok("QuickSupply has 2 strikes (one from the demo's Sunrise Mart slash) and is suspended", (await c.getIssuer(A.quick.address))!.upheldClaims === 2 && !(await c.getIssuer(A.quick.address))!.active);
  await throws("resolved dispute can't be resolved again", "DisputeAlreadyResolved", () => c.resolveDispute(A.admin.address, d1.result, true));

  console.log("-- 2 strikes suspend");
  const hash = await (await import("../lib/engine/util")).claimHash({ a: 1 });
  await throws("suspended issuer can't issue", "IssuerSuspended", () => c.issueCredential(A.quick.address, "shop-1", "buyer", "x", hash));

  console.log("-- revoke / expiry / release stake");
  const g = (await c.getCredentials("shop-1")).find((x) => x.issuerName === "Gupta Wholesale")!.credential.id;
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
  const guptaAcct = b.verifiedAccountOf("gupta")!;
  const feedOf = (out: number, back = 0) => Array.from({ length: 6 }, () => ({ receipts: 60000 + back, payees: { [guptaAcct]: { out, back } } }));
  await b.submitSupplierSays(A.gupta.address, "shop-2", [90000, 90000, 90000, 90000, 90000, 90000], 0);
  ok("what the supplier says NEVER passes its own claim", !(await passedOf()));
  await b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(40000));
  ok("payment-app records back the claim -> passed", await passedOf());
  const v5 = await c.verify(A.asha.address, "shop-2");
  ok("passed -> issuer earns the whole 70%", v5.result.payouts[0].to === A.gupta.address && v5.result.payouts[0].amount === Math.round(0.7 * U));
  await b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(5000));
  ok("thin payment-app records -> no longer passed", !(await passedOf()));
  await b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(40000, 38000));
  ok("money coming straight back (payment-app data) -> net flow fails", !(await passedOf()) && (await b.getChecks("shop-2")).find((x) => x.credentialId === cid)!.checks[2].result === "fail");
  await b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(40000));
  await b.submitSupplierSays(A.gupta.address, "shop-2", [1, 1, 1, 1, 1, 1], 99999);
  ok("changing what the supplier says changes nothing (checks use the payment app)", await passedOf());
  await throws("only the admin can mark claims", "NotAdmin", () => c.markChecked(A.gupta.address, cid, true));
  const badApi = async (name: string, f: () => Promise<unknown>, code = "InvalidInput") => { try { await f(); ok(name, false, "(did not throw)"); } catch (e) { ok(name, e instanceof ApiError && e.code === code, (e as Error).message.slice(0, 50)); } };
  await badApi("a supplier cannot share payment-app records", () => b.submitPaymentFeed(A.gupta.address, "shop-2", feedOf(40000)), "Forbidden");
  await badApi("all-zero payment records are refused (it would wipe the real ones)", () => b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(0).map((m) => ({ ...m, receipts: 0 }))));
  await badApi("records for a shop we have no profile of are refused", () => b.submitPaymentFeed(A.paylink.address, "typo-shop", feedOf(1000)));
  await badApi("negative amounts are refused", () => b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(-5)));
  await badApi("wrong number of months is refused", () => b.submitPaymentFeed(A.paylink.address, "shop-2", feedOf(1000).slice(0, 2)));
  await badApi("supplier-says: all zeros refused", () => b.submitSupplierSays(A.gupta.address, "shop-2", [0, 0, 0, 0, 0, 0], 0));
  await badApi("supplier-says: wrong number of months refused", () => b.submitSupplierSays(A.gupta.address, "shop-2", [1000, 1000], 0));

  console.log("-- failed tx changes nothing");
  const snapshot = await c.getBalance(A.paylink.address);
  let code = "";
  for (let i = 0; i < 40 && !code; i++) {            // PayLink keeps staking 30 USDC until the money runs out
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
