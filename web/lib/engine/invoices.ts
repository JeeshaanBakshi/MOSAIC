import "server-only";
// TWO-SIDED CONFIRMATION + INVOICE EVIDENCE (off-chain, in the backend's database).
//
//   supplier : submitInvoice -> (the shop answers) -> cancelInvoice / addCreditNote
//   shop     : confirmInvoice | rejectInvoice | disputeInvoice        (only the shop the invoice names)
//   pay app  : submitPaymentRecord / reversePayment                    (the payment evidence invoices are matched against)
//   admin    : resolveInvoiceDispute
//   lender   : getVerificationReport(shopId)  (everything above, explained)
//
// What is on-chain: only the supplier's CREDENTIAL (the existing contract). Invoice claims, confirmations and payment
// records live here, off-chain, and are labelled that way everywhere. The contract is not changed.
//
// PROTOTYPE LIMIT: "who is calling" is what the browser sends (a role switcher). The server still checks that the
// shop answering is the shop named on the invoice, but without real logins anyone could pose as that shop.
// A real version needs the shopkeeper to log in (phone OTP) and the issuer to sign with a wallet.

import { accountByAddress, nameOf } from "./accounts";
import { SHOPS } from "./data";
import { getChecks, syncChecks, verifiedAccountOf, type Evaluated } from "./backend";
import { getCredentials, listIssuers } from "./contract";
import {
  DAY, FRESHNESS_LABEL, MATCH_LABEL, freshness, matchInvoice, reliability,
  type FreshnessResult, type InvoiceInput, type MatchResult, type PaymentInput, type ReliabilityMetrics, type ReliabilityResult,
} from "./evidence";
import { mutateDb, openCaseInDb, pushAudit, read, type InvoiceClaim, type InvoiceEvent, type PaymentRecord } from "./store";
import { decideCase } from "./cases";
import { getSupplierProof, type SupplierProofView } from "./statements";
import { ApiError, ContractError } from "./types";
import { claimHash } from "./util";
import { rs } from "./rules";

// ---------- writing ----------

export interface InvoiceInputForm {
  ref: string;
  amountInr: number;
  date: string; // "2026-10-28"
  category: string;
  description: string;
  evidenceRef: string;
  validDays: number; // how long the claim stays open for the shop to answer
}

const db_admin = () => read().config.admin; // an invoice case has no lender, so a deducted stake goes to the platform
const bad = (msg: string) => new ApiError("InvalidInput", msg);
const okMoney = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100_000_000;

