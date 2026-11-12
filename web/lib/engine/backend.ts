import "server-only";
// The fake rules-engine backend (checks 2-4 + the trust graph).
// It reads credentials from the fake contract, then compares each claim with FAKE payment records.
//
// CONNECT (the whole file): replace with calls to your FastAPI server:
//   getShops()   -> GET /shops
//   getShop(id)  -> GET /shops/{id}
//   getChecks(id)-> GET /shops/{id}/checks
//   getGraph(id) -> GET /shops/{id}/graph
// Keep the return shapes below and the pages won't notice.

import { ACCOUNTS, type RoleId } from "./accounts";
import { SHOPS, type Shop } from "./data";
import { getCredentials, markChecked } from "./contract";
import { netFlow, independence, paymentMatch, parseClaimedAmount, splitFlows, type CheckResult, type Party, type Payment } from "./rules";
import { sleep } from "./util";
import { read, mutateDb, type Evidence } from "./store";
import type { ReviewCheck } from "./onboarding";
import { rs } from "./rules";
import { ApiError, ContractError, type IssuerKind, type Status } from "./types";

const LATENCY_MS = 300;
const MONTHS = 6; // the evidence window: May to Oct 2026

// ---------- fake data ----------

/** Who each issuer really is. Issuer 3 shares the shop owner's phone number on purpose. */
const ISSUER_IDENTITY: Partial<Record<RoleId, Party>> = {
  gupta: { owner: "Issuer 1 Owner", phone: "+91 97300 33333", bankAccount: "ICIC-0009012-11122233", address: "88 Siyaganj Market, Indore, Madhya Pradesh" },
  paylink: { owner: "Issuer 2 Technologies Pvt Ltd", phone: "+91 80000 44444", bankAccount: "AXIS-0003456-99988877", address: "21 MG Road, Bengaluru, Karnataka" },
  quick: { owner: "Issuer 3 Owner", phone: "+91 98100 11111", bankAccount: "KOTK-0007890-44455566", address: "3 Nehru Nagar, Indore, Madhya Pradesh" },
};

/** Who an issuer really is: what it told us when it applied (if it did), else the demo record. */
function identityOf(role: RoleId | undefined, address: string): Party | null {
  const base = role ? ISSUER_IDENTITY[role] ?? null : null;
  const app = read().db.applications[address];
  if (!app) return base;
  return { owner: app.ownerName, phone: app.phone, bankAccount: base?.bankAccount ?? "", address: base?.address ?? "" };
}

const WINDOW = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]; // the 6 months of evidence

/** Six months of payments for shop-1. Fixed numbers (no randomness) so the demo is repeatable. */
function buildPayments(): Payment[] {
  const months = WINDOW;
  const purchases = [[22000, 23500], [21500, 24000], [23000, 22500], [22500, 23000], [24000, 21500], [23500, 22000]];
  const settlements = [14500, 15200, 13800, 14900, 15100, 14200];
  const out: Payment[] = [];
  months.forEach((m, i) => {
    out.push({ from: "shop-1", to: "gupta", amountInr: purchases[i][0], date: `${m}-05`, note: "stock purchase" });
    out.push({ from: "shop-1", to: "gupta", amountInr: purchases[i][1], date: `${m}-20`, note: "stock purchase" });
    for (const d of ["07", "14", "21", "28"]) {
      out.push({ from: "paylink", to: "shop-1", amountInr: settlements[i], date: `${m}-${d}`, note: "UPI settlement" });
    }
    // Issuer 3: tiny purchases, and most of it comes straight back (round-trip).
    out.push({ from: "shop-1", to: "quick", amountInr: 5000, date: `${m}-10`, note: "purchase" });
    out.push({ from: "quick", to: "shop-1", amountInr: 4500, date: `${m}-12`, note: "refund" });
  });
  out.push({ from: "gupta", to: "shop-1", amountInr: 2000, date: "2026-08-25", note: "credit note: damaged goods" });
  return out;
}
const PAYMENTS = buildPayments();

