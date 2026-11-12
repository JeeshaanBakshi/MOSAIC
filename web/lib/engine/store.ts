import "server-only";
// The fake blockchain's memory + the backend's database, as ONE State object.
//
// How a request works:
//   1. withState() loads the State from the cloud store (Upstash Redis) and takes a lock,
//   2. the engine function runs against that State (read() / transact() / mutateDb()),
//   3. if anything changed, the State is saved back, and the lock is released.
// So every visitor sees the same data, and two people can't overwrite each other.
//
// CONNECT: with the real chain, the chain is the memory and this file shrinks to the backend's own database.

import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "../server/log";
import { getStorage } from "../server/storage";
import { ACCOUNTS, CONTRACT_ADDRESS, ROLE_IDS, USDC_ADDRESS, nameOf } from "./accounts";
import { USDC_UNIT } from "../format";
import type { Config, Credential, Dispute, Issuer, IssuerKind, IssuerRequest } from "./types";
import { fakeHash } from "./util";

export interface ActivityItem {
  n: number; // transaction number
  hash: string;
  fn: string; // contract function name, e.g. "issue_credential"
  caller: string; // who signed it
  summary: string;
  effects: string[]; // what moved, e.g. "30 USDC: Issuer 1 → MOSAIC contract"
  time: number;
}

// ---- the BACKEND's database (applications, emailed codes, manual reviews, logs). Not on-chain. ----

export type EmailDelivery = "sent" | "failed" | "not_configured";

export interface Application {
  address: string; // the Stellar account applying
  businessName: string;
  kind: IssuerKind;
  registrationNumber: string; // GST number (supplier) or RBI licence number (payment provider)
  ownerName: string;
  phone: string;
  email: string;
  bankAccountHolder: string;
  evidenceHash: string; // sha256 of all of the above: this is what goes on-chain
  emailVerified: boolean;
  otp: { codeHash: string; expiresAt: number; attempts: number } | null; // we keep a HASH of the code, never the code
  emailDelivery: EmailDelivery; // did the code email actually go out?
  emailError?: string;
  requested: boolean; // true once the signed request_issuer transaction was sent
  createdAt: number;
}

export interface ManualReview {
  checked: Record<string, boolean>; // check id -> "I verified this by hand"
  note: string;
  reviewedAt: number;
}

/** Only used when no email service is configured (local development), so you can still read the code. */
export interface Email {
  id: number;
  to: string;
  subject: string;
  body: string;
  time: number;
}

export interface AuditEntry {
  id: number;
  at: string; // real wall-clock time (ISO)
  level: "info" | "warn" | "error";
  event: string;
  detail: string;
}

/** A shop asking for a loan. Off-chain: the shopkeeper never needs a wallet. */
export interface LoanRequest {
  id: number;
  shopId: string;
  amountInr: number;
  months: number;
  purpose: string;
  status: "requested" | "approved" | "declined" | "withdrawn";
  requestedAt: number; // app clock
  lender?: string; // who decided
  decidedAt?: number;
  approvedInr?: number;
  note?: string; // the lender's reason (required when going beyond the recommendation)
  recommendation?: "approve" | "review" | "not_enough_evidence"; // what the checks said at decision time
}

/** What an issuer says moved between it and a shop over the 6-month window. Stands in for a bank / UPI data feed. */
export interface Evidence {
  months: number[]; // 6 monthly totals in rupees (purchases for a supplier, settlements for a payment app)
  refundPerMonth: number; // money sent back to the shop each month
  submittedAt: number;
}

export interface Db {
  evidence: Record<string, Evidence>; // "issuerAddress|shopId" -> evidence
  loans: LoanRequest[]; // newest first
  applications: Record<string, Application>; // by address
  manualReviews: Record<string, ManualReview>;
  outbox: Email[];
  auditLog: AuditEntry[]; // newest first
  sends: Record<string, number[]>; // email -> real times (ms) we sent it a code, for the rate limit
  nextId: number;
}

export interface State {
  schema: number;
  config: Config;
  issuers: Record<string, Issuer>; // by address
  issuerRequests: Record<string, IssuerRequest>; // by address: people asking to join
  credentials: Record<number, Credential>;
  shopCreds: Record<string, number[]>; // shop id -> credential ids
  nextCredId: number;
  disputes: Record<number, Dispute>;
  openDispute: Record<number, number>; // credential id -> open dispute id
  nextDisputeId: number;
  checks: Record<string, number[]>; // shop id -> times of lender checks (fraud check 6)
  balances: Record<string, number>; // USDC balance of every address, contract included
  now: number; // the fake clock, in unix seconds
  txCount: number;
  activity: ActivityItem[];
  db: Db; // NOT part of the contract: the backend's own database
  version: number; // bumps on every change so every browser knows to re-read
}

const SCHEMA = 6; // bump when State changes shape, so old saved data is thrown away

/** The fake clock starts on 11 Nov 2026. Fixed, so the demo looks the same every time. */
export const START_TIME = Date.UTC(2026, 10, 11, 9, 0, 0) / 1000;

export const DEFAULT_CONFIG: Config = {
  admin: ACCOUNTS.admin.address,
  usdc: USDC_ADDRESS,
  verifyFee: 1 * USDC_UNIT, // 1 USDC
  issuerShareBps: 7000, // 70%
  stakeAmount: 30 * USDC_UNIT, // 30 USDC
};

