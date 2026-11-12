import "server-only";
// The fake MOSAIC contract. Same functions, same rules, same error names as the Rust contract
// you'll write. Pages call ONLY these functions.
//
// Every function is async and takes ~250ms, because a real chain call is a network round trip.
// Writes take the caller's address first (the real contract calls `caller.require_auth()`:
// the transaction must be signed by that address) and return { result, hash }.
//
// CONNECT (the whole file): replace each function body with a call to the deployed contract:
//   build the transaction -> simulate (free dry run) -> wallet signs -> send -> wait for the ledger.
//   Keep the function names, arguments and return shapes, and no page needs to change.

import { ACCOUNTS, CONTRACT_ADDRESS, nameOf } from "./accounts";
import { START_TIME, read, setNow, transact, type State } from "./store";
import { ContractError } from "./types";
import type {
  Config, Credential, CredentialView, Dispute, Issuer, IssuerKind, IssuerRequest, Payout, Status, Tx, VerifyResult,
} from "./types";
import { sleep } from "./util";
import { usdc } from "../format";

const DAY = 24 * 60 * 60;
const DEFAULT_TTL = 90 * DAY; // credentials last 90 days unless told otherwise
const STACKING_WINDOW = 30 * DAY; // fraud check 6 counts lender checks in the last 30 days
const SUSPEND_AFTER = 2; // 2 upheld disputes suspend an issuer
const BPS = 10_000; // basis points: 10,000 = 100%
const LATENCY_MS = 250;

const copy = <T>(x: T): T => structuredClone(x);

// ---------- internal helpers (the contract's private functions) ----------

function statusOf(s: State, cred: Credential): Status {
  const issuer = s.issuers[cred.issuer];
  if (cred.revoked) return "Revoked";
  if (s.now >= cred.expiresAt) return "Expired";
  if (!issuer?.active) return "Suspended";
  return "Valid";
}

function viewOf(s: State, cred: Credential): CredentialView {
  return { credential: cred, status: statusOf(s, cred), issuerName: s.issuers[cred.issuer]?.name ?? "unknown" };
}

/** The USDC token contract's `transfer`. Fails if `from` doesn't have enough. */
function transfer(s: State, from: string, to: string, amount: number, effects: string[]) {
  if (amount <= 0) return;
  if ((s.balances[from] ?? 0) < amount) throw new ContractError("InsufficientBalance");
  s.balances[from] -= amount;
  s.balances[to] = (s.balances[to] ?? 0) + amount;
  effects.push(`${usdc(amount)}: ${nameOf(from)} → ${nameOf(to)}`);
}

function recentChecks(s: State, shopId: string): number[] {
  return (s.checks[shopId] ?? []).filter((t) => s.now < t + STACKING_WINDOW);
}

function mustBeAdmin(s: State, caller: string) {
  // Real contract: `admin.require_auth()`. A wrong signer is an auth failure, not a custom error.
  if (caller !== s.config.admin) throw new ContractError("NotAdmin");
}

// ---------- setup ----------

/** The mock calls this for you at start-up, so calling it again fails like the real one. */
export async function init(): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `init(admin, usdc, verify_fee, issuer_share_bps, stake_amount)`. Run once at deploy time.
  throw new ContractError("AlreadyInitialized");
}

// ---------- joining the registry ----------

/**
 * Anyone can ASK to become an issuer. They sign it themselves, and only a hash of their evidence goes on-chain
 * (the evidence itself, e.g. GST number and phone, stays with the backend).
 */
export async function requestIssuer(issuer: string, name: string, kind: IssuerKind, evidenceHash: string): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `request_issuer(issuer, name, kind, evidence_hash)`, signed by the applicant. (New: add it to the Rust contract.)
  return transact("request_issuer", issuer, (s) => {
    if (s.issuers[issuer]) throw new ContractError("AlreadyApproved");
    if (s.issuerRequests[issuer]?.status === "Pending") throw new ContractError("RequestAlreadyPending");
    s.issuerRequests[issuer] = { address: issuer, name, kind, evidenceHash, status: "Pending", requestedAt: s.now };
    return { result: null, summary: `${name} asked to join the registry (evidence hash ${evidenceHash.slice(0, 8)}…)` };
  });
}