/** The payments to judge one issuer's claim by: what the issuer submitted for this shop, else the built-in demo records. */
function paymentsFor(issuer: string, shopId: string, role: RoleId | undefined, kind: IssuerKind) {
  const ev = read().db.evidence[`${issuer}|${shopId}`];
  if (!ev) return { payments: PAYMENTS, key: role ?? "", submitted: false };
  const payments: Payment[] = [];
  WINDOW.forEach((m, i) => {
    const amount = ev.months[i] ?? 0;
    if (amount > 0) payments.push(kind === "PaymentProvider"
      ? { from: issuer, to: shopId, amountInr: amount, date: `${m}-15`, note: "submitted" }
      : { from: shopId, to: issuer, amountInr: amount, date: `${m}-15`, note: "submitted" });
    if (ev.refundPerMonth > 0) payments.push(kind === "PaymentProvider"
      ? { from: shopId, to: issuer, amountInr: ev.refundPerMonth, date: `${m}-20`, note: "refund" }
      : { from: issuer, to: shopId, amountInr: ev.refundPerMonth, date: `${m}-20`, note: "refund" });
  });
  return { payments, key: issuer, submitted: true };
}

export async function getEvidence(issuer: string, shopId: string): Promise<Evidence | null> {
  return read().db.evidence[`${issuer}|${shopId}`] ?? null;
}

/** An issuer submits the monthly payments behind its claim. The checks re-run straight away. */
export async function submitEvidence(issuer: string, shopId: string, months: number[], refundPerMonth: number): Promise<number> {
  await sleep(LATENCY_MS);
  if (!read().issuers[issuer]) throw new ContractError("IssuerNotApproved");
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100_000_000;
  if (months.length !== WINDOW.length || !months.every(ok) || !ok(refundPerMonth)) throw new ApiError("InvalidInput", "Enter 6 monthly amounts of zero or more.");
  mutateDb((db, now) => { db.evidence[`${issuer}|${shopId}`] = { months: months.map(Math.round), refundPerMonth: Math.round(refundPerMonth), submittedAt: now }; });
  return syncChecks(shopId);
}

/** The rules engine tells the contract which claims passed. Only passed claims earn fees. Returns how many changed. */
export async function syncChecks(shopId: string): Promise<number> {
  const results = await getChecks(shopId);
  let changed = 0;
  for (const r of results) {
    const want = r.overall === "verified";
    if (read().credentials[r.credentialId]?.passed !== want) {
      await markChecked(ACCOUNTS.admin.address, r.credentialId, want);
      changed++;
    }
  }
  return changed;
}

// ---------- what the API returns ----------

export interface Evaluated {
  credentialId: number;
  issuer: string; // address
  issuerName: string;
  issuerKind: IssuerKind | null;
  claimType: string;
  summary: string;
  claimedMonthlyInr: number | null;
  onchainStatus: Status;
  checks: CheckResult[]; // checks 2, 3 and 4
  overall: "verified" | "failed" | "unknown";
}

export interface Graph {
  nodes: { id: string; label: string; type: string; state: string }[];
  edges: { id: string; source: string; target: string; label: string; state: string }[];
}

export async function getShops(): Promise<Shop[]> {
  await sleep(LATENCY_MS / 2);
  return Object.values(SHOPS);
}

export async function getShop(id: string): Promise<Shop | null> {
  await sleep(LATENCY_MS / 2);
  return SHOPS[id] ?? null;
}

