import "server-only";
// The fake rules-engine backend (checks 2-4 + the trust graph).
// It reads credentials from the fake contract, then compares each claim with PAYMENT-APP records
// (what a payment app shares about the shop). A supplier's own numbers are shown as "Supplier says" and never used.
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
import { netFlow, independence, paymentMatch, parseClaimedAmount, monthlyFlows, type CheckResult, type FeedMonth, type FlowContext, type Party, type PaymentFeed } from "./rules";
import { sleep } from "./util";
import { read, mutateDb, type SupplierSays } from "./store";
import type { ReviewCheck } from "./onboarding";
import { rs } from "./rules";
import { ApiError, ContractError, type IssuerKind, type Status } from "./types";

const LATENCY_MS = 300;

// ---------- fake data ----------

/** Who each issuer really is, and the receiving account it verified at onboarding. Anand Traders shares the shop owner's phone and bank account on purpose. */
const ISSUER_IDENTITY: Partial<Record<RoleId, Party>> = {
  gupta: { owner: "Ramesh Gupta", phone: "+91 97300 33333", bankAccount: "ICIC-0009012-11122233", address: "88 Siyaganj Market, Indore, Madhya Pradesh" },
  paylink: { owner: "PayLink Technologies Pvt Ltd", phone: "+91 80000 44444", bankAccount: "AXIS-0003456-99988877", address: "21 MG Road, Bengaluru, Karnataka" },
  quick: { owner: "Vikram Malhotra", phone: "+91 98100 77777", bankAccount: "KOTK-0007890-44455566", address: "3 Nehru Nagar, Indore, Madhya Pradesh" },
  selfdeal: { owner: "Anand Mehra", phone: "+91 98100 11111", bankAccount: "SBIN-0001234-55501234", address: "9 Market Lane, Indore, Madhya Pradesh" },
};

/** Who an issuer really is: what it told us when it applied (if it did), else the demo record. */
function identityOf(role: RoleId | undefined, address: string): Party | null {
  const base = role ? ISSUER_IDENTITY[role] ?? null : null;
  const app = read().db.applications[address];
  if (!app) return base;
  return { owner: app.ownerName, phone: app.phone, bankAccount: base?.bankAccount ?? "", address: base?.address ?? "" };
}

/** The supplier's VERIFIED receiving account: the one on file from onboarding. Payments are matched against this account only. */
export function verifiedAccountOf(role: RoleId): string | null {
  return ISSUER_IDENTITY[role]?.bankAccount ?? null;
}

const WINDOW = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]; // the 6 months of evidence

const roleOf = (address: string): RoleId | undefined => (Object.values(ACCOUNTS).find((a) => a.address === address)?.id);

/**
 * The payment-app records to judge one claim by.
 *  - A payment app's own claim: its own records for this shop.
 *  - A supplier's claim: the records of a DIFFERENT, approved payment app. Never the supplier's own numbers.
 */
function feedFor(issuer: string, shopId: string, kind: IssuerKind): { feed: PaymentFeed | null; from: string } {
  const feeds = read().db.feeds;
  if (kind === "PaymentProvider") {
    const own = feeds[`${issuer}|${shopId}`];
    return { feed: own ?? null, from: read().issuers[issuer]?.name ?? "this payment app" };
  }
  const key = Object.keys(feeds).sort().find((k) => {
    const [provider, shop] = k.split("|");
    const rec = read().issuers[provider];
    return shop === shopId && rec?.active && rec.kind === "PaymentProvider";
  });
  return key ? { feed: feeds[key], from: read().issuers[key.split("|")[0]].name } : { feed: null, from: "" };
}

export async function getSupplierSays(issuer: string, shopId: string): Promise<SupplierSays | null> {
  return read().db.says[`${issuer}|${shopId}`] ?? null;
}

export async function getPaymentFeed(issuer: string, shopId: string): Promise<(PaymentFeed & { submittedAt: number }) | null> {
  return read().db.feeds[`${issuer}|${shopId}`] ?? null;
}

const okAmount = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100_000_000;

/** A SUPPLIER types what it says it sold. Saved and shown as "Supplier says", but no check uses it. */
export async function submitSupplierSays(issuer: string, shopId: string, months: number[], sentBackPerMonth: number): Promise<number> {
  await sleep(LATENCY_MS);
  if (!read().issuers[issuer]) throw new ContractError("IssuerNotApproved");
  if (!SHOPS[shopId]) throw new ApiError("InvalidInput", `We have no records for a shop called "${shopId}". Try shop-1 or shop-2.`);
  if (months.length !== WINDOW.length || !months.every(okAmount) || !okAmount(sentBackPerMonth)) throw new ApiError("InvalidInput", "Enter 6 monthly amounts of zero or more.");
  if (!months.some((m) => m > 0)) throw new ApiError("InvalidInput", "Enter at least one month's amount. Saving all zeros would overwrite your numbers with nothing.");
  mutateDb((db, now) => { db.says[`${issuer}|${shopId}`] = { months: months.map(Math.round), sentBackPerMonth: Math.round(sentBackPerMonth), submittedAt: now }; });
  return syncChecks(shopId);
}

/**
 * A PAYMENT APP shares its records for a shop, month by month: money in (receipts), money paid out per payee account,
 * and money that came back in from each payee. These are the numbers checks 2 and 4 use.
 * CONNECT: in production this is a consented data feed from the payment app, not a form.
 */
