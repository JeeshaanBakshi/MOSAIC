// The testnet mirror, without touching the network (STELLAR_RPC_URL points at a closed port in the test script).
//   - no keys: transactions are plain "simulated" ones
//   - keys but the chain can't be reached: the caller gets "Not sent to Stellar" and the simulated change is UNDONE
//   - the demo loader never sends anything to the chain
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { contract as c, backend as b, demo, ACCOUNTS as A, ApiError, withState, resetEverything } from "./engine";
import { arg } from "../lib/server/chain";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };

(async () => {
  await resetEverything();
  await withState(async () => {
    console.log("-- no keys: everything stays simulated and says so");
    delete process.env.STELLAR_SECRET_ADMIN;
    await demo.loadDemo();
    const hash = "ab".repeat(32);
    const t = await c.issueCredential(A.gupta.address, "shop-2", "on_time", "Pays on time, ₹40,000 a month", hash);
    ok("issue works and is marked simulated", t.onchain === false && typeof t.hash === "string");
    ok("activity entry is not marked on-chain", (await c.listActivity())[0].onchain !== true);

    console.log("-- keys set, chain unreachable: not sent, and the simulated change is undone");
    for (const r of ["ADMIN", "SUPPLIER", "LENDER", "PAYMENT_APP"]) process.env[`STELLAR_SECRET_${r}`] = Keypair.random().secret();
    const before = (await c.getCredentials("shop-2")).length;
    const log0 = (await c.listActivity()).length;
    const bal0 = await c.getBalance(A.gupta.address);
    try {
      await c.issueCredential(A.gupta.address, "shop-2", "receipts", "Receipts above ₹50,000", hash);
      ok("a chain failure is reported", false, "(no error)");
    } catch (e) {
      ok("a chain failure is reported as NotSentToStellar", e instanceof ApiError && e.code === "NotSentToStellar", (e as Error).message.slice(0, 80));
      ok("the message says it was not sent and nothing changed", /Not sent to Stellar/.test((e as Error).message) && /Nothing was changed/.test((e as Error).message));
    }
    ok("the simulated credential was rolled back", (await c.getCredentials("shop-2")).length === before);
    ok("the stake was not taken", (await c.getBalance(A.gupta.address)) === bal0);
    ok("no activity entry was left behind", (await c.listActivity()).length === log0);
    try { await c.verify(A.asha.address, "shop-2"); ok("verify chain failure", false, "(no error)"); } catch (e) { ok("verify is also refused when the chain can't be reached (no fake success)", e instanceof ApiError && e.code === "NotSentToStellar"); }
    ok("the stacking counter was rolled back too", (await c.checksLast30Days("shop-2")) === 0);

  });
  console.log("-- the demo loader and time-skips never touch the chain");
  await resetEverything();
  await withState(async () => {
    try { await demo.loadDemo(); ok("loading the demo works even though the chain is unreachable (it is simulated only)", true); }
    catch (e) { ok("loading the demo works even though the chain is unreachable", false, (e as Error).message.slice(0, 80)); }
    await c.advanceTime(30);
    ok("time-skip works (simulation only)", true);

    console.log("-- the switch");
    process.env.CHAIN_MIRROR = "off";
    const t = await c.issueCredential(A.gupta.address, "shop-2", "on_time", "Pays on time, ₹40,000 a month", "cd".repeat(32));
    ok("CHAIN_MIRROR=off keeps keys from being used", t.onchain === false);
  });

  console.log("-- argument encoding");
  ok("a claim hash becomes exactly 32 bytes", scValToNative(arg.bytes32("ab".repeat(32))).length === 32);
  ok("a short hash is padded to 32 bytes", scValToNative(arg.bytes32("ab")).length === 32);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
