import "server-only";
// LOANS: the shopkeeper asks, the lender decides. All off-chain: the shop never needs a wallet or crypto.
//
//   shopkeeper: requestLoan -> (wait) -> sees approved / declined, or withdrawLoan
//   lender:     listLoans -> contract.verify (pays 1 USDC, sees the evidence) -> getLoanDecision -> decideLoan
//
// The recommendation is plain rules, built on the shop checks (backend.getShopReview):
//   1. at least 2 independent issuers, a supplier AND a payment provider, with credentials still valid for 30+ days
//   2. those issuers are independent of each other
//   3. purchases are in line with receipts (40-90%)
//   4. receipts cover the last 6 months
//   5. no loan stacking (fewer than 3 lender checks in 30 days)
//   6. limit = half of the LOWEST verified monthly figure (halved again if stacking). Only verified numbers count.
// CONNECT: these become your backend's /loans endpoints. Optionally record "a loan was opened for shop X" on-chain
// (never the amount) so other lenders' stacking counter sees it.

import { nameOf } from "./accounts";
import { getShopReview } from "./backend";
import { SHOPS } from "./data";
import type { Result } from "./rules";
import { rs } from "./rules";
import { mutateDb, pushAudit, read, type LoanRequest } from "./store";
import { ApiError } from "./types";

const DAY = 24 * 60 * 60;
const STACKING_ALERT = 3;
const LIMIT_SHARE = 0.5;
const MIN_VALID_DAYS = 30;

export type LoanOutcome = "approve" | "review" | "not_enough_evidence";

export interface LoanRule {
  id: string;
  label: string;
  result: Result;
  reason: string;
}

export interface LoanDecision {
  shopId: string;
  requestedInr: number;
  months: number;
  outcome: LoanOutcome;
  limitInr: number;
  summary: string; // one sentence for the lender (and, in simpler words, the shopkeeper)
  rules: LoanRule[];
}

const floor500 = (n: number) => Math.floor(n / 500) * 500;

/** What the checks recommend for this shop and this amount. Free to call: it doesn't change anything. */
export async function getLoanDecision(shopId: string, amountInr: number, months: number): Promise<LoanDecision> {
  const review = await getShopReview(shopId);
  const s = read();
  const check = (id: string) => review.checks.find((c) => c.id === id);

  // Only issuers whose claims the receipts back up, with a credential that stays valid for a while yet.
  const usable = review.issuers.filter((i) => i.overall === "verified" && i.credentialIds.some((id) => {
    const c = s.credentials[id];
    return c && !c.revoked && c.expiresAt - s.now >= MIN_VALID_DAYS * DAY;
  }));
  const kinds = new Set(usable.map((i) => i.kind));
  const stacking = (s.checks[shopId] ?? []).filter((t) => s.now < t + 30 * DAY).length;
  const rules: LoanRule[] = [];

  const notCounted = review.issuers.filter((i) => i.failedWhy).map((i) => `${i.issuerName}: ${i.failedWhy}`).join(" ");
  const tail = notCounted ? ` Not counted: ${notCounted}` : "";
  const named = review.issuers.map((i) => i.issuerName).join(", ");
  const noPaymentApp = !review.issuers.some((i) => i.kind === "PaymentProvider" && i.overall === "verified");
  rules.push(usable.length >= 2 && kinds.size >= 2
    ? { id: "evidence", label: "Two independent kinds of evidence", result: "pass", reason: `${usable.map((i) => `${i.issuerName} (${i.kind === "PaymentProvider" ? "payment app" : "supplier"})`).join(" and ")} vouch, and the payment-app records back them up.${tail}` }
    : usable.length
      ? { id: "evidence", label: "Two independent kinds of evidence", result: "unknown", reason: `Only ${usable.map((i) => i.issuerName).join(", ")} can be counted. A supplier AND a payment app are needed.${tail}` }
      : review.issuers.length && noPaymentApp
        ? { id: "evidence", label: "Two independent kinds of evidence", result: "unknown", reason: `Vouched only by ${named}, with no payment-app receipts. Needs an independent payment app. Unknown, not bad.${tail}` }
        : { id: "evidence", label: "Two independent kinds of evidence", result: "unknown", reason: `No backed, current credentials yet. Unknown, not bad.${tail}` });

  for (const [id, label] of [["issuers_independent", "Issuers independent of each other"], ["ratio", "Purchases in line with receipts"], ["coverage", "Receipts cover 6 months"]] as const) {
    const c = check(id);
    rules.push({ id, label, result: c?.result ?? "unknown", reason: c?.reason ?? "Not available." });
  }

  rules.push(stacking >= STACKING_ALERT
    ? { id: "stacking", label: "No loan stacking", result: "fail", reason: `${stacking} lender checks in the last 30 days: the shop may be borrowing from several lenders, so the limit is halved.` }
    : { id: "stacking", label: "No loan stacking", result: "pass", reason: `${stacking} lender check(s) in the last 30 days.` });

  const lowest = usable.length ? Math.min(...usable.map((i) => i.avgNet)) : 0;
  let limit = floor500(lowest * LIMIT_SHARE);
  if (stacking >= STACKING_ALERT) limit = floor500(limit / 2);
  rules.push(!usable.length
    ? { id: "limit", label: "Within the limit", result: "unknown", reason: "No verified numbers to base a limit on." }
    : {
        id: "limit", label: "Within the limit", result: amountInr <= limit ? "pass" : "fail",
        reason: `Limit ${rs(limit)} = half of the lowest verified monthly figure (${rs(lowest)})${stacking >= STACKING_ALERT ? ", halved again for stacking" : ""}. Asked for ${rs(amountInr)}.`,
      });

  let outcome: LoanOutcome;
  let summary: string;
  const blocking = rules.filter((r) => ["issuers_independent", "ratio", "coverage", "stacking"].includes(r.id) && r.result === "fail");
  if (!usable.length) {
    outcome = "not_enough_evidence";
    summary = "Not enough evidence yet. The shop needs credentials from a supplier and a payment app that the receipts back up.";
  } else if (blocking.length || rules[0].result !== "pass") {
    outcome = "review";
    summary = `Needs your judgement: ${[...(rules[0].result !== "pass" ? [rules[0].label.toLowerCase()] : []), ...blocking.map((r) => r.label.toLowerCase())].join("; ")}. Suggested limit ${rs(limit)}.`;
  } else {
    outcome = "approve";
    summary = amountInr <= limit
      ? `Approve: ${rs(amountInr)} is within the limit of ${rs(limit)}.`
      : `Approve up to ${rs(limit)} (they asked for ${rs(amountInr)}).`;
  }
  return { shopId, requestedInr: amountInr, months, outcome, limitInr: limit, summary, rules };
}

