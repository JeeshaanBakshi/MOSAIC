// The EVIDENCE rules: plain functions, data in, verdict out. No network, no database, no ML.
// They sit on top of the six fraud checks and answer three new questions:
//   1. Does the money match the invoice?           matchInvoice()
//   2. How old is the evidence?                    freshness()
//   3. Has this issuer earned trust over time?     reliability()
//
// Principle: a valid credential is not the same as a true transaction. These rules look at the evidence BEHIND a claim.
// Missing evidence is "unknown" (or "pending"), never "failed". Only contradicting evidence fails.

import type { Result } from "./rules";
import { rs } from "./rules";

export const DAY = 24 * 60 * 60;

/** The 6 months the rules engine looks at (the same window as the payment-app records). */
export const EVIDENCE_MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;
export const MONTH_LABEL: Record<string, string> = { "2026-05": "May 2026", "2026-06": "Jun 2026", "2026-07": "Jul 2026", "2026-08": "Aug 2026", "2026-09": "Sep 2026", "2026-10": "Oct 2026" };

/** Every threshold in one place, so nothing is hard-coded in the pages or the rules. */
export const EVIDENCE_CONFIG = {
  /** A payment may come this many days BEFORE the invoice date (an advance), and up to PAY_AFTER_DAYS after it. */
  payBeforeDays: 7,
  payAfterDays: 60,
  /** Freshness: up to `recentDays` since the last evidence is Recent, up to `ageingDays` is Ageing, more is Stale. */
  recentDays: 30,
  ageingDays: 60, // credentials last 90 days, so 'stale' must start before they expire
  /** Issuer reliability: fewer than this many decided items means "Limited history". */
  minSample: 5,
  /** Rejected + disputed share of decided claims that puts an issuer under review (needs at least 3 decided). */
  badShare: 0.25,
  /** Admin-approved rejections (cases) before an issuer is removed from the system: warning 1, 2, then the 3rd removes it. */
  warningLimit: 3,
  /** Supplier proof: payments (net of money sent back) must reach this share of what a month's bills say. */
  billPayShare: 0.7,
  /** Supplier proof: the shop must have paid the supplier's verified account in at least this many of the 6 months. */
  moneyTrailMin: 5,
  /** Uploaded bill PDFs: smallest and largest accepted (bytes). The cloud database holds them, so they stay small. */
  pdfMinBytes: 200,
  pdfMaxBytes: 400_000,
  /** An overpayment above this fraction of the invoice (after credit notes) is flagged for review. */
  overpayTolerance: 0.01,
} as const;

// ---------- 1. invoice-to-payment matching ----------

export type MatchStatus = "fully_matched" | "partially_matched" | "unmatched" | "duplicate" | "cancelled" | "requires_review";

export interface InvoiceInput {
  id: number;
  ref: string; // the supplier's invoice reference, e.g. "INV-GW-1042"
  supplierId: string; // the issuer's address
  supplierAccount: string | null; // the supplier's VERIFIED receiving account (from onboarding)
  shopId: string;
  amount: number; // rupees
  currency: string;
  date: number; // invoice date, unix seconds
  cancelled: boolean;
  creditNotes: number[]; // rupees credited back by the supplier (returns, discounts)
}

export interface PaymentInput {
  id: number;
  ref: string; // the payment reference, e.g. "UPI/INV-GW-1042"
  shopId: string; // who paid
  payeeAccount: string; // who was paid
  amount: number;
  currency: string;
  date: number; // unix seconds
  status: "settled" | "reversed" | "pending";
}

export interface MatchLine {
  id: "reference" | "amount" | "entities" | "dates" | "duplicates" | "returns" | "credit_notes";
  label: string;
  result: Result;
  found: string; // what was found
  why: string; // why it matters
  missing?: string; // what evidence is missing
  action?: string; // what to do about it
}

export interface MatchResult {
  status: MatchStatus;
  invoiceAmount: number;
  creditNotes: number;
  effectiveAmount: number; // invoice minus credit notes: what is really owed
  paymentAmount: number; // everything referencing this invoice, whatever its status
  matchedAmount: number; // settled payments that count (right payer, right payee, right dates)
  outstandingAmount: number;
  matchingPercentage: number; // 0 to 100
  lines: MatchLine[];
  failedChecks: string[]; // labels of checks that failed
  warnings: string[];
  evidenceRefs: string[]; // payment references that counted
  verifiedAt: number;
}

