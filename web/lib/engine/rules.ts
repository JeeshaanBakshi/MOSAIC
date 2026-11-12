// Fraud checks 2, 3 and 4 as plain functions: data in, verdict out. No ML, no network.
// Each returns "pass" | "fail" | "unknown" plus a one-line reason with the numbers.
// Missing evidence is ALWAYS "unknown", never "fail".
//
// CONNECT: these same rules run in the Python backend (backend/rules.py in the old build).
// When you have a backend, delete this file and let the API return the results.

export type Result = "pass" | "fail" | "unknown";
export interface CheckResult {
  check: number;
  name: "payment_match" | "independence" | "net_flow";
  result: Result;
  reason: string;
}

export interface Payment {
  from: string;
  to: string;
  amountInr: number;
  date: string; // YYYY-MM-DD
  note: string;
}

export interface Party {
  owner: string;
  phone: string;
  bankAccount: string;
  address: string;
}

const MATCH_THRESHOLD = 0.7; // check 2: real payments must reach 70% of the claim
const ROUND_TRIP_DAYS = 30; // check 4: money returned within 30 days doesn't count

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

/**
 * Split payments into FORWARD (the flow the claim is about) and REVERSE (money going back).
 *  - Supplier says "they buy from us":      forward = shop -> supplier
 *  - Payment provider says "they receive":  forward = provider -> shop (settlements)
 */
export function splitFlows(payments: Payment[], shopId: string, issuerKey: string, kind: "Supplier" | "PaymentProvider") {
  if (kind === "PaymentProvider") {
    return {
      forward: payments.filter((p) => p.from === issuerKey && p.to === shopId),
      reverse: payments.filter((p) => p.from === shopId && p.to === issuerKey),
    };
  }
  return {
    forward: payments.filter((p) => p.from === shopId && p.to === issuerKey),
    reverse: payments.filter((p) => p.from === issuerKey && p.to === shopId),
  };
}

const sum = (ps: Payment[]) => ps.reduce((t, p) => t + p.amountInr, 0);

/** Check 2: a claim of ₹X a month counts only if real payments average at least 70% of X. */
export function paymentMatch(claimed: number | null, forward: Payment[], months: number, haveData: boolean): CheckResult {
  const base = { check: 2, name: "payment_match" } as const;
  if (claimed === null) return { ...base, result: "unknown", reason: "The claim has no rupee amount to compare." };
  if (!haveData) return { ...base, result: "unknown", reason: "No payment records shared for this issuer." };
  const monthly = sum(forward) / months;
  const needed = claimed * MATCH_THRESHOLD;
  const pct = claimed ? (100 * monthly) / claimed : 0;
  return {
    ...base,
    result: monthly >= needed ? "pass" : "fail",
    reason: `Real payments average ${rs(monthly)}/month = ${pct.toFixed(0)}% of the claimed ${rs(claimed)} (needs at least ${rs(needed)}).`,
  };
}

const digits = (s: string) => s.replace(/\D/g, "").slice(-10); // last 10 digits of a phone number
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Check 3: the issuer must not share an owner, phone, bank account or address with the shop. */
export function independence(shop: Party, issuer: Party | null): CheckResult {
  const base = { check: 3, name: "independence" } as const;
  if (!issuer) return { ...base, result: "unknown", reason: "Issuer identity not on file." };
  const shared: string[] = [];
  if (norm(shop.owner) === norm(issuer.owner)) shared.push(`owner ${shop.owner}`);
  if (digits(shop.phone) && digits(shop.phone) === digits(issuer.phone)) shared.push(`phone ${shop.phone}`);
  if (norm(shop.bankAccount) === norm(issuer.bankAccount)) shared.push(`bank account ${shop.bankAccount}`);
  if (norm(shop.address) === norm(issuer.address)) shared.push(`address ${shop.address}`);
  return shared.length
    ? { ...base, result: "fail", reason: `Issuer shares ${shared.join(", ")} with the shop.` }
    : { ...base, result: "pass", reason: "No shared owner, phone, bank account or address." };
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** Check 4: subtract money that came straight back within 30 days (round-tripping), then re-run check 2. */
export function netFlow(claimed: number | null, forward: Payment[], reverse: Payment[], months: number, haveData: boolean): CheckResult {
  const base = { check: 4, name: "net_flow" } as const;
  if (claimed === null || !haveData) return { ...base, result: "unknown", reason: "Not enough data to compute net flow." };
  const roundTrips = reverse.filter((r) => forward.some((f) => {
    const d = daysBetween(f.date, r.date);
    return d >= 0 && d <= ROUND_TRIP_DAYS;
  }));
  const returned = sum(roundTrips);
  const net = (sum(forward) - returned) / months;
  const needed = claimed * MATCH_THRESHOLD;
  return {
    ...base,
    result: net >= needed ? "pass" : "fail",
    reason: `${rs(returned)} came back within ${ROUND_TRIP_DAYS} days (${roundTrips.length} payments); net ${rs(net)}/month vs needed ${rs(needed)}.`,
  };
}
