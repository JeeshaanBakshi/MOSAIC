import "server-only";
// The TESTNET INSPECTOR's data: everything the deployed MOSAIC contract holds, read straight from Stellar testnet
// (free simulated reads, no keys needed) plus its recent on-chain events. Nothing here comes from the website's simulation.
// Cached for a few seconds so many viewers don't hammer the public RPC.

import { CONTRACT_ID, EXPLORER, READ_ACCOUNT, arg, readPublic, rpcServer, scValToNative, xdr } from "./chain";

const USDC_ID = process.env.MOSAIC_USDC_ID ?? "CCHKZPFEDUIS2AIZXC3YKMBJMJ54LZI653PZQSQ23AMQLGHVEXXFTEFM";
const CACHE_MS = 8000;
const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
/** The demo's public testnet addresses (public by nature) and who they are. Override with MOSAIC_PARTICIPANTS="G...=Name,G...=Name". */
const PARTICIPANTS: Record<string, string> = process.env.MOSAIC_PARTICIPANTS
  ? Object.fromEntries(process.env.MOSAIC_PARTICIPANTS.split(",").map((x) => x.split("=") as [string, string]))
  : {
    GBAYZUXD6APJWPFJ4V35PPUYIUXUMM344SLSRDXXOPTI6K7KU5NBUGLP: "Admin",
    GAAM3XVZRIDVKCVGK64QSJ2NNQ4W62INUBSGCFM3SS42Z6FIFZD6LKH3: "Gupta Wholesale",
    GD6TTHD55ZKROUTGV2SICEI5KD3XLIQANMOD5DSWAGRWDSCJGRCCZJMB: "PayLink",
    GDRAZPI5YFQIOCDHGEIY677HHSACEAMZM2FDYBG2VYECMSOI2EMRJ7KL: "QuickSupply",
    GBOXEIWO3YPX7NHXMKASSX2V5CI5NNCSUMDLVRKLLMFQYW5KXHPSWSYR: "Anand Traders",
    GBUBHHHY4KNIN53RDN3BVMPO2UBX4ZR36MWRI5Y2JFX4NQM3DVGDJDH4: "Saathi Microfinance",
  };

/** bigint -> string, bytes -> hex, so the answer is plain JSON. */
function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.length === 1 && typeof v[0] === "string" ? v[0] : v.map(plain); // a unit enum such as ["Valid"] reads as "Valid"
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]));
  return v;
}

export interface ChainTx {
  id: string; txHash: string; time: string; ok: boolean;
  fn: string; // the contract function that was called, e.g. "issue_credential"
  caller: string; callerName: string | null; args: unknown[];
  transfers: { from: string; to: string; amount: string; asset: string }[]; // USDC (and XLM) that moved in this transaction
}
export interface ChainSnapshot {
  fetchedAt: number;
  network: "testnet";
  contractId: string;
  usdcId: string;
  explorer: string;
  latestLedger: number | null;
  config: Record<string, unknown> | null;
  contractUsdc: string | null; // USDC the contract holds (all stakes), in stroops
  issuers: Record<string, unknown>[];
  issuerRequests: Record<string, unknown>[];
  shops: { id: string; checksLast30Days: number | null; defaulted: boolean | null; credentials: Record<string, unknown>[] }[];
  disputes: Record<string, unknown>[];
  history: ChainTx[]; // every transaction that called the contract, newest first
  participants: Record<string, string>; // public address -> who it is in the demo
  problems: string[]; // anything that could not be read, said plainly
}

let cache: { at: number; snap: ChainSnapshot } | null = null;
let inflight: Promise<ChainSnapshot> | null = null;

export async function getChainSnapshot(): Promise<ChainSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snap;
  inflight ??= build().then((snap) => { cache = { at: Date.now(), snap }; return snap; }).finally(() => { inflight = null; });
  return inflight;
}