export async function getChecks(shopId: string): Promise<Evaluated[]> {
  await sleep(LATENCY_MS);
  const views = await getCredentials(shopId);
  const shop = SHOPS[shopId];
  const roleByAddress = Object.fromEntries(Object.values(ACCOUNTS).map((a) => [a.address, a.id]));

  return views.map(({ credential: c, status, issuerName }) => {
    const role = roleByAddress[c.issuer] as RoleId | undefined;
    const kind: IssuerKind = read().issuers[c.issuer]?.kind ?? (role && ACCOUNTS[role].kind) ?? "Supplier";
    const claimed = parseClaimedAmount(c.summary);
    const src = paymentsFor(c.issuer, shopId, role, kind);
    const haveData = !!shop && (src.submitted || (!!role && src.payments.some((p) => p.from === shopId || p.to === shopId) &&
      src.payments.some((p) => [p.from, p.to].includes(role))));
    const { forward, reverse } = splitFlows(src.payments, shopId, src.key, kind);

    const checks = [
      paymentMatch(claimed, forward, MONTHS, haveData),
      independence(shop ?? ({} as Party), identityOf(role, c.issuer)),
      netFlow(claimed, forward, reverse, MONTHS, haveData),
    ];
    const overall = checks.some((x) => x.result === "fail") ? "failed"
      : status === "Valid" && checks.every((x) => x.result === "pass") ? "verified" : "unknown";
    return {
      credentialId: c.id, issuer: c.issuer, issuerName, issuerKind: role ? kind : null,
      claimType: c.claimType, summary: c.summary, claimedMonthlyInr: claimed, onchainStatus: status, checks, overall,
    };
  });
}

/** Trust graph: the shop in the centre, one node per issuer. An issuer takes its worst credential's colour. */
export async function getGraph(shopId: string): Promise<Graph> {
  const results = await getChecks(shopId);
  const shop = SHOPS[shopId];
  const nodes: Graph["nodes"] = [{ id: shopId, label: shop?.name ?? shopId, type: "shop", state: "shop" }];
  const edges: Graph["edges"] = [];
  const rank = { failed: 2, verified: 1, unknown: 0 } as const;
  const byIssuer: Record<string, Graph["nodes"][number]> = {};
  for (const r of results) {
    const node = byIssuer[r.issuer];
    if (!node) {
      byIssuer[r.issuer] = { id: r.issuer, label: r.issuerName, type: r.issuerKind ?? "Unknown", state: r.overall };
      nodes.push(byIssuer[r.issuer]);
    } else if (rank[r.overall] > rank[node.state as keyof typeof rank]) node.state = r.overall;
    edges.push({ id: `cred-${r.credentialId}`, source: r.issuer, target: shopId, label: r.summary, state: r.overall });
  }
  return { nodes, edges };
}

// ---------- the admin's shop review: is this shop genuine, judging by the receipts? ----------

export interface ShopMonth {
  month: string; // "2026-05"
  paid: number; // the flow the claim is about (purchases for a supplier, settlements for a payment provider)
  returned: number; // money that went back within 30 days (round-trips)
  net: number;
}

export interface IssuerReceipts {
  issuer: string;
  issuerName: string;
  kind: IssuerKind | null;
  credentialIds: number[];
  claimedMonthly: number | null; // the biggest monthly amount this issuer claimed
  overall: Evaluated["overall"]; // worst result across its credentials
  months: ShopMonth[];
  avgNet: number;
  flow: string; // what the numbers mean, in words
}

export type ShopVerdict = "looks_genuine" | "needs_review" | "not_enough_evidence";

export interface ShopReview {
  shop: Shop | null;
  verdict: ShopVerdict;
  verdictReason: string;
  checks: ReviewCheck[];
  issuers: IssuerReceipts[];
}

const RATIO_MIN = 0.4; // a kirana's purchases are normally 40%...
const RATIO_MAX = 0.9; // ...to 90% of what it takes in

const daysApart = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const sumOf = (ps: Payment[]) => ps.reduce((t, p) => t + p.amountInr, 0);