/** The admin turns a request down. The applicant may apply again later. */
export async function rejectIssuerRequest(admin: string, issuer: string): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `reject_issuer(issuer)`, signed by the admin. (New: add it to the Rust contract.)
  return transact("reject_issuer", admin, (s) => {
    mustBeAdmin(s, admin);
    const req = s.issuerRequests[issuer];
    if (!req || req.status !== "Pending") throw new ContractError("RequestNotFound");
    req.status = "Rejected";
    return { result: null, summary: `${req.name}'s request to join was rejected` };
  });
}

export async function getIssuerRequest(address: string): Promise<IssuerRequest | null> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `get_issuer_request(issuer)`.
  return copy(read().issuerRequests[address] ?? null);
}

// ---------- admin ----------

/** Fraud check 1: only the admin can approve an issuer. */
export async function addIssuer(admin: string, issuer: string, name: string, kind: IssuerKind): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `add_issuer(issuer, name, kind)`, signed by the admin.
  return transact("add_issuer", admin, (s) => {
    mustBeAdmin(s, admin);
    s.issuers[issuer] = { address: issuer, name, kind, active: true, upheldClaims: 0 };
    delete s.issuerRequests[issuer]; // approving settles any waiting request
    return { result: null, summary: `${name} approved as ${kind === "Supplier" ? "a supplier" : "a payment provider"}` };
  });
}

/**
 * MOCK-ONLY (NOT IN THE CONTRACT YET): let the admin suspend an issuer by hand.
 * The contract only suspends automatically after 2 upheld disputes.
 * CONNECT: either add a `suspend_issuer(issuer)` function to the Rust contract, or delete this and its button.
 */
export async function suspendIssuer(admin: string, issuer: string): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  return transact("suspend_issuer", admin, (s) => {
    mustBeAdmin(s, admin);
    const record = s.issuers[issuer];
    if (!record) throw new ContractError("IssuerNotApproved");
    record.active = false;
    return { result: null, summary: `${record.name} suspended by the admin` };
  });
}

/** The admin decides a dispute. Upheld = the claim was false: the stake goes to the lender. */
export async function resolveDispute(admin: string, id: number, upheld: boolean): Promise<Tx<{ slashed: number }>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `resolve_dispute(admin, id, upheld)`, signed by the admin.
  return transact("resolve_dispute", admin, (s, fx) => {
    mustBeAdmin(s, admin);
    const dispute = s.disputes[id];
    if (!dispute) throw new ContractError("DisputeNotFound");
    if (dispute.resolved) throw new ContractError("DisputeAlreadyResolved");

    dispute.resolved = true;
    dispute.upheld = upheld;
    delete s.openDispute[dispute.credentialId];

    let slashed = 0;
    let summary = `Dispute #${id} rejected: nothing moves`;
    if (upheld) {
      const cred = s.credentials[dispute.credentialId];
      slashed = cred.stake;
      cred.stake = 0;
      cred.revoked = true;
      const issuer = s.issuers[cred.issuer];
      issuer.upheldClaims += 1;
      if (issuer.upheldClaims >= SUSPEND_AFTER) issuer.active = false; // 2 strikes: suspended
      transfer(s, CONTRACT_ADDRESS, dispute.lender, slashed, fx);
      summary = `Dispute #${id} upheld: ${issuer.name} stake slashed to the lender` +
        (issuer.active ? ` (strike ${issuer.upheldClaims} of ${SUSPEND_AFTER})` : ` and ${issuer.name} is now suspended`);
    }
    return { result: { slashed }, summary };
  });
}

// ---------- issuers ----------

/** An approved issuer signs a claim about a shop and locks a stake behind it (fraud checks 1 and 5). */
export async function issueCredential(
  issuer: string, shopId: string, claimType: string, summary: string, claimHash: string, ttlSecs = 0,
): Promise<Tx<number>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `issue_credential(issuer, shop_id, claim_type, summary, claim_hash, ttl_secs)`, signed by the issuer.
  return transact("issue_credential", issuer, (s, fx) => {
    const record = s.issuers[issuer];
    if (!record) throw new ContractError("IssuerNotApproved"); // fraud check 1
    if (!record.active) throw new ContractError("IssuerSuspended");

    // Size limits, same as the Rust contract.
    if (shopId.length > 64 || summary.length > 280) throw new ContractError("InputTooLong");
    if ((s.shopCreds[shopId] ?? []).length >= 100) throw new ContractError("TooManyCredentials");

    // One active credential per (issuer, shop, claim type). Revoked or expired ones don't count.
    const duplicate = (s.shopCreds[shopId] ?? []).some((id) => {
      const c = s.credentials[id];
      return c.issuer === issuer && c.claimType === claimType && !c.revoked && s.now < c.expiresAt;
    });
    if (duplicate) throw new ContractError("DuplicateClaim");

    transfer(s, issuer, CONTRACT_ADDRESS, s.config.stakeAmount, fx); // fraud check 5: lock the stake

    const id = s.nextCredId++;
    const ttl = ttlSecs === 0 ? DEFAULT_TTL : ttlSecs;
    s.credentials[id] = {
      id, issuer, shopId, claimType, summary, claimHash,
      issuedAt: s.now, expiresAt: s.now + ttl, revoked: false, stake: s.config.stakeAmount,
      passed: false, // earns nothing until the backend's checks have passed
    };
    (s.shopCreds[shopId] ??= []).push(id);
    return { result: id, summary: `${record.name} issued credential #${id} for ${shopId}` };
  });
}

