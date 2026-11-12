import { backend as b, ACCOUNTS as A, ApiError, withState, resetEverything } from "./engine";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ok  " : "  FAIL", n, x); };

(async () => {
  await resetEverything();
  await withState(async () => {
    const g = b.exampleApplication("gupta")!;
    for (let i = 1; i <= 5; i++) await b.submitApplication(A.gupta.address, g);
    ok("5 codes per hour to one address are allowed", true);
    try { await b.submitApplication(A.gupta.address, g); ok("the 6th is refused", false); }
    catch (e) { ok("the 6th submit is refused (RateLimited)", e instanceof ApiError && e.code === "RateLimited", (e as Error).message); }
    try { await b.resendOtp(A.gupta.address); ok("resend refused too", false); }
    catch (e) { ok("a resend counts against the same limit", e instanceof ApiError && e.code === "RateLimited"); }
    await b.submitApplication(A.paylink.address, b.exampleApplication("paylink")!);
    ok("a different email address is not affected", true);
    const log = await b.listAuditLog();
    ok("the block is in the system log, with a masked address", log.some((l: any) => l.event === "rate_limited" && l.detail.includes("i***@") && !l.detail.includes("issuer1@")));
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