export async function submitPaymentFeed(issuer: string, shopId: string, months: FeedMonth[]): Promise<number> {
  await sleep(LATENCY_MS);
  const record = read().issuers[issuer];
  if (!record) throw new ContractError("IssuerNotApproved");
  if (record.kind !== "PaymentProvider") throw new ApiError("Forbidden", "Only a payment app can share payment records. Suppliers can only say what they sold.");
  if (!SHOPS[shopId]) throw new ApiError("InvalidInput", `We have no records for a shop called "${shopId}".`);
  const bad = () => new ApiError("InvalidInput", "Enter 6 months. Each has receipts and, per payee account, what was paid out and what came back (all zero or more).");
  if (!Array.isArray(months) || months.length !== WINDOW.length) throw bad();
  const clean: FeedMonth[] = months.map((m) => {
    if (!m || !okAmount(m.receipts) || typeof m.payees !== "object" || m.payees === null) throw bad();
    const payees: FeedMonth["payees"] = {};
    for (const [account, v] of Object.entries(m.payees).slice(0, 20)) {
      if (!account.trim() || account.length > 40 || !v || !okAmount(v.out) || !okAmount(v.back)) throw bad();
      payees[account.trim()] = { out: Math.round(v.out), back: Math.round(v.back) };
    }
    return { receipts: Math.round(m.receipts), payees };
  });
  if (!clean.some((m) => m.receipts > 0 || Object.values(m.payees).some((p) => p.out > 0))) throw new ApiError("InvalidInput", "Enter at least one amount. Saving all zeros would overwrite the records with nothing.");
  mutateDb((db, now) => { db.feeds[`${issuer}|${shopId}`] = { months: clean, submittedAt: now }; });
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
  /** What the supplier typed. Shown beside the checks as "Supplier says", never used by them. */
  supplierSays: { avgPurchases: number; sentBackPerMonth: number } | null;
  verifiedAccount: string | null; // the receiving account payments were matched against
  dataFrom: string; // which payment app's records the checks used ("" if none)
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

  return views.map(({ credential: c, status, issuerName }) => {
    const role = roleOf(c.issuer);
    const kind: IssuerKind = read().issuers[c.issuer]?.kind ?? (role && ACCOUNTS[role].kind) ?? "Supplier";
    const claimed = parseClaimedAmount(c.summary);
    const account = kind === "Supplier" && role ? verifiedAccountOf(role) : null;
    const { feed, from } = feedFor(c.issuer, shopId, kind);
    const ctx: FlowContext = { claimed, kind, account, feed: shop ? feed : null, feedFrom: from };

    const checks = [paymentMatch(ctx), independence(shop ?? null, identityOf(role, c.issuer)), netFlow(ctx)];
    const overall = checks.some((x) => x.result === "fail") ? "failed"
      : status === "Valid" && checks.every((x) => x.result === "pass") ? "verified" : "unknown";
    const says = read().db.says[`${c.issuer}|${shopId}`];
    return {
      credentialId: c.id, issuer: c.issuer, issuerName, issuerKind: role ? kind : null,
      claimType: c.claimType, summary: c.summary, claimedMonthlyInr: claimed, onchainStatus: status, checks, overall,
      supplierSays: says ? { avgPurchases: says.months.reduce((t, n) => t + n, 0) / says.months.length, sentBackPerMonth: says.sentBackPerMonth } : null,
      verifiedAccount: account, dataFrom: feed ? from : "",
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
  failedWhy: string | null; // why a failed claim was not counted (the first failed check)
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
      const kind = e.issuerKind ?? "Supplier";
      const { feed } = feedFor(e.issuer, shopId, kind);
      const flows = feed ? monthlyFlows(feed, kind, e.verifiedAccount) : null;
      const months = WINDOW.map((m, i) => ({ month: m, paid: flows?.[i].paid ?? 0, returned: flows?.[i].returned ?? 0, net: flows?.[i].net ?? 0 }));
      row = {
        issuer: e.issuer, issuerName: e.issuerName, kind, credentialIds: [], claimedMonthly: null, overall: e.overall, months,
        failedWhy: null,
        avgNet: months.reduce((t, m) => t + m.net, 0) / WINDOW.length,
        flow: kind === "PaymentProvider" ? "money in to the shop, as recorded by this payment app" : "what the shop paid this supplier's verified account, per a payment app",
      };
      issuers.push(row);
    }
    row.credentialIds.push(e.credentialId);
    if (e.claimedMonthlyInr !== null) row.claimedMonthly = Math.max(row.claimedMonthly ?? 0, e.claimedMonthlyInr);
    const rank = { failed: 2, unknown: 1, verified: 0 } as const;
    if (rank[e.overall] > rank[row.overall]) row.overall = e.overall;
    if (e.overall === "failed" && !row.failedWhy) {
      const f = e.checks.find((c) => c.result === "fail")!;
      row.failedWhy = `${{ 2: "payment match", 3: "independence", 4: "net flow" }[f.check]} failed. ${f.reason}`;
    }
  }

  const withData = issuers.filter((r) => r.months.some((m) => m.paid > 0));
  const providers = withData.filter((r) => r.kind === "PaymentProvider" && r.overall === "verified");
  const suppliers = withData.filter((r) => r.kind === "Supplier" && r.overall === "verified"); // claims that failed a check are not counted
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