const norm = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
const day = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);

/**
 * Compare one invoice with the payment evidence. `payments` is every payment record we hold for the shop;
 * `others` is every OTHER invoice claim (for duplicate detection). `now` stamps the result.
 * The percentage alone never decides: a perfect amount from the wrong payer or payee still needs review.
 */
export function matchInvoice(inv: InvoiceInput, payments: PaymentInput[], others: Pick<InvoiceInput, "id" | "ref" | "supplierId">[], now: number): MatchResult {
  const cfg = EVIDENCE_CONFIG;
  const lines: MatchLine[] = [];
  const warnings: string[] = [];
  const failed: string[] = [];
  const credit = inv.creditNotes.reduce((t, n) => t + n, 0);
  const effective = Math.max(0, inv.amount - credit);
  const add = (l: MatchLine) => { lines.push(l); if (l.result === "fail") failed.push(l.label); };

  // A. Invoice reference: a payment belongs to this invoice if its reference contains the invoice reference.
  const refKey = norm(inv.ref);
  const candidates = payments.filter((p) => refKey && norm(p.ref).includes(refKey));
  add(candidates.length
    ? { id: "reference", label: "Invoice reference", result: "pass", found: `${candidates.length} payment${candidates.length === 1 ? "" : "s"} quote ${inv.ref}: ${candidates.map((p) => p.ref).join(", ")}.`, why: "A payment that names the invoice is the strongest link between the two." }
    : { id: "reference", label: "Invoice reference", result: "unknown", found: `No payment record quotes ${inv.ref}.`, why: "Without a reference we cannot tell which payment settled which invoice.", missing: "A payment record that carries this invoice reference.", action: "Ask the payment app to share the payment, or the supplier to quote the reference." });

  // F. Returns and cancellations: reversed payments never count; a cancelled invoice is downgraded.
  const reversed = candidates.filter((p) => p.status === "reversed");
  const pending = candidates.filter((p) => p.status === "pending");
  const settled = candidates.filter((p) => p.status === "settled");
  const returnsProblem = inv.cancelled || reversed.length > 0;
  add({
    id: "returns", label: "Returns and cancellations",
    result: returnsProblem ? "fail" : "pass",
    found: inv.cancelled ? "The supplier cancelled this invoice." : reversed.length ? `${reversed.length} payment${reversed.length === 1 ? " was" : "s were"} reversed (${rs(reversed.reduce((t, p) => t + p.amount, 0))}).` : pending.length ? `${pending.length} payment${pending.length === 1 ? " is" : "s are"} still pending and not counted yet.` : "Nothing was cancelled or reversed.",
    why: "Money that went back, or an invoice that no longer stands, is not evidence of a sale.",
    action: returnsProblem ? "Treat this evidence as withdrawn unless a new invoice replaces it." : undefined,
  });
  if (reversed.length) warnings.push("A payment for this invoice was reversed.");
  if (pending.length) warnings.push("A payment for this invoice is still pending.");

  // G. Credit notes lower what is owed.
  add({
    id: "credit_notes", label: "Credit notes",
    result: "pass",
    found: credit ? `${inv.creditNotes.length} credit note${inv.creditNotes.length === 1 ? "" : "s"} totalling ${rs(credit)}, so ${rs(effective)} is owed on the ${rs(inv.amount)} invoice.` : "No credit notes.",
    why: "Returns and discounts reduce what the shop really owes, so they must reduce what the payment has to cover.",
  });

  // C. Entities: right payer (the shop) and right payee (the supplier's verified account), and the right currency.
  const wrongPayer = settled.filter((p) => p.shopId !== inv.shopId);
  const wrongPayee = settled.filter((p) => p.shopId === inv.shopId && (!inv.supplierAccount || p.payeeAccount !== inv.supplierAccount));
  const wrongCurrency = settled.filter((p) => p.currency !== inv.currency);
  const entityProblem = wrongPayer.length + wrongPayee.length + wrongCurrency.length > 0 || inv.currency !== "INR";
  add(!candidates.length
    ? { id: "entities", label: "Payer and payee", result: "unknown", found: "No payment to compare.", why: "The payment must go from this shop to this supplier's verified account.", missing: "A payment record." }
    : !inv.supplierAccount
      ? { id: "entities", label: "Payer and payee", result: "unknown", found: "The supplier has no verified receiving account on file.", why: "Payments are matched to the verified account only.", missing: "The supplier's verified bank account.", action: "Complete issuer onboarding." }
      : entityProblem
        ? { id: "entities", label: "Payer and payee", result: "fail", found: [wrongPayer.length ? `${wrongPayer.length} payment${wrongPayer.length === 1 ? " came" : "s came"} from a different business` : "", wrongPayee.length ? `${wrongPayee.length} went to an account that is not the supplier's verified account` : "", wrongCurrency.length || inv.currency !== "INR" ? "the currency is not INR" : ""].filter(Boolean).join("; ") + ".", why: "A matching amount means little if the money did not go from this shop to this supplier.", action: "A person should review the payment and invoice details." }
        : { id: "entities", label: "Payer and payee", result: "pass", found: "Paid by this shop, to the supplier's verified account, in INR.", why: "The right two parties are on both documents." });

  // D. Dates: a payment counts only when it falls in the allowed window around the invoice date.
  const early = inv.date - cfg.payBeforeDays * DAY, late = inv.date + cfg.payAfterDays * DAY;
  const outside = settled.filter((p) => p.date < early || p.date > late);
  add(!candidates.length
    ? { id: "dates", label: "Dates", result: "unknown", found: "No payment to compare.", why: "A payment should land close to the invoice date.", missing: "A payment record with a date." }
    : outside.length
      ? { id: "dates", label: "Dates", result: "fail", found: `${outside.length} payment${outside.length === 1 ? " is" : "s are"} dated ${outside.map((p) => day(p.date)).join(", ")}, outside ${day(early)} to ${day(late)} for an invoice dated ${day(inv.date)}.`, why: "A payment far from the invoice date may belong to a different sale.", action: "Check whether the payment really settles this invoice." }
      : { id: "dates", label: "Dates", result: "pass", found: `All payments fall between ${day(early)} and ${day(late)} (invoice dated ${day(inv.date)}).`, why: "Payment and invoice are close in time." });

  // E. Duplicates: the same invoice reference used by the same supplier in another claim.
  const dup = others.filter((o) => o.id !== inv.id && o.supplierId === inv.supplierId && norm(o.ref) === refKey && o.id < inv.id);
  add(dup.length
    ? { id: "duplicates", label: "Duplicate evidence", result: "fail", found: `Invoice ${inv.ref} was already submitted by this supplier (claim #${dup[0].id}).`, why: "Using one invoice to back several claims inflates the evidence.", action: "Count it once. Ask the supplier which claim it belongs to." }
    : { id: "duplicates", label: "Duplicate evidence", result: "pass", found: "This invoice reference has not been used in another claim.", why: "Each invoice should back one claim." });

  // B. Amounts: only payments that are settled, from the right payer, to the right payee, in the window and the right currency count.
  const counted = settled.filter((p) => !wrongPayer.includes(p) && !wrongPayee.includes(p) && !wrongCurrency.includes(p) && !outside.includes(p));
  const paymentAmount = candidates.reduce((t, p) => t + p.amount, 0);
  const counting = counted.reduce((t, p) => t + p.amount, 0);
  const matched = Math.min(counting, effective);
  const outstanding = Math.max(0, effective - matched);
  const pct = effective > 0 ? Math.min(100, (matched / effective) * 100) : 0;
  const over = effective > 0 && counting > effective * (1 + cfg.overpayTolerance);
  add(!candidates.length
    ? { id: "amount", label: "Amounts", result: "unknown", found: `Invoice ${rs(effective)}; no payment evidence yet.`, why: "The invoice amount should be covered by payments.", missing: "Payment evidence.", action: "Wait for the payment app's records. Unknown is not bad." }
    : over
      ? { id: "amount", label: "Amounts", result: "fail", found: `Paid ${rs(counting)} against an invoice of ${rs(effective)}: ${rs(counting - effective)} more than owed.`, why: "An overpayment can mean a wrong reference, a second invoice, or a refund still to come.", action: "A person should review the amounts." }
      : pct >= 99.5
        ? { id: "amount", label: "Amounts", result: "pass", found: `Paid ${rs(counting)} against ${rs(effective)}: exact match.`, why: "The payment covers the invoice." }
        : { id: "amount", label: "Amounts", result: counting > 0 ? "fail" : "unknown", found: `Paid ${rs(counting)} against ${rs(effective)}: ${pct.toFixed(1)}% matched, ${rs(outstanding)} outstanding.`, why: "Only the paid part of the invoice is supported by evidence.", missing: counting > 0 ? `Payment for the remaining ${rs(outstanding)}.` : "A settled payment.", action: "Treat the claim as only partly supported." });
  if (counting > 0 && pct < 99.5 && !over) warnings.push(`Only ${pct.toFixed(1)}% of the invoice is matched; ${rs(outstanding)} is outstanding.`);
  if (over) warnings.push("The payment is higher than the invoice.");

  // Overall status. Order matters: the most serious finding wins.
  let status: MatchStatus;
  if (inv.cancelled) status = "cancelled";
  else if (dup.length) status = "duplicate";
  else if (reversed.length || entityProblem || outside.length || over) status = "requires_review";
  else if (!candidates.length || counting === 0) status = "unmatched";
  else if (pct >= 99.5) status = "fully_matched";
  else status = "partially_matched";

  return {
    status, invoiceAmount: inv.amount, creditNotes: credit, effectiveAmount: effective, paymentAmount,
    matchedAmount: matched, outstandingAmount: outstanding, matchingPercentage: Math.round(pct * 10) / 10,
    lines, failedChecks: failed, warnings, evidenceRefs: counted.map((p) => p.ref), verifiedAt: now,
  };
}