function parseDate(text: string, now: number): number {
  const t = Date.parse(`${String(text).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) throw bad("Enter the date as YYYY-MM-DD, for example 2026-10-28.");
  const secs = Math.floor(t / 1000);
  if (secs > now + DAY) throw bad("The date is in the future.");
  if (secs < now - 400 * DAY) throw bad("The date is more than 400 days ago.");
  return secs;
}

const event = (by: string, action: InvoiceEvent["action"], at: number, note?: string): InvoiceEvent => ({ at, by, action, ...(note ? { note } : {}) });

/** A supplier says: "I sold this shop these goods on this invoice." It then waits for the shop to answer. */
export async function submitInvoice(issuer: string, shopId: string, credentialId: number, form: InvoiceInputForm): Promise<number> {
  const s = read();
  const record = s.issuers[issuer];
  if (!record) throw new ContractError("IssuerNotApproved");
  if (!record.active) throw new ContractError("IssuerSuspended");
  if (record.kind !== "Supplier") throw new ApiError("Forbidden", "Only a supplier issues invoices. A payment app shares payment records instead.");
  if (!SHOPS[shopId]) throw bad(`We have no records for a shop called "${shopId}".`);
  const cred = s.credentials[credentialId];
  if (!cred || cred.issuer !== issuer || cred.shopId !== shopId) throw bad("Pick one of your own credentials for this shop to attach the invoice to.");
  if (cred.revoked) throw bad("That credential was revoked.");
  const ref = String(form.ref ?? "").trim();
  if (ref.length < 3 || ref.length > 40) throw bad("The invoice reference must be 3 to 40 characters.");
  if (!okMoney(form.amountInr)) throw bad("Enter an invoice amount above zero.");
  const category = String(form.category ?? "").trim(), description = String(form.description ?? "").trim(), evidenceRef = String(form.evidenceRef ?? "").trim();
  if (!category || category.length > 40) throw bad("Enter the goods category (up to 40 characters).");
  if (description.length > 200) throw bad("The description is too long (200 characters at most).");
  if (evidenceRef.length > 80) throw bad("The evidence reference is too long (80 characters at most).");
  if (!Number.isInteger(form.validDays) || form.validDays < 7 || form.validDays > 365) throw bad("Pick how long the claim stays open: 7 to 365 days.");
  const invoiceDate = parseDate(form.date, s.now);
  const hash = await claimHash({ issuer, shop_id: shopId, credential_id: credentialId, invoice_ref: ref, amount_inr: Math.round(form.amountInr), invoice_date: invoiceDate, category });

  return mutateDb((db, now) => {
    const id = db.nextInvoiceId++;
    db.invoices[id] = {
      id, issuer, shopId, credentialId, ref, amountInr: Math.round(form.amountInr), currency: "INR", invoiceDate, category, description, evidenceRef,
      hash, createdAt: now, expiresAt: now + form.validDays * DAY, status: "pending", cancelled: false, creditNotes: [],
      history: [event(nameOf(issuer), "submitted", now, `${ref}, ${rs(form.amountInr)}`)],
    };
    pushAudit(db, "info", "invoice_submitted", `${nameOf(issuer)} submitted invoice ${ref} (${rs(form.amountInr)}) for ${SHOPS[shopId].name}. Waiting for the shop.`);
    return id;
  });
}

function claimOf(id: number): InvoiceClaim {
  const c = read().db.invoices[id];
  if (!c) throw new ApiError("NotFound", "No invoice claim with that id.");
  return c;
}

/** The shop answers a claim. Only the shop the invoice names may answer, and an answer is never silently replaced. */
function answer(shopId: string, id: number, to: "confirmed" | "rejected" | "disputed", reason: string) {
  const c = claimOf(id);
  if (c.shopId !== shopId) throw new ApiError("Forbidden", "This invoice is about a different business. Only that business can answer it.");
  if (c.cancelled) throw new ApiError("InvalidInput", "The supplier cancelled this invoice.");
  const text = String(reason ?? "").trim();
  if (to !== "confirmed" && text.length < 3) throw bad("Say why (at least a few words). Lenders and the admin will read it.");
  if (text.length > 280) throw bad("The reason is too long (280 characters at most).");
  const now = read().now;
  if (c.status === "pending" && now >= c.expiresAt) throw new ApiError("InvalidInput", "This claim expired before it was answered. Ask the supplier to submit it again.");
  // Allowed: pending -> any answer. A CONFIRMED claim can later be disputed (new facts), and that is recorded as a new event.
  const allowed = c.status === "pending" || (c.status === "confirmed" && to === "disputed");
  if (!allowed) throw new ApiError("AlreadyAnswered", `You already answered this one (${c.status}). Answers are kept as they are, not overwritten.`);
  mutateDb((db, at) => {
    const x = db.invoices[id];
    x.status = to;
    if (to !== "confirmed") x.reason = text;
    x.history.push(event(SHOPS[shopId].name, to, at, text || undefined));
    pushAudit(db, to === "confirmed" ? "info" : "warn", `invoice_${to}`, `${SHOPS[shopId].name} ${to} invoice ${x.ref} from ${nameOf(x.issuer)}${text ? `: ${text}` : ""}.`);
    if (to !== "confirmed") { // a rejection or dispute opens a CASE for the admin (see cases.ts)
      const caseId = openCaseInDb(db, at, { kind: "shop_rejection", credentialId: x.credentialId, issuer: x.issuer, shopId, raisedByName: SHOPS[shopId].name, raisedBy: shopId, beneficiary: db_admin(), invoiceId: id, reason: text });
      pushAudit(db, "warn", "case_opened", `Case #${caseId}: ${SHOPS[shopId].name} ${to} invoice ${x.ref} from ${nameOf(x.issuer)}. Waiting for the admin.`);
    }
  });
}