/** The backend rules engine (signing as the admin) records whether a claim passed fraud checks 2-4. */
export async function markChecked(caller: string, id: number, passed: boolean): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `mark_checked(id, passed)`, signed by the admin.
  return transact("mark_checked", caller, (s) => {
    mustBeAdmin(s, caller);
    const cred = s.credentials[id];
    if (!cred) throw new ContractError("CredentialNotFound");
    cred.passed = passed;
    return { result: null, summary: `Credential #${id} ${passed ? "passed" : "did not pass"} the backend checks` };
  });
}

/** The issuer withdraws a claim. The stake stays locked until it would have expired. */
export async function revoke(issuer: string, id: number): Promise<Tx<null>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `revoke(issuer, id)`, signed by the issuer.
  return transact("revoke", issuer, (s) => {
    const cred = s.credentials[id];
    if (!cred) throw new ContractError("CredentialNotFound");
    if (cred.issuer !== issuer) throw new ContractError("NotYourCredential");
    cred.revoked = true;
    return { result: null, summary: `Credential #${id} revoked (stake stays locked until it expires)` };
  });
}

/** After a credential expires, and if no dispute is open, the issuer gets the stake back. */
export async function releaseStake(issuer: string, id: number): Promise<Tx<number>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `release_stake(issuer, id)`, signed by the issuer.
  return transact("release_stake", issuer, (s, fx) => {
    const cred = s.credentials[id];
    if (!cred) throw new ContractError("CredentialNotFound");
    if (cred.issuer !== issuer) throw new ContractError("NotYourCredential");
    if (s.now < cred.expiresAt) throw new ContractError("NotExpiredYet");
    if (s.openDispute[id]) throw new ContractError("DisputeAlreadyOpen");
    if (cred.stake <= 0) throw new ContractError("NoStakeLeft");
    const amount = cred.stake;
    cred.stake = 0; // update the record BEFORE moving money
    transfer(s, CONTRACT_ADDRESS, issuer, amount, fx);
    return { result: amount, summary: `Credential #${id}: stake returned to ${nameOf(issuer)}` };
  });
}

// ---------- lenders ----------

/** A lender pays the fee and gets the shop's credentials plus the stacking counter. */
export async function verify(lender: string, shopId: string): Promise<Tx<VerifyResult>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `verify(lender, shop_id)`, signed by the lender. It transfers the fee inside the same transaction.
  return transact("verify", lender, (s, fx) => {
    const views = (s.shopCreds[shopId] ?? []).map((id) => viewOf(s, s.credentials[id]));

    // Who gets paid? Each distinct issuer with at least one VALID credential that PASSED the backend checks.
    const payees: string[] = [];
    for (const v of views) {
      if (v.status === "Valid" && v.credential.passed && !payees.includes(v.credential.issuer)) payees.push(v.credential.issuer);
    }

    // Example: fee 1 USDC, 70% share, 2 issuers -> 0.35 each, 0.30 to the platform (admin).
    const pool = Math.floor((s.config.verifyFee * s.config.issuerShareBps) / BPS);
    const each = payees.length ? Math.floor(pool / payees.length) : 0;
    const payouts: Payout[] = [];
    for (const to of payees) {
      transfer(s, lender, to, each, fx);
      payouts.push({ to, amount: each });
    }
    // No issuer earned anything? Then the lender doesn't pay the issuer share at all. Rounding dust goes to the platform.
    const platform = payees.length ? s.config.verifyFee - each * payees.length : s.config.verifyFee - pool;
    transfer(s, lender, s.config.admin, platform, fx);
    payouts.push({ to: s.config.admin, amount: platform });

    // Fraud check 6: remember this check, then count the last 30 days.
    const recent = recentChecks(s, shopId);
    recent.push(s.now);
    s.checks[shopId] = recent;

    return {
      result: { credentials: views, checksLast30Days: recent.length, payouts },
      summary: `${nameOf(lender)} verified ${shopId}: ${payees.length} issuer(s) paid, ${recent.length} check(s) in the last 30 days`,
    };
  });
}

