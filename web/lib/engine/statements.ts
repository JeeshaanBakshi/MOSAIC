import "server-only";
// SUPPLIER PROOF: how a supplier shows it really supplies a shop, and keeps showing it every month.
//
//   supplier : requestSupplierLink -> uploads one bill PDF per month (submitStatement, via POST /api/statement)
//   shop     : confirmSupplierLink | rejectSupplierLink   ("Is this business your supplier?")
//   anyone   : getSupplierProof (seven checks), listStatements, getSupplierLinks
//
// What the checks do: compare each month's billed total with what the payment app saw the shop pay the supplier's VERIFIED
// account (net of money sent back), check the bills name the shop, catch a PDF reused for another month, shop or supplier,
// and ask the shop to confirm. The text INSIDE the PDF is not read (that needs document parsing); the PDF is stored and
// fingerprinted so a person can open it. PROTOTYPE LIMIT: "who is calling" is what the browser sends (no real log-in yet).

import { accountByAddress, nameOf } from "./accounts";
import { SHOPS } from "./data";
import { feedFor, getChecks, verifiedAccountOf } from "./backend";
import { EVIDENCE_CONFIG, EVIDENCE_MONTHS, supplierProof, type ProofResult, type ProofStatement } from "./evidence";
import { monthlyFlows } from "./rules";
import { mutateDb, pushAudit, read, type Statement, type SupplierLink } from "./store";
import { ApiError, ContractError } from "./types";
import { createHash, randomUUID } from "node:crypto";
import { getStorage } from "../server/storage";
import { rs } from "./rules";

const bad = (m: string) => new ApiError("InvalidInput", m);
const linkKey = (issuer: string, shopId: string) => `${issuer}|${shopId}`;

function mustBeSupplierFor(issuer: string, shopId: string) {
  const s = read();
  const rec = s.issuers[issuer];
  if (!rec) throw new ContractError("IssuerNotApproved");
  if (!rec.active) throw new ContractError("IssuerSuspended");
  if (rec.kind !== "Supplier") throw new ApiError("Forbidden", "Only a supplier proves it supplies a shop. A payment app shares payment records instead.");
  if (!SHOPS[shopId]) throw bad(`We have no records for a shop called "${shopId}".`);
  if (!(s.shopCreds[shopId] ?? []).some((id) => s.credentials[id].issuer === issuer)) throw bad("Issue a credential for this shop first. The bills back that claim up.");
}

// ---------- "is this your supplier?" ----------

export async function requestSupplierLink(issuer: string, shopId: string): Promise<void> {
  mustBeSupplierFor(issuer, shopId);
  const old = read().db.supplierLinks[linkKey(issuer, shopId)];
  if (old && old.status !== "rejected") throw new ApiError("AlreadyAnswered", old.status === "confirmed" ? "The shop already confirmed you." : "You already asked. Waiting for the shop.");
  mutateDb((db, now) => {
    db.supplierLinks[linkKey(issuer, shopId)] = { status: "pending", requestedAt: now };
    pushAudit(db, "info", "supplier_link_requested", `${nameOf(issuer)} asked ${SHOPS[shopId].name} to confirm it is its supplier.`);
  });
}

function answerLink(shopId: string, issuer: string, to: "confirmed" | "rejected", reason: string) {
  const link = read().db.supplierLinks[linkKey(issuer, shopId)];
  if (!link) throw new ApiError("NotFound", "This supplier has not asked you to confirm.");
  if (link.status !== "pending") throw new ApiError("AlreadyAnswered", `You already answered (${link.status}). Answers are kept as they are.`);
  const text = String(reason ?? "").trim();
  if (to === "rejected" && text.length < 3) throw bad("Say why (at least a few words). The admin and lenders will read it.");
  mutateDb((db, now) => {
    const x = db.supplierLinks[linkKey(issuer, shopId)];
    x.status = to; x.answeredAt = now; if (to === "rejected") x.reason = text.slice(0, 280);
    pushAudit(db, to === "confirmed" ? "info" : "warn", `supplier_link_${to}`, `${SHOPS[shopId].name} ${to === "confirmed" ? "confirmed" : "denied that"} ${nameOf(issuer)} ${to === "confirmed" ? "as its supplier" : "is its supplier"}${text ? `: ${text}` : ""}.`);
  });
}
/** Only the shop the request names may answer. */
export async function confirmSupplierLink(shopId: string, issuer: string): Promise<void> { answerLink(shopId, issuer, "confirmed", ""); }
export async function rejectSupplierLink(shopId: string, issuer: string, reason: string): Promise<void> { answerLink(shopId, issuer, "rejected", reason); }

