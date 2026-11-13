import "server-only";
// The bridge to the REAL MOSAIC contract on Stellar TESTNET.
//
// The website's engine (lib/engine) is a simulation that reads and writes the cloud database. This module MIRRORS its
// writes: each action is also sent to the deployed contract, signed here on the server with a testnet key per demo role.
// Those keys live ONLY in environment variables (Vercel "Secret" vars, or a local .env). They are never in the repo.
//
// If no admin key is set, mirroring is off and every transaction is labelled "simulated".
// If mirroring is on and a call fails, the caller gets a "NotSentToStellar" error and the simulated change is undone.
//
// Docs used: https://developers.stellar.org/docs/build/guides/transactions/invoke-contract-tx-sdk
//            (build -> simulate/prepare -> sign -> send -> poll)

import {
  Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";
import type { RoleId } from "../engine/accounts";
import { ApiError } from "../engine/types";

export const NETWORK = "testnet";
const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
export const CONTRACT_ID = process.env.MOSAIC_CONTRACT_ID ?? "CBEGE446VFXBKELMBXSLQZGVX3QMCQJMKUU5MXIKK6CO2KF7C575CYDG";
export const EXPLORER = "https://stellar.expert/explorer/testnet";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const contractUrl = () => `${EXPLORER}/contract/${CONTRACT_ID}`;

/** Which environment variable holds each demo role's testnet secret key. Names only: never put values in the repo. */
export const SECRET_ENV: Record<RoleId, string> = {
  admin: "STELLAR_SECRET_ADMIN",
  gupta: "STELLAR_SECRET_SUPPLIER",
  paylink: "STELLAR_SECRET_PAYMENT_APP",
  quick: "STELLAR_SECRET_QUICKSUPPLY",
  selfdeal: "STELLAR_SECRET_SELFDEALER",
  asha: "STELLAR_SECRET_LENDER",
};

/** Contract error numbers (the Rust `Error` enum) to names, so a refusal reads clearly. */
const ERROR_NAMES: Record<number, string> = {
  1: "AlreadyInitialized", 2: "NotInitialized", 3: "IssuerNotApproved", 4: "IssuerSuspended", 5: "CredentialNotFound",
  6: "NotYourCredential", 7: "DuplicateClaim", 8: "InvalidTtl", 9: "InvalidAmount", 10: "TooManyCredentials", 11: "InputTooLong",
  12: "AlreadyApproved", 13: "RequestAlreadyPending", 14: "RequestNotFound", 15: "DisputeNotFound", 16: "DisputeAlreadyOpen",
  17: "DisputeAlreadyResolved", 18: "NotExpiredYet", 19: "NoStakeLeft", 20: "ShopNotInDefault", 21: "NotAVerifier",
};

/** Mirroring is on when the admin key is set (and it hasn't been switched off). */
export const chainEnabled = () => !!process.env[SECRET_ENV.admin] && process.env.CHAIN_MIRROR !== "off";

export class ChainError extends ApiError {
  constructor(detail: string, readonly contractError?: string) {
    super("NotSentToStellar", `Not sent to Stellar: ${detail}. Nothing was changed.`);
  }
}

const server = () => new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") }); // plain http only for a local test server

/** The public RPC sometimes answers "not found" or drops a request for an account that exists. Ask again a few times. */
async function withRetry<T>(f: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await f(); } catch (e) {
      if (/Error\(Contract/.test(String((e as Error)?.message ?? e))) throw e; // the contract said no: asking again won't change that
      last = e; await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}

export function keypairOf(role: RoleId): Keypair {
  const secret = process.env[SECRET_ENV[role]];
  if (!secret) throw new ChainError(`the server has no testnet key for ${role} (${SECRET_ENV[role]} is not set)`);
  try { return Keypair.fromSecret(secret); } catch { throw new ChainError(`${SECRET_ENV[role]} is not a valid Stellar secret key`); }
}
export const publicKeyOf = (role: RoleId) => keypairOf(role).publicKey();

// ---------- argument helpers (how a TypeScript value becomes a contract value) ----------
export const arg = {
  addr: (pub: string) => new Address(pub).toScVal(),
  str: (s: string) => nativeToScVal(s, { type: "string" }),
  sym: (s: string) => nativeToScVal(s, { type: "symbol" }),
  u64: (n: number) => nativeToScVal(BigInt(n), { type: "u64" }),
  bool: (b: boolean) => nativeToScVal(b, { type: "bool" }),
  /** The claim hash is a 64-character hex string; the contract wants 32 raw bytes. */
  bytes32: (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex.padStart(64, "0").slice(-64), "hex")),
  /** A unit enum such as IssuerKind::Supplier is a one-element vector holding its name. */
  kind: (k: string) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(k)]),
};

