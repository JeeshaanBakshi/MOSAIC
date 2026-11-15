// The testnet inspector must never crash or hang when Stellar is unreachable: it reports what it could not read.
import { getChainSnapshot } from "../lib/server/chainState";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✔" : "  ✘ FAIL", n, x); };
(async () => {
  console.log("-- testnet inspector with no network");
  const s = await getChainSnapshot(); // STELLAR_RPC_URL and HORIZON_URL point at a dead port in the test script
  ok("it answers instead of throwing", !!s && s.network === "testnet");
  ok("it names what it could not read", s.problems.length > 0, s.problems[0]?.slice(0, 60));
  ok("it still says which contract it is about", s.contractId.startsWith("C") && s.contractId.length === 56);
  ok("nothing is invented: no credentials or history when nothing could be read", s.shops.length === 0 && s.history.length === 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