// After each answer the rules engine tells the contract which claims still pass (a rejection stops fees for that credential).
export async function confirmInvoice(shopId: string, id: number): Promise<void> { answer(shopId, id, "confirmed", ""); await syncChecks(shopId); }
export async function rejectInvoice(shopId: string, id: number, reason: string): Promise<void> { answer(shopId, id, "rejected", reason); await syncChecks(shopId); }
export async function disputeInvoice(shopId: string, id: number, reason: string): Promise<void> { answer(shopId, id, "disputed", reason); await syncChecks(shopId); }

/** The supplier withdraws an invoice. Kept in the history, but no longer counts as evidence. */
export async function cancelInvoice(issuer: string, id: number): Promise<void> {
  const c = claimOf(id);
  if (c.issuer !== issuer) throw new ApiError("Forbidden", "Only the supplier who submitted an invoice can cancel it.");
  if (c.cancelled) throw new ApiError("InvalidInput", "This invoice is already cancelled.");
  mutateDb((db, now) => {
    db.invoices[id].cancelled = true;
    db.invoices[id].history.push(event(nameOf(issuer), "cancelled", now));
    pushAudit(db, "warn", "invoice_cancelled", `${nameOf(issuer)} cancelled invoice ${c.ref}.`);
  });
  await syncChecks(c.shopId);
}

/** A credit note (a return or a discount) lowers what the shop owes, so it lowers what the payments must cover. */
export async function addCreditNote(issuer: string, id: number, amountInr: number, ref: string): Promise<void> {
  const c = claimOf(id);
  if (c.issuer !== issuer) throw new ApiError("Forbidden", "Only the supplier who submitted an invoice can add a credit note.");
  const used = c.creditNotes.reduce((t, n) => t + n.amount, 0);
  if (!okMoney(amountInr) || amountInr > c.amountInr - used) throw bad(`A credit note must be above zero and at most ${rs(c.amountInr - used)} (what is left of the invoice).`);
  mutateDb((db, now) => {
    db.invoices[id].creditNotes.push({ amount: Math.round(amountInr), ref: String(ref ?? "").trim().slice(0, 40) || "credit note", at: now });
    db.invoices[id].history.push(event(nameOf(issuer), "credit_note", now, rs(amountInr)));
    pushAudit(db, "info", "credit_note", `${nameOf(issuer)} credited ${rs(amountInr)} against invoice ${c.ref}.`);
  });
}

export interface PaymentForm {
  payeeAccount: string;
  amountInr: number;
  date: string;
  reference: string;
  status?: PaymentRecord["status"];
  currency?: string;
}

/** A payment app records a payment it saw. CONNECT: in production this is a consented feed from the payment app. */
export async function submitPaymentRecord(provider: string, shopId: string, form: PaymentForm): Promise<number> {
  const s = read();
  const record = s.issuers[provider];
  if (!record) throw new ContractError("IssuerNotApproved");
  if (!record.active) throw new ContractError("IssuerSuspended");
  if (record.kind !== "PaymentProvider") throw new ApiError("Forbidden", "Only a payment app can record payments.");
  if (!SHOPS[shopId]) throw bad(`We have no records for a shop called "${shopId}".`);
  const payeeAccount = String(form.payeeAccount ?? "").trim(), reference = String(form.reference ?? "").trim();
  if (!payeeAccount || payeeAccount.length > 40) throw bad("Enter the account that was paid.");
  if (reference.length < 3 || reference.length > 60) throw bad("Enter the payment reference (3 to 60 characters), for example UPI/INV-GW-1042.");
  if (!okMoney(form.amountInr)) throw bad("Enter a payment amount above zero.");
  const status = form.status ?? "settled";
  if (!["settled", "reversed", "pending"].includes(status)) throw bad("The payment status must be settled, reversed or pending.");
  const currency = String(form.currency ?? "INR").toUpperCase().slice(0, 3);
  const date = parseDate(form.date, s.now);
  return mutateDb((db, now) => {
    const id = db.nextPaymentId++;
    db.payments.push({ id, provider, shopId, payeeAccount, amountInr: Math.round(form.amountInr), currency, date, reference, status, recordedAt: now });
    pushAudit(db, "info", "payment_recorded", `${nameOf(provider)} recorded ${rs(form.amountInr)} (${reference}) from ${SHOPS[shopId].name}.`);
    return id;
  });
}