export interface SupplierLinkView extends SupplierLink { issuer: string; issuerName: string; shopId: string; shopName: string }
export async function getSupplierLinks(filter: { shopId?: string; issuer?: string } = {}): Promise<SupplierLinkView[]> {
  return Object.entries(read().db.supplierLinks)
    .map(([k, l]) => { const [issuer, shopId] = k.split("|"); return { ...l, issuer, issuerName: nameOf(issuer), shopId, shopName: SHOPS[shopId]?.name ?? shopId }; })
    .filter((l) => (!filter.shopId || l.shopId === filter.shopId) && (!filter.issuer || l.issuer === filter.issuer))
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

// ---------- monthly bills ----------

export interface StatementForm { month: string; billedInr: number; billCount: number; nameOnBill: string; fileName: string }

/** Check the bytes really are a PDF of a sensible size. (The text inside is not read.) */
function checkPdf(bytes: unknown): Buffer {
  if (!(bytes instanceof Uint8Array)) throw bad("Attach the bill as a PDF file.");
  const b = Buffer.from(bytes);
  if (b.length < EVIDENCE_CONFIG.pdfMinBytes) throw bad("That file is too small to be a bill.");
  if (b.length > EVIDENCE_CONFIG.pdfMaxBytes) throw bad(`That file is too big (${Math.round(b.length / 1000)} KB). The limit is ${Math.round(EVIDENCE_CONFIG.pdfMaxBytes / 1000)} KB: send a text PDF, not a photo.`);
  if (b.subarray(0, 5).toString("latin1") !== "%PDF-" || !b.subarray(Math.max(0, b.length - 1024)).toString("latin1").includes("%%EOF")) throw bad("That does not look like a PDF. Export or print the bill as a PDF.");
  return b;
}

/** A supplier uploads one month's bills. A corrected upload for the same month replaces the old one (the old one is kept). */
export async function submitStatement(issuer: string, shopId: string, form: StatementForm, bytes: Uint8Array): Promise<number> {
  mustBeSupplierFor(issuer, shopId);
  const month = String(form.month ?? "");
  if (!(EVIDENCE_MONTHS as readonly string[]).includes(month)) throw bad(`Pick a month from ${EVIDENCE_MONTHS[0]} to ${EVIDENCE_MONTHS[EVIDENCE_MONTHS.length - 1]}.`);
  const billed = Math.round(Number(form.billedInr));
  if (!Number.isFinite(billed) || billed <= 0 || billed > 100_000_000) throw bad("Enter the total the month's bills add up to, above zero.");
  const count = Number(form.billCount);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw bad("Enter how many bills there were (1 or more).");
  const nameOnBill = String(form.nameOnBill ?? "").trim();
  if (nameOnBill.length < 2 || nameOnBill.length > 80) throw bad("Enter the customer name printed on the bills.");
  const file = checkPdf(bytes);
  const fileName = String(form.fileName ?? "bill.pdf").replace(/[^\w.\- ]/g, "_").slice(0, 80) || "bill.pdf";
  const fileHash = createHash("sha256").update(file).digest("hex");
  const fileKey = randomUUID();
  await getStorage().putFile(fileKey, file.toString("base64")); // the file first; the record only once it is safe
  return mutateDb((db, now) => {
    const id = db.nextStatementId++;
    for (const old of Object.values(db.statements)) if (old.issuer === issuer && old.shopId === shopId && old.month === month && !old.supersededBy) old.supersededBy = id;
    db.statements[id] = { id, issuer, shopId, month, billedInr: billed, billCount: count, nameOnBill, fileName, fileSize: file.length, fileHash, fileKey, uploadedAt: now };
    pushAudit(db, "info", "statement_uploaded", `${nameOf(issuer)} uploaded ${month} bills for ${SHOPS[shopId].name}: ${rs(billed)} in ${count} bill${count === 1 ? "" : "s"} (${fileName}).`);
    return id;
  });
}

export interface StatementView extends Statement { issuerName: string; shopName: string; current: boolean; downloadUrl: string }
export async function listStatements(filter: { shopId?: string; issuer?: string } = {}): Promise<StatementView[]> {
  return Object.values(read().db.statements)
    .filter((x) => (!filter.shopId || x.shopId === filter.shopId) && (!filter.issuer || x.issuer === filter.issuer))
    .map((x) => ({ ...x, issuerName: nameOf(x.issuer), shopName: SHOPS[x.shopId]?.name ?? x.shopId, current: !x.supersededBy, downloadUrl: `/api/statement/${x.id}` }))
    .sort((a, b) => a.month.localeCompare(b.month) || b.id - a.id);
}

// ---------- the seven checks ----------

export interface SupplierProofView extends ProofResult { issuer: string; issuerName: string; shopId: string; shopName: string; link: SupplierLinkView | null; statements: StatementView[] }

/** Is this issuer really a supplier of this shop? Seven plain checks, with the numbers. */
export async function getSupplierProof(issuer: string, shopId: string): Promise<SupplierProofView> {
  const s = read();
  const shop = SHOPS[shopId];
  const role = accountByAddress(issuer)?.id;
  const account = role ? verifiedAccountOf(role) : null;
  const { feed } = feedFor(issuer, shopId, "Supplier");
  const flowsList = feed && account ? monthlyFlows(feed, "Supplier", account) : null;
  const flows = flowsList ? Object.fromEntries(EVIDENCE_MONTHS.map((m, i) => [m, flowsList[i]])) : null;

  const all = Object.values(s.db.statements);
  const current = all.filter((x) => x.issuer === issuer && x.shopId === shopId && !x.supersededBy);
  const counts = new Map<string, number>();
  for (const x of all.filter((y) => !y.supersededBy)) counts.set(x.fileHash, (counts.get(x.fileHash) ?? 0) + 1);
  const reused = new Set([...counts].filter(([, n]) => n > 1).map(([h]) => h));

  const ev = (await getChecks(shopId)).find((e) => e.issuer === issuer);
  const independence = ev?.checks.find((c) => c.check === 3)?.result ?? "unknown";
  const link = (await getSupplierLinks({ issuer, shopId }))[0] ?? null;
  const input = {
    shopName: shop?.name ?? shopId, shopOwner: shop?.owner ?? "", link: (link?.status ?? "none") as "none" | "pending" | "confirmed" | "rejected",
    statements: current.map<ProofStatement>((x) => ({ id: x.id, month: x.month, billed: x.billedInr, billCount: x.billCount, nameOnBill: x.nameOnBill, fileHash: x.fileHash })),
    flows, reusedHashes: reused, independence,
  };
  return { ...supplierProof(input), issuer, issuerName: nameOf(issuer), shopId, shopName: input.shopName, link, statements: (await listStatements({ issuer, shopId })) };
}
