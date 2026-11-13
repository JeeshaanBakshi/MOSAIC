// Fraud checks 2, 3 and 4 as plain functions: data in, verdict out. No ML, no network.
// Each returns "pass" | "fail" | "unknown", a one-line reason, the numbers used, and WHOSE data they came from.
// Missing evidence is ALWAYS "unknown", never "fail".
//
// The rule that keeps issuers honest: an issuer's own numbers never pass its own claim.
//   - A supplier's claim is judged by PAYMENT-APP records of what the shop paid to the supplier's VERIFIED account.
//   - What the supplier typed ("Supplier says") is shown next to it, but never used.
//   - A payment app's claim about receipts is judged by its own records, and is labelled that way.
//
// CONNECT: these same rules run in the Python backend (backend/rules.py in the old build).
// When you have a backend, delete this file and let the API return the results.

export type Result = "pass" | "fail" | "unknown";
export interface CheckResult {
  check: number;
  name: "payment_match" | "independence" | "net_flow";
  result: Result;
  reason: string;
  numbers: string; // the figures the verdict used, on one line
  source: string; // which party's data this came from
}

/** What a payment app records for ONE shop in ONE month. Amounts are rupees. */
export interface FeedMonth {
  receipts: number; // money IN to the shop (everything that came in, including transfers back from payees)
  payees: Record<string, { out: number; back: number }>; // per payee ACCOUNT: the shop paid out `out`, money came back `back`
}
export interface PaymentFeed {
  months: FeedMonth[]; // the 6 months of the window
}

export interface Party {
  owner: string;
  phone: string;
  bankAccount: string;
  address: string;
}

export type IssuerKindName = "Supplier" | "PaymentProvider";

const MATCH_THRESHOLD = 0.7; // check 2: real payments must reach 70% of the claim

/** Rupees with Indian grouping: 200000 -> "₹2,00,000". */
export function rs(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** Pull the monthly rupee amount out of a claim: "buys ₹45,000 a month", "Rs 2 lakh" (1 lakh = 100,000). */
export function parseClaimedAmount(summary: string): number | null {
  const m = summary.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s*(lakh)?/i);
  if (!m) return null;
  let value = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) value *= 100_000;
  return Math.round(value);
}

export interface MonthFlow {
  paid: number; // the flow the claim is about
  returned: number; // money that came straight back (the same month's record = within 30 days)
  net: number; // paid minus returned
}

/**
 * The month-by-month flow behind one claim, from payment-app records.
 *  - Supplier: `paid` = what the shop paid to the supplier's verified account, `returned` = what that account sent back.
 *  - Payment app: `paid` = the shop's receipts, `returned` = money in from payees that the shop had paid out
 *    (the same money going round in a circle is not a sale).
 * `account` is the supplier's verified receiving account (ignored for payment apps).
 */