/** The payment app that recorded a payment marks it reversed (a refund or a failed settlement). It stops counting. */
export async function reversePayment(provider: string, id: number): Promise<void> {
  const p = read().db.payments.find((x) => x.id === id);
  if (!p) throw new ApiError("NotFound", "No payment record with that id.");
  if (p.provider !== provider) throw new ApiError("Forbidden", "Only the payment app that recorded a payment can reverse it.");
  if (p.status === "reversed") throw new ApiError("InvalidInput", "This payment is already reversed.");
  mutateDb((db) => {
    const x = db.payments.find((y) => y.id === id)!;
    x.status = "reversed";
    pushAudit(db, "warn", "payment_reversed", `${nameOf(provider)} marked payment ${x.reference} (${rs(x.amountInr)}) as reversed.`);
  });
}

/** The admin rules on a business's dispute. `upheld` = the shop was right; the claim then counts against the supplier. */
export async function resolveInvoiceDispute(admin: string, id: number, upheld: boolean, note: string): Promise<void> {
  if (admin !== read().config.admin) throw new ApiError("Forbidden", "Only the admin can rule on a dispute.");
  const c = claimOf(id);
  const open = Object.values(read().db.cases).find((k) => k.invoiceId === id && k.status === "open");
  if (open) { await decideCase(admin, open.id, upheld ? "approve" : "dismiss", note); return; } // one path: the case decides (stake, warning, removal)
  if (c.status !== "disputed") throw bad("This claim is not disputed.");
  if (c.resolution) throw new ApiError("AlreadyAnswered", "This dispute was already ruled on.");
  const text = String(note ?? "").trim();
  if (text.length < 3) throw bad("Write a short note so the ruling can be read later.");
  mutateDb((db, now) => {
    const x = db.invoices[id];
    x.resolution = { upheld, at: now, note: text.slice(0, 280) };
    x.history.push(event("Admin", upheld ? "dispute_upheld" : "dispute_dismissed", now, text.slice(0, 280)));
    pushAudit(db, "warn", "invoice_dispute_resolved", `Admin ${upheld ? "upheld" : "dismissed"} the dispute on invoice ${x.ref} from ${nameOf(x.issuer)}.`);
  });
  await syncChecks(c.shopId);
}

// ---------- reading ----------

export type ClaimState = "pending" | "confirmed" | "rejected" | "disputed" | "expired";
export type Trust = "strong" | "review" | "flagged" | "awaiting";

export interface InvoiceView {
  claim: InvoiceClaim;
  issuerName: string;
  shopName: string;
  state: ClaimState; // what to show: pending becomes expired once its window passes
  match: MatchResult;
  trust: Trust;
  trustReasons: string[];
}

const bare = (t?: string) => (t ?? "").replace(/[.!?\s]+$/, ""); // a quoted reason keeps its own full stop out of our sentence

const toInput = (c: InvoiceClaim): InvoiceInput => {
  const role = accountByAddress(c.issuer)?.id;
  return { id: c.id, ref: c.ref, supplierId: c.issuer, supplierAccount: role ? verifiedAccountOf(role) : null, shopId: c.shopId, amount: c.amountInr, currency: c.currency, date: c.invoiceDate, cancelled: c.cancelled, creditNotes: c.creditNotes.map((n) => n.amount) };
};

/** Payments only count if a payment app that is still approved recorded them. */
function usablePayments(): PaymentInput[] {
  const s = read();
  return s.db.payments
    .filter((p) => s.issuers[p.provider]?.active && s.issuers[p.provider].kind === "PaymentProvider")
    .map((p) => ({ id: p.id, ref: p.reference, shopId: p.shopId, payeeAccount: p.payeeAccount, amount: p.amountInr, currency: p.currency, date: p.date, status: p.status }));
}