// ---------- the shopkeeper ----------

/** A shop asks for a loan. One open request at a time. */
export async function requestLoan(shopId: string, amountInr: number, months: number, purpose: string): Promise<LoanRequest> {
  const shop = SHOPS[shopId];
  if (!shop) throw new ApiError("NotFound", "We don't know this shop.");
  const amount = Math.round(Number(amountInr));
  const term = Math.round(Number(months));
  if (!Number.isFinite(amount) || amount < 1000 || amount > 1_000_000) throw new ApiError("InvalidInput", "Ask for between ₹1,000 and ₹1,000,000.");
  if (!Number.isFinite(term) || term < 1 || term > 36) throw new ApiError("InvalidInput", "Choose between 1 and 36 months.");
  if (String(purpose ?? "").trim().length < 3) throw new ApiError("InvalidInput", "Say in a few words what the loan is for.");
  return mutateDb((db, now) => {
    if (db.loans.some((l) => l.shopId === shopId && l.status === "requested")) {
      throw new ApiError("InvalidInput", "You already have a request waiting. Withdraw it first to ask for a different amount.");
    }
    const loan: LoanRequest = { id: db.nextId++, shopId, amountInr: amount, months: term, purpose: String(purpose).trim().slice(0, 140), status: "requested", requestedAt: now };
    db.loans.unshift(loan);
    pushAudit(db, "info", "loan_requested", `${shop.name} asked for ${rs(amount)} over ${term} months (${loan.purpose}).`);
    return structuredClone(loan);
  });
}

export async function withdrawLoan(shopId: string, id: number): Promise<void> {
  mutateDb((db) => {
    const loan = db.loans.find((l) => l.id === id && l.shopId === shopId);
    if (!loan) throw new ApiError("NotFound", "No such loan request.");
    if (loan.status !== "requested") throw new ApiError("InvalidInput", "Only a waiting request can be withdrawn.");
    loan.status = "withdrawn";
    pushAudit(db, "info", "loan_withdrawn", `${SHOPS[shopId]?.name ?? shopId} withdrew its request for ${rs(loan.amountInr)}.`);
  });
}

/** Newest first. Pass a shop id to see one shop's requests, and/or a status. */
export async function listLoans(filter: { shopId?: string; status?: LoanRequest["status"] } = {}): Promise<(LoanRequest & { shopName: string })[]> {
  return structuredClone(read().db.loans)
    .filter((l) => (!filter.shopId || l.shopId === filter.shopId) && (!filter.status || l.status === filter.status))
    .map((l) => ({ ...l, shopName: SHOPS[l.shopId]?.name ?? l.shopId }));
}

// ---------- the lender ----------

/**
 * The lender's decision. Following the recommendation needs no explanation. Going BEYOND it (approving when the checks
 * say "review" or "not enough evidence", or approving more than the limit) needs a written note: on the record, like the admin's.
 */
export async function decideLoan(lender: string, id: number, approve: boolean, amountInr: number, note: string): Promise<LoanRequest> {
  const loan = read().db.loans.find((l) => l.id === id);
  if (!loan) throw new ApiError("NotFound", "No such loan request.");
  if (loan.status !== "requested") throw new ApiError("InvalidInput", `This request is already ${loan.status}.`);
  const amount = Math.round(Number(amountInr));
  const decision = await getLoanDecision(loan.shopId, approve ? amount : loan.amountInr, loan.months);
  if (approve) {
    if (!Number.isFinite(amount) || amount < 1000 || amount > loan.amountInr) throw new ApiError("InvalidInput", `Approve between ₹1,000 and the ${rs(loan.amountInr)} they asked for.`);
    const beyond = decision.outcome !== "approve" || amount > decision.limitInr;
    if (beyond && !String(note ?? "").trim()) throw new ApiError("InvalidInput", "This goes beyond what the checks recommend. Write a note explaining why.");
  }
  return mutateDb((db, now) => {
    const l = db.loans.find((x) => x.id === id)!;
    l.status = approve ? "approved" : "declined";
    l.lender = lender;
    l.decidedAt = now;
    l.approvedInr = approve ? amount : undefined;
    l.note = String(note ?? "").trim() || undefined;
    l.recommendation = decision.outcome;
    pushAudit(db, approve && decision.outcome !== "approve" ? "warn" : "info", approve ? "loan_approved" : "loan_declined",
      `${nameOf(lender)} ${approve ? `approved ${rs(amount)}` : "declined"} for ${SHOPS[l.shopId]?.name ?? l.shopId} (checks said: ${decision.outcome}${l.note ? `; note: ${l.note}` : ""}).`);
    return structuredClone(l);
  });
}