function explain(e: unknown): { detail: string; contractError?: string } {
  const text = e instanceof Error ? e.message : String(e);
  const m = text.match(/Error\(Contract, #(\d+)\)/);
  if (m) {
    const name = ERROR_NAMES[Number(m[1])] ?? `error #${m[1]}`;
    return { detail: `the contract refused it (${name})`, contractError: name };
  }
  if (/insufficient|balance/i.test(text)) return { detail: "not enough test USDC or XLM in the signing account" };
  return { detail: text.slice(0, 160) };
}

export interface ChainResult<T = unknown> {
  hash: string;
  value: T;
  /** USDC transfers this transaction made, read from its events: the REAL fee split on verify. */
  transfers: { from: string; to: string; amount: bigint }[];
  skipped?: string; // set when a call was not needed (e.g. already approved on-chain)
}

function parseTransfers(res: rpc.Api.GetSuccessfulTransactionResponse): ChainResult["transfers"] {
  const out: ChainResult["transfers"] = [];
  try {
    const events = (res as unknown as { events?: { contractEventsXdr?: xdr.ContractEvent[][] } }).events?.contractEventsXdr ?? [];
    for (const ev of events.flat()) {
      // In SDK 17 these are plain properties; older versions use methods. Handle both.
      const get = <V>(o: unknown, k: string): V => { const v = (o as Record<string, unknown>)[k]; return (typeof v === "function" ? (v as () => V).call(o) : v) as V; };
      const body = get<{ topics: xdr.ScVal[]; data: xdr.ScVal }>(get<object>(ev, "body"), "v0");
      const topics = get<xdr.ScVal[]>(body, "topics").map((t) => scValToNative(t));
      if (topics[0] !== "transfer") continue;
      out.push({ from: String(topics[1]), to: String(topics[2]), amount: BigInt(scValToNative(get<xdr.ScVal>(body, "data"))) });
    }
  } catch { /* events unavailable: the caller falls back to "see the transaction" */ }
  return out;
}

/** Send one contract call, signed by `role`'s key, and wait for the ledger. Throws ChainError on any failure. */
export async function invoke<T = unknown>(
  role: RoleId, method: string, args: xdr.ScVal[], opts: { ignoreErrors?: string[] } = {},
): Promise<ChainResult<T>> {
  const kp = keypairOf(role);
  const s = server();
  try {
    const account = await withRetry(() => s.getAccount(kp.publicKey()));
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
      .setTimeout(60)
      .build();
    const prepared = await withRetry(() => s.prepareTransaction(tx), 3); // simulates, adds the footprint and fee; throws if the contract would refuse
    prepared.sign(kp);
    const sent = await s.sendTransaction(prepared);
    if (sent.status === "ERROR") throw new Error(`the network rejected the transaction (${sent.status})`);
    const res = await s.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
    if (res.status !== "SUCCESS") throw new Error(`the transaction did not succeed (${res.status})`);
    const ok = res as rpc.Api.GetSuccessfulTransactionResponse;
    return { hash: sent.hash, value: (ok.returnValue ? scValToNative(ok.returnValue) : null) as T, transfers: parseTransfers(ok) };
  } catch (e) {
    const x = explain(e);
    if (x.contractError && opts.ignoreErrors?.includes(x.contractError)) {
      return { hash: "", value: null as T, transfers: [], skipped: x.contractError };
    }
    throw new ChainError(`${method}: ${x.detail}`, x.contractError);
  }
}

/** A free read (simulated, never sent). */
export async function read<T = unknown>(method: string, args: xdr.ScVal[]): Promise<T> {
  const s = server();
  try {
    const kp = keypairOf("admin"); // any funded account will do as the "source" of a simulation
    const account = await withRetry(() => s.getAccount(kp.publicKey()));
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(CONTRACT_ID).call(method, ...args)).setTimeout(30).build();
    const sim = await withRetry(() => s.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    const ret = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return (ret ? scValToNative(ret) : null) as T;
  } catch (e) {
    const x = explain(e);
    throw new ChainError(`${method}: ${x.detail}`, x.contractError);
  }
}

interface ChainCredential { id: bigint; issuer: string; claim_type: string; passed: boolean; revoked: boolean; stake: bigint; shop_id: string }

/** The on-chain credential matching a website credential, found by who signed it and what kind it is (the two number them differently). */
export async function findCredential(shopId: string, issuerRole: RoleId, claimType: string): Promise<ChainCredential | null> {
  const views = await read<{ credential: ChainCredential }[]>("get_credentials", [arg.str(shopId)]);
  const issuer = publicKeyOf(issuerRole);
  const mine = (views ?? []).map((v) => v.credential).filter((c) => c.issuer === issuer && c.claim_type === claimType);
  if (!mine.length) return null;
  const live = mine.filter((c) => !c.revoked);
  return (live.length ? live : mine).reduce((a, b) => (a.id > b.id ? a : b));
}
export type { ChainCredential };

/** The website's fake address for a real testnet public key (so the fee split can be shown by name). */
export function roleOfPublicKey(pub: string): RoleId | null {
  for (const role of Object.keys(SECRET_ENV) as RoleId[]) {
    try { if (publicKeyOf(role) === pub) return role; } catch { /* no key for this role */ }
  }
  return null;
}