export const MATCH_LABEL: Record<MatchStatus, string> = {
  fully_matched: "Fully matched", partially_matched: "Partially matched", unmatched: "Unmatched",
  duplicate: "Duplicate", cancelled: "Cancelled", requires_review: "Requires review",
};

// ---------- 2. evidence freshness ----------

export type Freshness = "recent" | "ageing" | "stale" | "expired";

export interface FreshnessResult {
  status: Freshness;
  issuedAt: number;
  expiresAt: number;
  lastVerifiedAt: number; // the latest evidence we hold: issue date, confirmation, or payment record
  lastTransactionAt: number | null; // the latest supporting invoice or payment date
  daysSinceVerified: number;
}

/**
 * How old is the evidence behind a credential? Old evidence is never hidden: it is labelled.
 * `expired` follows the credential's own expiry; the other three come from days since the last evidence.
 */
export function freshness(args: { issuedAt: number; expiresAt: number; evidenceAt: number[]; transactionAt: number[]; now: number }): FreshnessResult {
  const lastVerifiedAt = Math.max(args.issuedAt, ...args.evidenceAt);
  const days = Math.max(0, Math.floor((args.now - lastVerifiedAt) / DAY));
  const status: Freshness = args.now >= args.expiresAt ? "expired" : days <= EVIDENCE_CONFIG.recentDays ? "recent" : days <= EVIDENCE_CONFIG.ageingDays ? "ageing" : "stale";
  return {
    status, issuedAt: args.issuedAt, expiresAt: args.expiresAt, lastVerifiedAt,
    lastTransactionAt: args.transactionAt.length ? Math.max(...args.transactionAt) : null, daysSinceVerified: days,
  };
}