function viewOf(c: InvoiceClaim, payments: PaymentInput[], all: InvoiceClaim[]): InvoiceView {
  const s = read();
  const state: ClaimState = c.status === "pending" && s.now >= c.expiresAt ? "expired" : c.status;
  const match = matchInvoice(toInput(c), payments, all.map(toInput), s.now);
  const reasons: string[] = [];
  let trust: Trust;
  const upheld = c.status === "disputed" && c.resolution?.upheld;
  const overruled = c.status === "rejected" && !!c.resolution && !c.resolution.upheld; // the admin dismissed the rejection
  const flagged =
    (c.status === "rejected" && !overruled) || (c.status === "disputed" && (!c.resolution || c.resolution.upheld)) ||
    match.status === "duplicate" || match.status === "cancelled" || match.status === "requires_review";
  if (c.status === "rejected") reasons.push(overruled ? `The business rejected this claim, but the admin dismissed the rejection${c.resolution ? `: "${bare(c.resolution.note)}"` : ""}.` : `The business rejected this claim${c.reason ? `: "${bare(c.reason)}"` : ""}.`);
  if (c.status === "disputed") reasons.push(c.resolution ? (upheld ? "The business disputed it and the admin upheld the dispute." : "The business disputed it; the admin dismissed the dispute.") : `The business disputed it${c.reason ? `: "${bare(c.reason)}"` : ""}. Waiting for the admin.`);
  if (["duplicate", "cancelled", "requires_review"].includes(match.status)) reasons.push(`${MATCH_LABEL[match.status]}: ${match.failedChecks.join(", ") || match.warnings.join(" ")}.`);
  if (flagged) trust = "flagged";
  else if (match.status === "partially_matched" || state === "expired" || overruled || (c.status === "disputed" && c.resolution && !c.resolution.upheld)) {
    trust = "review";
    if (match.status === "partially_matched") reasons.push(`Only ${match.matchingPercentage}% of the invoice is matched by payments; ${rs(match.outstandingAmount)} is outstanding.`);
    if (state === "expired") reasons.push("The shop did not answer in time.");
  } else if (c.status === "confirmed" && match.status === "fully_matched") {
    trust = "strong";
    reasons.push("The business confirmed it and the payments match the invoice.");
  } else {
    trust = "awaiting";
    if (c.status === "pending") reasons.push("Waiting for the business to confirm.");
    if (match.status === "unmatched") reasons.push("No payment evidence yet. That is unknown, not bad.");
    if (c.status === "confirmed" && match.status !== "fully_matched") reasons.push("Confirmed by the business, but the payments are not matched yet.");
    if (c.status === "pending" && match.status === "fully_matched") reasons.push("The payments already match the invoice.");
  }
  return { claim: c, issuerName: nameOf(c.issuer), shopName: SHOPS[c.shopId]?.name ?? c.shopId, state, match, trust, trustReasons: reasons };
}

/** Invoice claims with their confirmation state, matching result and trust. Newest first. */
export async function getInvoices(filter: { shopId?: string; issuer?: string; credentialId?: number } = {}): Promise<InvoiceView[]> {
  const all = Object.values(read().db.invoices);
  const payments = usablePayments();
  return all
    .filter((c) => (!filter.shopId || c.shopId === filter.shopId) && (!filter.issuer || c.issuer === filter.issuer) && (filter.credentialId === undefined || c.credentialId === filter.credentialId))
    .map((c) => viewOf(c, payments, all))
    .sort((a, b) => b.claim.id - a.claim.id);
}

export async function getPaymentRecords(filter: { shopId?: string; provider?: string } = {}): Promise<(PaymentRecord & { providerName: string })[]> {
  return read().db.payments
    .filter((p) => (!filter.shopId || p.shopId === filter.shopId) && (!filter.provider || p.provider === filter.provider))
    .map((p) => ({ ...p, providerName: nameOf(p.provider) }))
    .sort((a, b) => b.id - a.id);
}