async function build(): Promise<ChainSnapshot> {
  const problems: string[] = [];
  const attempt = async <T,>(what: string, f: () => Promise<T>): Promise<T | null> => {
    try { return await f(); } catch (e) { problems.push(`${what}: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`); return null; }
  };
  const snap: ChainSnapshot = {
    fetchedAt: Date.now(), network: "testnet", contractId: CONTRACT_ID, usdcId: USDC_ID, explorer: EXPLORER,
    latestLedger: null, config: null, contractUsdc: null, issuers: [], issuerRequests: [], shops: [], disputes: [], history: [], participants: PARTICIPANTS, problems,
  };

  snap.latestLedger = (await attempt("latest ledger", async () => (await rpcServer().getLatestLedger()).sequence));
  const cfg = await attempt("get_config", () => readPublic<unknown>(CONTRACT_ID, "get_config", []));
  snap.config = cfg ? (plain(cfg) as Record<string, unknown>) : null;
  snap.contractUsdc = await attempt("USDC balance", async () => String(await readPublic<bigint>(USDC_ID, "balance", [arg.addr(CONTRACT_ID)])));
  snap.issuers = ((await attempt("list_issuers", () => readPublic<unknown[]>(CONTRACT_ID, "list_issuers", []))) ?? []).map((x) => plain(x) as Record<string, unknown>);
  snap.issuerRequests = ((await attempt("list_issuer_requests", () => readPublic<unknown[]>(CONTRACT_ID, "list_issuer_requests", []))) ?? []).map((x) => plain(x) as Record<string, unknown>);
  snap.disputes = ((await attempt("list_disputes", () => readPublic<unknown[]>(CONTRACT_ID, "list_disputes", []))) ?? []).map((x) => plain(x) as Record<string, unknown>);

  const shopIds = (await attempt("list_shops", () => readPublic<string[]>(CONTRACT_ID, "list_shops", []))) ?? [];
  snap.shops = await Promise.all(shopIds.map(async (id) => {
    const [creds, checks, defaulted] = await Promise.all([
      attempt(`get_credentials(${id})`, () => readPublic<unknown[]>(CONTRACT_ID, "get_credentials", [arg.str(id)])),
      attempt(`checks_last_30_days(${id})`, () => readPublic<number>(CONTRACT_ID, "checks_last_30_days", [arg.str(id)])),
      attempt(`has_defaulted(${id})`, () => readPublic<boolean>(CONTRACT_ID, "has_defaulted", [arg.str(id)])),
    ]);
    return { id, checksLast30Days: checks, defaulted, credentials: (creds ?? []).map((c) => plain(c) as Record<string, unknown>) };
  }));

  snap.history = (await attempt("transaction history", history)) ?? [];
  return snap;
}

/** One real transaction that called the MOSAIC contract, with the USDC it moved. From Horizon (the full history). */
async function history(): Promise<ChainTx[]> {
  const seen = new Map<string, ChainTx>();
  await Promise.all(Object.entries(PARTICIPANTS).map(async ([account]) => {
    const res = await fetch(`${HORIZON}/accounts/${account}/operations?order=desc&limit=100&include_failed=true`, { signal: AbortSignal.timeout(9000), cache: "no-store" });
    if (!res.ok) throw new Error(`Horizon answered ${res.status} for ${PARTICIPANTS[account]}`);
    const records = ((await res.json()) as { _embedded: { records: HorizonOp[] } })._embedded.records;
    for (const op of records) {
      if (op.type !== "invoke_host_function" || !op.parameters || op.parameters.length < 2 || seen.has(op.id)) continue;
      let target = "", fn = "";
      const decode = (p: { value: string }) => scValToNative(xdr.ScVal.fromXDR(p.value, "base64"));
      try { target = String(decode(op.parameters[0])); fn = String(decode(op.parameters[1])); } catch { continue; }
      if (target !== CONTRACT_ID) continue; // only calls to the MOSAIC contract
      const args = op.parameters.slice(2).map((p) => { try { return plain(decode(p)); } catch { return "?"; } });
      seen.set(op.id, {
        id: op.id, txHash: op.transaction_hash, time: op.created_at, ok: op.transaction_successful, fn, caller: op.source_account,
        callerName: PARTICIPANTS[op.source_account] ?? null, args,
        transfers: (op.asset_balance_changes ?? []).filter((c) => c.type === "transfer").map((c) => ({ from: c.from, to: c.to, amount: c.amount, asset: c.asset_code ?? "" })),
      });
    }
  }));
  return [...seen.values()].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 60);
}

interface HorizonOp {
  id: string; type: string; created_at: string; transaction_hash: string; transaction_successful: boolean; source_account: string;
  parameters?: { value: string; type: string }[];
  asset_balance_changes?: { type: string; from: string; to: string; amount: string; asset_code?: string }[];
}

export { READ_ACCOUNT };