/** A lender says "this credential is false". One open dispute per credential. */
export async function openDispute(lender: string, credentialId: number): Promise<Tx<number>> {
  await sleep(LATENCY_MS);
  // CONNECT: contract fn `open_dispute(lender, credential_id)`, signed by the lender.
  return transact("open_dispute", lender, (s) => {
    const cred = s.credentials[credentialId];
    if (!cred) throw new ContractError("CredentialNotFound");
    if (cred.stake <= 0) throw new ContractError("NoStakeLeft");
    if (s.openDispute[credentialId]) throw new ContractError("DisputeAlreadyOpen");
    const id = s.nextDisputeId++;
    s.disputes[id] = { id, credentialId, lender, resolved: false, upheld: false };
    s.openDispute[credentialId] = id;
    return { result: id, summary: `${nameOf(lender)} opened dispute #${id} on credential #${credentialId}` };
  });
}

// ---------- reads (free: the real chain answers these with a simulation, no signature) ----------

export async function getCredentials(shopId: string): Promise<CredentialView[]> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `get_credentials(shop_id)` (simulate only).
  const s = read();
  return copy((s.shopCreds[shopId] ?? []).map((id) => viewOf(s, s.credentials[id])));
}

export async function getIssuer(address: string): Promise<Issuer | null> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `get_issuer(issuer)`.
  return copy(read().issuers[address] ?? null);
}

export async function getDispute(id: number): Promise<Dispute | null> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `get_dispute(id)`.
  return copy(read().disputes[id] ?? null);
}

export async function getConfig(): Promise<Config> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `get_config()`.
  return copy(read().config);
}

/** Fraud check 6 without paying: how many lender checks in the last 30 days. */
export async function checksLast30Days(shopId: string): Promise<number> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: contract fn `checks_last_30_days(shop_id)`.
  const s = read();
  return recentChecks(s, shopId).length;
}

/** USDC balance of any address, including the MOSAIC contract (where stakes sit). */
export async function getBalance(address: string): Promise<number> {
  await sleep(LATENCY_MS / 2);
  // CONNECT: call `balance(address)` on the USDC token contract (simulate only).
  return read().balances[address] ?? 0;
}

/** Several balances in one call (the balances bar shows six at once). */
export async function getBalances(addresses: string[]): Promise<number[]> {
  const s = read();
  return addresses.map((a) => s.balances[a] ?? 0);
}

// ---------- "indexer" reads: the real contract has NO list-everything function ----------
// CONNECT: for each of these, read the contract's events (or run a tiny indexer / keep a list in your backend).

export async function listIssuers(): Promise<Issuer[]> {
  await sleep(LATENCY_MS / 2);
  return copy(Object.values(read().issuers));
}

export async function listIssuerRequests(): Promise<IssuerRequest[]> {
  await sleep(LATENCY_MS / 2);
  return copy(Object.values(read().issuerRequests).sort((a, b) => a.requestedAt - b.requestedAt));
}

export async function listDisputes(): Promise<Dispute[]> {
  await sleep(LATENCY_MS / 2);
  return copy(Object.values(read().disputes).sort((a, b) => b.id - a.id));
}

export async function listShopsWithCredentials(): Promise<string[]> {
  await sleep(LATENCY_MS / 2);
  return Object.keys(read().shopCreds);
}

export async function listActivity() {
  // CONNECT: show the contract's events (e.g. from Horizon/RPC `getEvents`) instead.
  return copy(read().activity);
}

// ---------- the fake clock (MOCK-ONLY) ----------

/** CONNECT: delete this and the "+30 / +90 days" buttons. The chain's own ledger time is the clock. */
export async function getNow(): Promise<number> {
  return read().now;
}

export async function advanceTime(days: number): Promise<number> {
  const now = read().now + days * DAY;
  setNow(now);
  return now;
}

export { START_TIME, ACCOUNTS };