/** An issuer's track record: the numbers, a category, and the reasons. Not a score. */
export async function getIssuerReliability(address: string): Promise<ReliabilityResult> {
  const s = read();
  const all = Object.values(s.db.invoices);
  const payments = usablePayments();
  const mine = all.filter((c) => c.issuer === address);
  const views = mine.map((c) => viewOf(c, payments, all));
  const creds = Object.values(s.credentials).filter((c) => c.issuer === address);
  const record = s.issuers[address];
  const m: ReliabilityMetrics = {
    credentialsIssued: creds.length,
    revoked: creds.filter((c) => c.revoked).length,
    confirmed: mine.filter((c) => c.status === "confirmed").length,
    rejected: mine.filter((c) => c.status === "rejected").length,
    disputed: mine.filter((c) => c.status === "disputed").length,
    pending: mine.filter((c) => c.status === "pending").length,
    duplicates: views.filter((v) => v.match.status === "duplicate").length,
    upheldOnChain: record?.upheldClaims ?? 0,
    upheldInvoice: mine.filter((c) => c.resolution?.upheld).length,
    warnings: s.db.warnings[address] ?? 0,
    suspended: !!record && !record.active,
    approved: !!record,
  };
  return reliability(m);
}

export interface IssuerReliabilityRow extends ReliabilityResult { address: string; name: string; kind: string }

export async function listIssuerReliability(): Promise<IssuerReliabilityRow[]> {
  const issuers = await listIssuers();
  return Promise.all(issuers.map(async (i) => ({ ...(await getIssuerReliability(i.address)), address: i.address, name: i.name, kind: i.kind })));
}

/** For the admin: claims that need a person to look (flagged, disputed, or waiting on a ruling). */
export async function getEvidenceAttention(): Promise<InvoiceView[]> {
  return (await getInvoices()).filter((v) => v.trust === "flagged" || (v.claim.status === "disputed" && !v.claim.resolution));
}

// ---------- the lender's verification report ----------

export interface ReportCredential {
  credentialId: number;
  issuer: string;
  issuerName: string;
  summary: string;
  onchainStatus: string;
  issuerVerified: "yes" | "no" | "unknown"; // the six checks (registry, payment match, independence, net flow...)
  issuerVerifiedWhy: string;
  confirmation: "confirmed" | "pending" | "rejected" | "disputed" | "none"; // the business's answers, worst first
  invoiceMatch: "matched" | "partial" | "review" | "none"; // invoice amounts against payments
  disputed: boolean; // any evidence disputed or rejected
  freshness: FreshnessResult;
  reliability: ReliabilityResult;
  trust: Trust;
  trustReasons: string[];
  invoices: InvoiceView[];
  proof: SupplierProofView | null; // is this supplier really the shop's supplier? (null for a payment app)
}

export interface VerificationReport {
  shopId: string;
  shopName: string;
  credentials: ReportCredential[];
  /** What is on Stellar and what is not, so no claim is overstated. */
  provenance: { onChain: string[]; offChain: string[] };
  generatedAt: number;
}