export const FRESHNESS_LABEL: Record<Freshness, string> = { recent: "Recent", ageing: "Ageing", stale: "Stale", expired: "Expired" };

// ---------- 3. issuer reliability ----------

export type Reliability = "established" | "limited_history" | "under_review" | "restricted";

export interface ReliabilityMetrics {
  credentialsIssued: number;
  confirmed: number;
  rejected: number;
  disputed: number;
  pending: number;
  upheldOnChain: number; // disputes a lender won against this issuer (contract)
  upheldInvoice: number; // invoice disputes the admin upheld against this issuer
  warnings: number; // rejections the admin approved against this issuer (the 3rd removes it from the system)
  duplicates: number;
  revoked: number;
  suspended: boolean;
  approved: boolean; // in the issuer registry
}

export interface ReliabilityResult {
  category: Reliability;
  metrics: ReliabilityMetrics;
  decided: number; // confirmed + rejected + disputed (the claims a business has answered)
  reasons: string[]; // the explanation, line by line
}

/**
 * Not a score: a category, the numbers behind it, and the reasons. Small samples are never "Established":
 * two untouched credentials prove nothing yet.
 */
export function reliability(m: ReliabilityMetrics): ReliabilityResult {
  const cfg = EVIDENCE_CONFIG;
  const decided = m.confirmed + m.rejected + m.disputed;
  const sample = m.credentialsIssued + decided;
  const upheld = m.upheldOnChain + m.upheldInvoice;
  const flags = m.rejected + m.disputed + m.duplicates;
  const reasons: string[] = [];
  let category: Reliability;

  // Restricted = out or on its way out: suspended/removed, the warning limit reached, or the contract's own 2 upheld disputes.
  // (Approved cases count as WARNINGS, not as extra strikes, so one ruling is never counted twice.)
  if (m.suspended || m.upheldOnChain >= 2 || m.warnings >= cfg.warningLimit) {
    category = "restricted";
    reasons.push(m.suspended ? "The issuer is suspended or removed." : m.warnings >= cfg.warningLimit ? `${m.warnings} warnings: the limit is ${cfg.warningLimit}.` : `${m.upheldOnChain} disputes were upheld against it on-chain.`);
  } else if (upheld >= 1 || m.warnings >= 1 || flags >= 2 || (decided >= 3 && (m.rejected + m.disputed) / decided > cfg.badShare)) {
    category = "under_review";
    if (upheld >= 1) reasons.push(`${upheld} dispute was upheld against it.`);
    if (m.warnings >= 1) reasons.push(`${m.warnings} of ${cfg.warningLimit} warnings after rejections the admin approved.`);
    if (flags >= 2) reasons.push(`${flags} claims were rejected, disputed or duplicated.`);
    if (decided >= 3 && (m.rejected + m.disputed) / decided > cfg.badShare) reasons.push(`${m.rejected + m.disputed} of ${decided} answered claims were rejected or disputed (more than ${Math.round(cfg.badShare * 100)}%).`);
  } else if (sample < cfg.minSample) {
    category = "limited_history";
    reasons.push(`Only ${sample} credential${sample === 1 ? "" : "s"} and answered claim${sample === 1 ? "" : "s"} so far (${cfg.minSample} are needed). No disputes yet proves little.`);
    if (flags === 1) reasons.push("One claim was rejected, disputed or duplicated.");
  } else {
    category = "established";
    reasons.push(`${sample} credentials and answered claims, ${m.confirmed} confirmed, no upheld disputes, and few or no rejections.`);
  }
  if (!m.approved) reasons.push("Not in the issuer registry.");
  return { category, metrics: m, decided, reasons };
}

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  established: "Established", limited_history: "Limited history", under_review: "Under review", restricted: "Restricted",
};