/** Everything the admin needs to judge one shop: month-by-month receipts per issuer, shop-level checks, and a verdict. */
export async function getShopReview(shopId: string): Promise<ShopReview> {
  const shop = SHOPS[shopId] ?? null;
  const evaluated = await getChecks(shopId);
  const roleByAddress = Object.fromEntries(Object.values(ACCOUNTS).map((a) => [a.address, a.id])) as Record<string, RoleId>;

  // 1) Group the credentials by issuer and lay out the receipts month by month.
  const issuers: IssuerReceipts[] = [];
  for (const e of evaluated) {
    let row = issuers.find((r) => r.issuer === e.issuer);
    if (!row) {
      const role = roleByAddress[e.issuer];
      const kind = e.issuerKind;
      const src = paymentsFor(e.issuer, shopId, role, kind ?? "Supplier");
      const { forward, reverse } = splitFlows(src.payments, shopId, src.key, kind ?? "Supplier");
      const roundTrips = reverse.filter((r) => forward.some((f) => { const d = daysApart(f.date, r.date); return d >= 0 && d <= 30; }));
      const months = WINDOW.map((m) => {
        const paid = sumOf(forward.filter((p) => p.date.startsWith(m)));
        const returned = sumOf(roundTrips.filter((p) => p.date.startsWith(m)));
        return { month: m, paid, returned, net: paid - returned };
      });
      row = {
        issuer: e.issuer, issuerName: e.issuerName, kind, credentialIds: [], claimedMonthly: null, overall: e.overall, months,
        avgNet: months.reduce((t, m) => t + m.net, 0) / WINDOW.length,
        flow: kind === "PaymentProvider" ? "payments settled to the shop by this payment app" : "the shop's purchases from this supplier",
      };
      issuers.push(row);
    }
    row.credentialIds.push(e.credentialId);
    if (e.claimedMonthlyInr !== null) row.claimedMonthly = Math.max(row.claimedMonthly ?? 0, e.claimedMonthlyInr);
    const rank = { failed: 2, unknown: 1, verified: 0 } as const;
    if (rank[e.overall] > rank[row.overall]) row.overall = e.overall;
  }

  const withData = issuers.filter((r) => r.months.some((m) => m.paid > 0));
  const providers = withData.filter((r) => r.kind === "PaymentProvider");
  const suppliers = withData.filter((r) => r.kind === "Supplier");
  const checks: ReviewCheck[] = [];

  // 2) Shop-level checks.
  checks.push(shop
    ? { id: "on_file", label: "Shop on file", result: "pass", reason: `${shop.name}, ${shop.type.toLowerCase()} in ${shop.address.split(",").slice(-2).join(",").trim()}, trading since ${shop.since}.` }
    : { id: "on_file", label: "Shop on file", result: "unknown", reason: "We have no shop profile or payment records for this shop id." });

  if (!providers.length) {
    checks.push({ id: "coverage", label: "Receipts cover the last 6 months", result: "unknown", reason: "No payment provider has shared the shop's receipts." });
  } else {
    const covered = WINDOW.filter((m) => providers.some((p) => p.months.find((x) => x.month === m)!.paid > 0)).length;
    checks.push({
      id: "coverage", label: "Receipts cover the last 6 months", result: covered === WINDOW.length ? "pass" : "fail",
      reason: covered === WINDOW.length ? "Money came in every month from May to Oct 2026." : `Receipts in only ${covered} of ${WINDOW.length} months: gaps can mean a new or seasonal shop, or a made-up one.`,
    });
  }

  if (!providers.length || !suppliers.length) {
    checks.push({ id: "ratio", label: "Purchases are in line with sales", result: "unknown", reason: "Needs both a supplier and a payment provider to compare." });
  } else {
    const bought = suppliers.reduce((t, r) => t + r.avgNet, 0);
    const earned = providers.reduce((t, r) => t + r.avgNet, 0);
    const ratio = earned ? bought / earned : Infinity;
    const ok = ratio >= RATIO_MIN && ratio <= RATIO_MAX;
    checks.push({
      id: "ratio", label: "Purchases are in line with sales", result: ok ? "pass" : "fail",
      reason: `Purchases ${rs(bought)}/month are ${Number.isFinite(ratio) ? Math.round(ratio * 100) : "∞"}% of receipts ${rs(earned)}/month (a typical shop: ${RATIO_MIN * 100} to ${RATIO_MAX * 100}%).`,
    });
  }

  if (issuers.length < 2) {
    checks.push({ id: "issuers_independent", label: "Issuers are independent of each other", result: "unknown", reason: "Only one issuer: nothing to compare." });
  } else {
    const clash: string[] = [];
    const ids = issuers.map((r) => ({ name: r.issuerName, who: identityOf(roleByAddress[r.issuer], r.issuer) }));
    const dig = (x: string) => x.replace(/\D/g, "").slice(-10);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const x = ids[a].who, y = ids[b].who;
      if (!x || !y) continue;
      if (dig(x.phone) && dig(x.phone) === dig(y.phone)) clash.push(`${ids[a].name} and ${ids[b].name} share a phone number`);
      else if (x.owner.trim().toLowerCase() === y.owner.trim().toLowerCase()) clash.push(`${ids[a].name} and ${ids[b].name} have the same owner`);
    }
    checks.push(clash.length
      ? { id: "issuers_independent", label: "Issuers are independent of each other", result: "fail", reason: `${clash.join("; ")}. They could be vouching for each other's story.` }
      : { id: "issuers_independent", label: "Issuers are independent of each other", result: "pass", reason: `${issuers.length} issuers with different owners and phone numbers.` });
  }

  const failedClaims = issuers.filter((r) => r.overall === "failed");
  const verified = issuers.filter((r) => r.overall === "verified");
  checks.push(!issuers.length
    ? { id: "claims_backed", label: "Every claim is backed by receipts", result: "unknown", reason: "No credentials yet." }
    : failedClaims.length
      ? { id: "claims_backed", label: "Every claim is backed by receipts", result: "fail", reason: `Not backed: ${failedClaims.map((r) => `${r.issuerName} (claims ${r.claimedMonthly ? rs(r.claimedMonthly) : "?"}/month, receipts show ${rs(r.avgNet)})`).join("; ")}. That's evidence against the issuer, not the shop.` }
      : verified.length === issuers.length
        ? { id: "claims_backed", label: "Every claim is backed by receipts", result: "pass", reason: `All ${issuers.length} issuers' claims match the receipts.` }
        : { id: "claims_backed", label: "Every claim is backed by receipts", result: "unknown", reason: "Some claims can't be compared with receipts yet." });

  // 3) The verdict. Claims that failed are ignored (they hurt the ISSUER); the shop is judged on what's left.
  const kinds = new Set(verified.map((r) => r.kind));
  const blocking = checks.filter((c) => ["coverage", "ratio", "issuers_independent"].includes(c.id) && c.result === "fail");
  let verdict: ShopVerdict;
  let verdictReason: string;
  if (!verified.length) {
    verdict = "not_enough_evidence";
    verdictReason = issuers.length ? "No claim is backed by receipts yet. Unknown is not bad: the shop needs an honest issuer." : "No credentials yet. Unknown is not bad.";
  } else if (blocking.length) {
    verdict = "needs_review";
    verdictReason = `Look at: ${blocking.map((c) => c.label.toLowerCase()).join("; ")}.`;
  } else if (verified.length >= 2 && kinds.size >= 2) {
    verdict = "looks_genuine";
    verdictReason = `Backed by ${verified.length} independent issuers (a supplier and a payment provider) whose numbers agree with the receipts.` +
      (failedClaims.length ? ` The claim from ${failedClaims.map((r) => r.issuerName).join(", ")} is ignored because it isn't backed.` : "");
  } else {
    verdict = "needs_review";
    verdictReason = "Only one kind of evidence. Ask for a credential from a different kind of issuer (a supplier AND a payment provider).";
  }
  return { shop, verdict, verdictReason, checks, issuers };
}

// The onboarding endpoints (applications, emailed codes, automatic checks, manual review) live in onboarding.ts
// and are part of the same fake backend:
export * from "./onboarding";
export * from "./loans";