export function monthlyFlows(feed: PaymentFeed, kind: IssuerKindName, account: string | null): MonthFlow[] {
  return feed.months.map((m) => {
    if (kind === "PaymentProvider") {
      const returned = Object.values(m.payees).reduce((t, p) => t + Math.min(p.out, p.back), 0);
      return { paid: m.receipts, returned, net: Math.max(0, m.receipts - returned) };
    }
    const p = account ? m.payees[account] : undefined;
    const paid = p?.out ?? 0;
    const returned = Math.min(paid, p?.back ?? 0);
    return { paid, returned, net: paid - returned };
  });
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

export interface FlowContext {
  claimed: number | null;
  kind: IssuerKindName;
  account: string | null; // supplier's verified receiving account
  feed: PaymentFeed | null; // payment-app records for this shop (null = none shared)
  feedFrom: string; // the payment app that supplied them, e.g. "PayLink"
}

/** Why a flow check can't be run yet, or null when it can. Always "unknown", never "fail". */
function whyUnknown(c: FlowContext): { reason: string; source: string } | null {
  if (c.claimed === null) return { reason: "The claim has no rupee amount to compare.", source: "The claim" };
  if (c.kind === "Supplier" && !c.account) return { reason: "This supplier has no verified receiving account on file, so payments to it can't be matched.", source: "Issuer registry" };
  if (!c.feed) return { reason: "No payment-app records for this shop. A payment app the shop has approved must share them.", source: "Payment app (none shared)" };
  return null;
}

function sourceOf(c: FlowContext) {
  return c.kind === "PaymentProvider"
    ? `Payment app ${c.feedFrom} (the issuer's own records)`
    : `Payment app ${c.feedFrom}: shop → ${c.account}`;
}

/**
 * Check 2: a claim of ₹X a month counts only if payment-app records show the shop paying that supplier's VERIFIED account
 * (or, for a payment app, receipts) of at least 70% of X, averaged over the 6 months.
 */
export function paymentMatch(c: FlowContext): CheckResult {
  const base = { check: 2, name: "payment_match" } as const;
  const why = whyUnknown(c);
  if (why) return { ...base, result: "unknown", reason: why.reason, numbers: "No numbers yet.", source: why.source };
  const flows = monthlyFlows(c.feed!, c.kind, c.account);
  const monthly = avg(flows.map((f) => f.paid));
  const needed = c.claimed! * MATCH_THRESHOLD;
  const pct = (100 * monthly) / c.claimed!;
  return {
    ...base,
    result: monthly >= needed ? "pass" : "fail",
    reason: `${c.kind === "PaymentProvider" ? "Money in to the shop (receipts, including any transfers back from payees)" : "Payments to the verified account"} average ${rs(monthly)}/month = ${pct.toFixed(0)}% of the claimed ${rs(c.claimed!)} (needs at least ${rs(needed)}).`,
    numbers: `Claimed ${rs(c.claimed!)}/month · records show ${rs(monthly)}/month · needs ${rs(needed)} (70%)`,
    source: sourceOf(c),
  };
}

/**
 * Check 4: take away money that came straight back (supplier's account → shop, within 30 days), using the payment app's
 * records, then run check 2 again on what is left.
 */
export function netFlow(c: FlowContext): CheckResult {
  const base = { check: 4, name: "net_flow" } as const;
  const why = whyUnknown(c);
  if (why) return { ...base, result: "unknown", reason: why.reason, numbers: "No numbers yet.", source: why.source };
  const flows = monthlyFlows(c.feed!, c.kind, c.account);
  const gross = avg(flows.map((f) => f.paid));
  const returned = avg(flows.map((f) => f.returned));
  const net = avg(flows.map((f) => f.net));
  const needed = c.claimed! * MATCH_THRESHOLD;
  return {
    ...base,
    result: net >= needed ? "pass" : "fail",
    reason: `${rs(returned)}/month came back within 30 days (a month's records), so ${rs(gross)} paid leaves a net ${rs(net)}/month against the ${rs(needed)} needed.`,
    numbers: `Paid ${rs(gross)}/month − came back ${rs(returned)}/month = net ${rs(net)}/month · needs ${rs(needed)} (70% of ${rs(c.claimed!)})`,
    source: sourceOf(c),
  };
}

const digits = (s: string) => s.replace(/\D/g, "").slice(-10); // last 10 digits of a phone number
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Check 3: the issuer must not share an owner, phone, bank account or address with the SHOP.
 * A failure says which field matched. If a field is missing on either side it can't be compared: unknown, not pass.
 */
export function independence(shop: Party | null, issuer: Party | null): CheckResult {
  const base = { check: 3, name: "independence" } as const;
  const source = "Issuer's registry/application details vs the shop's profile";
  if (!shop) return { ...base, result: "unknown", reason: "We have no profile for this shop to compare with.", numbers: "No numbers yet.", source };
  if (!issuer) return { ...base, result: "unknown", reason: "Issuer identity not on file.", numbers: "No numbers yet.", source };
  const fields: { label: string; same: boolean; comparable: boolean; value: string }[] = [
    { label: "owner", comparable: !!norm(shop.owner) && !!norm(issuer.owner), same: norm(shop.owner) === norm(issuer.owner), value: shop.owner },
    { label: "phone", comparable: !!digits(shop.phone) && !!digits(issuer.phone), same: digits(shop.phone) === digits(issuer.phone), value: shop.phone },
    { label: "bank account", comparable: !!norm(shop.bankAccount) && !!norm(issuer.bankAccount), same: norm(shop.bankAccount) === norm(issuer.bankAccount), value: shop.bankAccount },
    { label: "address", comparable: !!norm(shop.address) && !!norm(issuer.address), same: norm(shop.address) === norm(issuer.address), value: shop.address },
  ];
  const matched = fields.filter((f) => f.comparable && f.same);
  const missing = fields.filter((f) => !f.comparable).map((f) => f.label);
  const numbers = `Compared ${fields.filter((f) => f.comparable).map((f) => f.label).join(", ") || "nothing"} · matched: ${matched.map((f) => f.label).join(", ") || "none"}`;
  if (matched.length) {
    return { ...base, result: "fail", reason: `Issuer shares ${matched.map((f) => `${f.label} (${f.value})`).join(", ")} with the shop.`, numbers, source };
  }
  if (missing.length) {
    return { ...base, result: "unknown", reason: `No match on what could be compared, but the ${missing.join(" and ")} could not be compared (missing on file).`, numbers, source };
  }
  return { ...base, result: "pass", reason: "No shared owner, phone, bank account or address with the shop.", numbers, source };
}