// ---------- 4. supplier proof: is this really the shop's supplier, and do its monthly bills hold up? ----------

export type ProofStatus = "verified" | "partial" | "unverified" | "flagged";

export interface ProofStatement { id: number; month: string; billed: number; billCount: number; nameOnBill: string; fileHash: string }
export interface ProofInput {
  shopName: string;
  shopOwner: string;
  link: "none" | "pending" | "confirmed" | "rejected"; // has the shop confirmed "this is my supplier"?
  statements: ProofStatement[]; // the current (not replaced) monthly statements
  flows: Record<string, { paid: number; returned: number; net: number }> | null; // payment-app records per month; null = none shared
  reusedHashes: Set<string>; // file fingerprints that appear on more than one statement
  independence: "pass" | "fail" | "unknown"; // fraud check 3 for this supplier and shop
}
export interface ProofLine { id: string; label: string; result: Result; found: string; why: string; missing?: string; action?: string }
export interface ProofMonth { month: string; label: string; uploaded: boolean; billed: number; paid: number; net: number; share: number | null; result: Result }
export interface ProofResult { status: ProofStatus; lines: ProofLine[]; months: ProofMonth[] }

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The evidence that a supplier really supplies this shop, in seven plain checks. Missing evidence is "unknown", never "fail".
 * Note: the text inside the uploaded PDFs is NOT read (that needs document parsing). The PDFs are stored and fingerprinted for a
 * person to open; the numbers typed in are what the checks compare with the payment records.
 */