/** A brand new world: contract set up (init already done), everyone holding some test USDC, nothing else. */
export function freshState(): State {
  const balances: Record<string, number> = { [CONTRACT_ADDRESS]: 0 };
  for (const r of ROLE_IDS) balances[ACCOUNTS[r].address] = r === "admin" ? 0 : 1000 * USDC_UNIT;
  return {
    schema: SCHEMA,
    config: DEFAULT_CONFIG,
    issuers: {},
    issuerRequests: {},
    credentials: {},
    shopCreds: {},
    nextCredId: 1,
    disputes: {},
    openDispute: {},
    nextDisputeId: 1,
    checks: {},
    balances,
    now: START_TIME,
    txCount: 1,
    activity: [
      {
        n: 1,
        hash: fakeHash("1:init"),
        fn: "init",
        caller: nameOf(ACCOUNTS.admin.address),
        summary: "Contract set up: fee 1 USDC, issuers get 70%, stake 30 USDC",
        effects: [],
        time: START_TIME,
      },
    ],
    db: { evidence: {}, loans: [], applications: {}, manualReviews: {}, outbox: [], auditLog: [], sends: {}, nextId: 1 },
    version: 0,
  };
}

// ---------- the request context ----------

interface Ctx {
  state: State;
  dirty: boolean;
}
const als = new AsyncLocalStorage<Ctx>();

function ctx(): Ctx {
  const c = als.getStore();
  if (!c) throw new Error("No state is loaded. Engine functions must run inside withState().");
  return c;
}

export function read(): State {
  return ctx().state;
}

function commit(next: State) {
  const c = ctx();
  c.state = next;
  c.dirty = true;
}

/**
 * Load the State, run `body`, save the State if it changed.
 *  - `readOnly` calls skip the lock and never save (reads are most of the traffic).
 *  - The State is saved even when `body` throws, because the backend keeps what it changed (e.g. a wrong-code attempt).
 *    A failed CONTRACT call changes nothing, because transact() only commits on success.
 */
export async function withState<T>(body: () => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<{ result: T; version: number }> {
  const storage = getStorage();
  const run = async () => {
    const loaded = (await storage.get()) as State | null;
    const state = loaded && loaded.schema === SCHEMA ? loaded : freshState();
    const c: Ctx = { state, dirty: !loaded || loaded.schema !== SCHEMA };
    try {
      const result = await als.run(c, body);
      return { result, version: c.state.version };
    } finally {
      if (c.dirty && !opts.readOnly) await storage.save(c.state, c.state.version);
    }
  };
  return opts.readOnly ? run() : storage.withLock(run);
}

/** Wipe everything back to empty (a brand new world), for every visitor. */
export async function resetEverything(): Promise<number> {
  const storage = getStorage();
  return storage.withLock(async () => {
    const prev = ((await storage.get()) as State | null)?.version ?? (await storage.version());
    const next = freshState();
    next.version = prev + 1; // browsers see the number change and re-read
    pushAudit(next.db, "warn", "reset", "All data was wiped and the app was set back to a fresh start.");
    await storage.save(next, next.version);
    return next.version;
  });
}

// ---------- changing things ----------

/**
 * Run one contract call as ONE transaction.
 *  - We work on a COPY of the state. If `body` throws (a ContractError), the copy is thrown away
 *    and nothing changed: failed transactions change nothing, same as on Stellar.
 *  - If it succeeds, we record it in the activity log and commit the copy.
 */
export function transact<T>(
  fn: string,
  caller: string,
  body: (draft: State, effects: string[]) => { result: T; summary: string },
): { result: T; hash: string } {
  const draft = structuredClone(read());
  const effects: string[] = [];
  const { result, summary } = body(draft, effects);

  draft.txCount += 1;
  const hash = fakeHash(`${draft.txCount}:${fn}:${caller}`);
  draft.activity.unshift({ n: draft.txCount, hash, fn, caller: nameOf(caller), summary, effects, time: draft.now });
  draft.activity = draft.activity.slice(0, 300);
  draft.version += 1;
  commit(draft);
  log("info", "tx", { n: draft.txCount, fn, caller: nameOf(caller), summary });
  return { result, hash };
}

/**
 * Change the BACKEND's database. Not a blockchain transaction: no hash, no activity-log entry.
 * Put audit entries in with pushAudit(db, ...) so they are saved together with the change.
 */
export function mutateDb<T>(body: (db: Db, now: number) => T): T {
  const draft = structuredClone(read());
  const result = body(draft.db, draft.now);
  draft.version += 1;
  commit(draft);
  return result;
}

/** Add a line to the system log (shown in the app, and printed to the server log). Call it inside mutateDb. */
export function pushAudit(db: Db, level: AuditEntry["level"], event: string, detail: string) {
  db.auditLog.unshift({ id: db.nextId++, at: new Date().toISOString(), level, event, detail });
  db.auditLog = db.auditLog.slice(0, 500);
  log(level, event, { detail });
}

/** Write one system-log line on its own (when there is no other change to save it with). */
export function logEvent(level: AuditEntry["level"], event: string, detail: string) {
  mutateDb((db) => pushAudit(db, level, event, detail));
}

/** MOCK-ONLY: the fake clock is not a transaction, so it has its own small mutation. */
export function setNow(now: number) {
  const draft = structuredClone(read());
  draft.now = now;
  draft.version += 1;
  commit(draft);
}