export async function getVerificationReport(shopId: string): Promise<VerificationReport> {
  const s = read();
  const [views, checks, invoices] = await Promise.all([getCredentials(shopId), getChecks(shopId), getInvoices({ shopId })]);
  const payments = s.db.payments;
  const out: ReportCredential[] = [];
  for (const v of views) {
    const c = v.credential;
    const ev: Evaluated | undefined = checks.find((x) => x.credentialId === c.id);
    const inv = invoices.filter((i) => i.claim.credentialId === c.id); // cancelled ones stay listed, but don't count as live evidence
    const live = inv.filter((i) => !i.claim.cancelled);
    const rel = await getIssuerReliability(c.issuer);
    const proof = s.issuers[c.issuer]?.kind === "Supplier" ? await getSupplierProof(c.issuer, shopId) : null;
    const refs = inv.map((i) => i.claim.ref.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const linked: PaymentRecord[] = payments.filter((p) => refs.some((r) => r && p.reference.toLowerCase().replace(/[^a-z0-9]/g, "").includes(r)));
    const fresh = freshness({
      issuedAt: c.issuedAt, expiresAt: c.expiresAt, now: s.now,
      evidenceAt: [...inv.flatMap((i) => i.claim.history.map((h) => h.at)), ...linked.map((p) => p.recordedAt)],
      transactionAt: [...inv.map((i) => i.claim.invoiceDate), ...linked.filter((p) => p.status === "settled").map((p) => p.date)],
    });

    const confirmation: ReportCredential["confirmation"] = !live.length ? "none"
      : live.some((i) => i.claim.status === "rejected") ? "rejected"
      : live.some((i) => i.claim.status === "disputed") ? "disputed"
      : live.some((i) => i.claim.status === "pending") ? "pending" : "confirmed";
    const invoiceMatch: ReportCredential["invoiceMatch"] = !live.length ? "none"
      : live.some((i) => ["requires_review", "duplicate"].includes(i.match.status)) ? "review"
      : live.some((i) => i.match.status === "partially_matched") ? "partial"
      : live.every((i) => i.match.status === "fully_matched") ? "matched" : "none";

    const reasons: string[] = [];
    let trust: Trust;
    const issuerFailed = v.status === "Valid" ? ev?.overall === "failed" : true;
    const anyFlag = live.some((i) => i.trust === "flagged");
    const anyReview = live.some((i) => i.trust === "review");
    if (issuerFailed) reasons.push(ev?.overall === "failed" ? "The issuer's own checks did not pass." : `The credential is ${v.status.toLowerCase()} on-chain.`);
    for (const i of live) if (i.trust === "flagged" || i.trust === "review") reasons.push(`${i.claim.ref}: ${i.trustReasons.join(" ")}`);
    if (proof?.status === "flagged") reasons.push(`Supplier proof: ${proof.lines.filter((l) => l.result === "fail").map((l) => l.found).join(" ")}`);
    if (fresh.status === "stale" || fresh.status === "expired") reasons.push(`The evidence is ${FRESHNESS_LABEL[fresh.status].toLowerCase()} (${fresh.daysSinceVerified} days since the last check).`);
    if (rel.category === "under_review" || rel.category === "restricted") reasons.push(`Issuer reliability: ${rel.reasons.join(" ")}`);
    if (issuerFailed || anyFlag || rel.category === "restricted" || proof?.status === "flagged") trust = "flagged";
    else if (anyReview || fresh.status === "stale" || fresh.status === "expired" || rel.category === "under_review") trust = "review";
    else if (live.length && live.every((i) => i.trust === "strong") && ev?.overall === "verified") { trust = "strong"; reasons.push("Every invoice is confirmed by the business and matched by payments."); }
    else {
      trust = "awaiting";
      reasons.push(live.length ? "Some evidence is still pending. Unknown is not bad." : "No invoice evidence yet. The credential rests on the issuer's signature and the six checks alone.");
    }
    out.push({
      credentialId: c.id, issuer: c.issuer, issuerName: v.issuerName, summary: c.summary, onchainStatus: v.status,
      issuerVerified: ev ? (ev.overall === "verified" ? "yes" : ev.overall === "failed" ? "no" : "unknown") : "unknown",
      issuerVerifiedWhy: ev ? (ev.overall === "verified" ? "Registry, payment match, independence and net flow all passed." : ev.overall === "failed" ? "One of the six checks failed." : "Some checks have no evidence yet.") : "No checks yet.",
      confirmation, invoiceMatch, disputed: live.some((i) => ["rejected", "disputed"].includes(i.claim.status)),
      freshness: fresh, reliability: rel, trust, trustReasons: reasons, invoices: inv, proof,
    });
  }
  return {
    shopId, shopName: SHOPS[shopId]?.name ?? shopId, credentials: out, generatedAt: s.now,
    provenance: {
      onChain: ["The supplier's credential, its stake, and any dispute or revocation (the Soroban contract on Stellar testnet)."],
      offChain: ["Invoice claims, the shop's confirmations, payment records, matching results, freshness and reliability. These are calculated by the MOSAIC backend. Only the credential's fingerprint is on-chain."],
    },
  };
}