export function supplierProof(i: ProofInput): ProofResult {
  const cfg = EVIDENCE_CONFIG;
  const lines: ProofLine[] = [];
  const byMonth = new Map(i.statements.map((s) => [s.month, s]));
  const rs0 = (n: number) => rs(n);

  // 1. The shop says so.
  lines.push(i.link === "confirmed"
    ? { id: "link", label: "The shop confirms this supplier", result: "pass", found: "The shop confirmed that this business supplies it.", why: "Only the shop can say who really supplies it." }
    : i.link === "rejected"
      ? { id: "link", label: "The shop confirms this supplier", result: "fail", found: "The shop said this business is NOT its supplier.", why: "A supplier the shop denies has no business vouching for it.", action: "A person should review. Ask the shop why." }
      : { id: "link", label: "The shop confirms this supplier", result: "unknown", found: i.link === "pending" ? "Waiting for the shop to answer." : "The supplier has not asked the shop to confirm yet.", why: "Only the shop can say who really supplies it.", missing: "The shop's confirmation.", action: "The supplier asks the shop to confirm; the shop answers on its page." });

  // 2. Bills for each month.
  const have = EVIDENCE_MONTHS.filter((m) => byMonth.has(m));
  lines.push(have.length === EVIDENCE_MONTHS.length
    ? { id: "coverage", label: "A bill for every month", result: "pass", found: `All ${EVIDENCE_MONTHS.length} monthly bills are uploaded (${EVIDENCE_MONTHS.map((m) => MONTH_LABEL[m]).join(", ")}).`, why: "A real supplier bills a regular customer every month." }
    : { id: "coverage", label: "A bill for every month", result: "unknown", found: `${have.length} of ${EVIDENCE_MONTHS.length} months uploaded.`, why: "A real supplier bills a regular customer every month. Missing months are unknown, not bad.", missing: `Bills for ${EVIDENCE_MONTHS.filter((m) => !byMonth.has(m)).map((m) => MONTH_LABEL[m]).join(", ")}.`, action: "Upload the missing monthly bills." });

  // 3. Each month's bills against what the shop really paid (payment-app records, net of money sent back).
  const months: ProofMonth[] = EVIDENCE_MONTHS.map((m) => {
    const st = byMonth.get(m);
    const f = i.flows ? i.flows[m] : undefined;
    const share = st && f && st.billed > 0 ? f.net / st.billed : null;
    const result: Result = !st || !f ? "unknown" : share! >= cfg.billPayShare ? "pass" : "fail";
    return { month: m, label: MONTH_LABEL[m], uploaded: !!st, billed: st?.billed ?? 0, paid: f?.paid ?? 0, net: f?.net ?? 0, share, result };
  });
  const checked = months.filter((x) => x.uploaded && i.flows);
  const short = checked.filter((x) => x.result === "fail");
  lines.push(!i.flows
    ? { id: "payments", label: "Bills match what the shop paid", result: "unknown", found: "No payment-app records for this supplier and shop.", why: "Bills only count when real payments back them.", missing: "Payment-app records of what the shop paid this supplier's verified account.", action: "A payment app the shop approved must share them." }
    : !checked.length
      ? { id: "payments", label: "Bills match what the shop paid", result: "unknown", found: "No monthly bills to compare yet.", why: "Bills only count when real payments back them.", missing: "Monthly bills." }
      : short.length
        ? { id: "payments", label: "Bills match what the shop paid", result: "fail", found: `${short.map((x) => `${x.label}: billed ${rs0(x.billed)}, paid net ${rs0(x.net)} (${Math.round((x.share ?? 0) * 100)}%)`).join("; ")}. At least ${Math.round(cfg.billPayShare * 100)}% is needed.`, why: "Bills the money doesn't back are claims, not sales.", action: "A person should review these months." }
        : { id: "payments", label: "Bills match what the shop paid", result: "pass", found: `In ${checked.length} month${checked.length === 1 ? "" : "s"}, payments (net of money sent back) reach at least ${Math.round(cfg.billPayShare * 100)}% of the bills.`, why: "The money backs the bills." });

  // 4. A regular money trail.
  const trail = i.flows ? EVIDENCE_MONTHS.filter((m) => (i.flows![m]?.paid ?? 0) > 0).length : 0;
  lines.push(!i.flows
    ? { id: "trail", label: "A regular payment trail", result: "unknown", found: "No payment-app records.", why: "A real supplier is paid regularly.", missing: "Payment-app records." }
    : trail >= cfg.moneyTrailMin
      ? { id: "trail", label: "A regular payment trail", result: "pass", found: `The shop paid this supplier's verified account in ${trail} of ${EVIDENCE_MONTHS.length} months.`, why: "A real supplier is paid regularly." }
      : trail === 0
        ? { id: "trail", label: "A regular payment trail", result: "fail", found: "The records show no payment from the shop to this supplier's verified account.", why: "Bills with no payments behind them are suspect.", action: "A person should review." }
        : { id: "trail", label: "A regular payment trail", result: "unknown", found: `Payments in only ${trail} of ${EVIDENCE_MONTHS.length} months (${cfg.moneyTrailMin} are expected).`, why: "A new or irregular relationship is unknown, not bad.", missing: "More months of payments." });

  // 5. The bills name this shop.
  const shopKey = normName(i.shopName), ownerKey = normName(i.shopOwner);
  const wrong = i.statements.filter((s) => { const n = normName(s.nameOnBill); return !(n && ((shopKey && (n.includes(shopKey) || (n.length >= 4 && shopKey.includes(n)))) || (ownerKey && n.includes(ownerKey)))); });
  lines.push(!i.statements.length
    ? { id: "name", label: "The bills name this shop", result: "unknown", found: "No bills yet.", why: "Bills should be made out to the shop.", missing: "Monthly bills." }
    : wrong.length
      ? { id: "name", label: "The bills name this shop", result: "fail", found: `${wrong.map((s) => `${MONTH_LABEL[s.month]}: "${s.nameOnBill}"`).join("; ")} does not match "${i.shopName}" or its owner.`, why: "Bills made out to someone else don't show this shop is the customer.", action: "A person should open the PDF and check the name." }
      : { id: "name", label: "The bills name this shop", result: "pass", found: `Every bill is made out to "${i.shopName}" (or its owner).`, why: "The bills are addressed to the right customer." });

  // 6. No reused documents.
  const reused = i.statements.filter((s) => i.reusedHashes.has(s.fileHash));
  lines.push(!i.statements.length
    ? { id: "reuse", label: "No reused documents", result: "unknown", found: "No bills yet.", why: "One PDF must not stand for several months or shops.", missing: "Monthly bills." }
    : reused.length
      ? { id: "reuse", label: "No reused documents", result: "fail", found: `${reused.map((s) => MONTH_LABEL[s.month]).join(", ")}: the same file was uploaded more than once (for another month, shop or supplier).`, why: "Reusing one document for several claims is a classic way to fake a history.", action: "Ask for the real bill for each month." }
      : { id: "reuse", label: "No reused documents", result: "pass", found: "Every uploaded file is different.", why: "Each month has its own document." });

  // 7. Independent of the shop (fraud check 3).
  lines.push(i.independence === "pass"
    ? { id: "independent", label: "Independent of the shop", result: "pass", found: "No shared owner, phone, bank account or address with the shop.", why: "A supplier that is the shop's own business can't vouch for it." }
    : i.independence === "fail"
      ? { id: "independent", label: "Independent of the shop", result: "fail", found: "Shares details with the shop (see fraud check 3).", why: "A supplier that is the shop's own business can't vouch for it.", action: "Treat the bills as the shop's own." }
      : { id: "independent", label: "Independent of the shop", result: "unknown", found: "Not enough details on file to compare.", why: "A supplier that is the shop's own business can't vouch for it.", missing: "The supplier's and shop's details." });

  const fails = lines.filter((l) => l.result === "fail").length, passes = lines.filter((l) => l.result === "pass").length;
  const status: ProofStatus = fails ? "flagged" : passes === lines.length ? "verified" : passes ? "partial" : "unverified";
  return { status, lines, months };
}

export const PROOF_LABEL: Record<ProofStatus, string> = { verified: "Verified supplier", partial: "Partly verified", unverified: "Not verified yet", flagged: "Flagged" };
