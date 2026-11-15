import "server-only";
// REJECTION CASES: what happens after a supplier's claim is rejected.
//
//   1. A case opens by itself: the shop rejected or disputed an invoice (see invoices.ts), or a lender reports wrong
//      information in a claim (flagClaim below).
//   2. The admin gets a case file (a PDF, see /api/case/[id]/pdf) with the reason, the checks, the invoice evidence and the
//      issuer's record, and decides: APPROVE (the rejection stands) or DISMISS (it does not).
//   3. APPROVE: the credential is revoked, its stake is deducted and paid to the lender who rejected it (or to the platform),
//      and the issuer gets a WARNING. The 3rd warning removes the issuer from the system.
//      DISMISS: nothing happens to the issuer.
//
// Honest limit: the deployed contract only slashes a stake after a reported default, and it is not changed here. The stake
// deduction and the removal are done by the website's simulation and are labelled "simulated" in the Activity log.
// PROTOTYPE LIMIT: "who is calling" is what the browser sends; the admin check below is not real log-in security.

import { nameOf } from "./accounts";
import { SHOPS } from "./data";
import { getChecks, syncChecks } from "./backend";
import { applyCasePenalty, getCredentials, suspendIssuer } from "./contract";
import { EVIDENCE_CONFIG, type ReliabilityResult } from "./evidence";
import { getInvoices, getIssuerReliability, type InvoiceView } from "./invoices";
import { getSupplierProof, type SupplierProofView } from "./statements";
import { mutateDb, openCaseInDb, pushAudit, read, type CaseFile } from "./store";
import { ApiError } from "./types";
import { usdc } from "../format";

const bad = (m: string) => new ApiError("InvalidInput", m);

/** A lender who paid to check a shop reports wrong information in one of its credentials. The admin then rules on it. */
export async function flagClaim(lender: string, credentialId: number, reason: string): Promise<number> {
  const s = read();
  const cred = s.credentials[credentialId];
  if (!cred) throw new ApiError("NotFound", "No credential with that id.");
  if (!(s.verifiers[cred.shopId] ?? []).includes(lender)) throw new ApiError("Forbidden", "Only a lender who checked this shop (and paid the fee) can reject its claims.");
  const text = String(reason ?? "").trim();
  if (text.length < 3) throw bad("Say what is wrong with the claim (at least a few words). The admin will read it.");
  if (text.length > 280) throw bad("The reason is too long (280 characters at most).");
  if (Object.values(s.db.cases).some((c) => c.status === "open" && c.credentialId === credentialId && c.raisedBy === lender)) {
    throw new ApiError("AlreadyAnswered", "You already rejected this claim. A case is waiting for the admin.");
  }
  return mutateDb((db, now) => {
    const id = openCaseInDb(db, now, {
      kind: "lender_rejection", credentialId, issuer: cred.issuer, shopId: cred.shopId, raisedByName: nameOf(lender), raisedBy: lender, beneficiary: lender, reason: text,
    });
    pushAudit(db, "warn", "case_opened", `Case #${id}: ${nameOf(lender)} rejected ${nameOf(cred.issuer)}'s claim about ${SHOPS[cred.shopId]?.name ?? cred.shopId}: ${text}`);
    return id;
  });
}

export interface DecisionResult { stakeDeducted: number; warnings: number; removed: boolean }

/** The admin rules on a case. Approve = the rejection stands: stake deducted, issuer warned, the 3rd warning removes it. */
export async function decideCase(admin: string, caseId: number, decision: "approve" | "dismiss", note: string): Promise<DecisionResult> {
  if (admin !== read().config.admin) throw new ApiError("Forbidden", "Only the admin can rule on a case.");
  const c = read().db.cases[caseId];
  if (!c) throw new ApiError("NotFound", "No case with that id.");
  if (c.status !== "open") throw new ApiError("AlreadyAnswered", `This case was already ${c.status}. A ruling is kept as it is, not overwritten.`);
  if (decision !== "approve" && decision !== "dismiss") throw bad("The decision must be approve or dismiss.");
  const text = String(note ?? "").trim();
  if (text.length < 3) throw bad("Write a short note so the ruling can be read later.");
  const approve = decision === "approve";

  let deducted = 0, warnings = read().db.warnings[c.issuer] ?? 0, removed = false;
  if (approve) {
    deducted = (await applyCasePenalty(admin, c.credentialId, c.beneficiary)).result.deducted; // revoke + deduct the stake
    warnings += 1;
    if (warnings >= EVIDENCE_CONFIG.warningLimit) {
      removed = true;
      if (read().issuers[c.issuer]?.active) await suspendIssuer(admin, c.issuer); // out of the system: it can no longer sign credentials
    }
  }
  mutateDb((db, now) => {
    const x = db.cases[caseId];
    x.status = approve ? "approved" : "dismissed";
    x.decision = { at: now, note: text.slice(0, 280), stakeDeducted: deducted, warnings, removed };
    if (approve) db.warnings[c.issuer] = warnings;
    const inv = x.invoiceId ? db.invoices[x.invoiceId] : undefined;
    if (inv && !inv.resolution) { // the invoice carries the ruling too, so the lender's report shows it
      inv.resolution = { upheld: approve, at: now, note: text.slice(0, 280) };
      inv.history.push({ at: now, by: "Admin", action: approve ? "dispute_upheld" : "dispute_dismissed", note: text.slice(0, 280) });
    }
    pushAudit(db, "warn", approve ? "case_approved" : "case_dismissed",
      approve ? `Case #${caseId} approved: ${nameOf(c.issuer)} warned (${warnings} of ${EVIDENCE_CONFIG.warningLimit}), ${usdc(deducted)} stake deducted${removed ? ", removed from the system" : ""}.` : `Case #${caseId} dismissed: no penalty for ${nameOf(c.issuer)}.`);
  });
  await syncChecks(c.shopId);
  return { stakeDeducted: deducted, warnings, removed };
}

// ---------- reading ----------

export interface CaseView {
  file: CaseFile;
  issuerName: string;
  shopName: string;
  claimSummary: string;
  stakeNow: number; // what is still locked behind the credential
  warnings: number; // the issuer's warnings now
  warningLimit: number;
  removesIssuer: boolean; // approving this one would be the last warning
}

/** Cases, open ones first, then newest. */
export async function getCases(filter: { status?: CaseFile["status"]; issuer?: string } = {}): Promise<CaseView[]> {
  const s = read();
  return Object.values(s.db.cases)
    .filter((c) => (!filter.status || c.status === filter.status) && (!filter.issuer || c.issuer === filter.issuer))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.id - a.id)
    .map((c) => {
      const warnings = s.db.warnings[c.issuer] ?? 0;
      return {
        file: c, issuerName: nameOf(c.issuer), shopName: SHOPS[c.shopId]?.name ?? c.shopId, claimSummary: s.credentials[c.credentialId]?.summary ?? "",
        stakeNow: s.credentials[c.credentialId]?.stake ?? 0, warnings, warningLimit: EVIDENCE_CONFIG.warningLimit, removesIssuer: warnings + 1 >= EVIDENCE_CONFIG.warningLimit,
      };
    });
}

export async function getIssuerWarnings(issuer: string): Promise<{ warnings: number; limit: number; removed: boolean }> {
  const s = read();
  const warnings = s.db.warnings[issuer] ?? 0;
  return { warnings, limit: EVIDENCE_CONFIG.warningLimit, removed: warnings >= EVIDENCE_CONFIG.warningLimit };
}

export interface CaseReport {
  view: CaseView;
  credential: { id: number; claimType: string; summary: string; issuedAt: number; expiresAt: number; stake: number; hash: string; status: string };
  checks: { check: number; name: string; result: string; reason: string; numbers: string; source: string }[];
  invoiceBlock: string | null;
  invoices: InvoiceView[]; // every invoice behind this credential; the one the case is about first
  reliability: ReliabilityResult;
  proof: SupplierProofView | null; // the supplier's monthly bills and the seven checks
  ifApproved: string[];
  ifDismissed: string[];
  generatedAt: number;
}

/** Everything the admin needs to decide one case. The PDF is drawn from exactly this. */
export async function getCaseReport(caseId: number): Promise<CaseReport> {
  const view = (await getCases()).find((v) => v.file.id === caseId);
  if (!view) throw new ApiError("NotFound", "No case with that id.");
  const c = view.file;
  const [views, evaluated, invoices, rel] = await Promise.all([getCredentials(c.shopId), getChecks(c.shopId), getInvoices({ credentialId: c.credentialId }), getIssuerReliability(c.issuer)]);
  const proof = read().issuers[c.issuer]?.kind === "Supplier" ? await getSupplierProof(c.issuer, c.shopId) : null;
  const v = views.find((x) => x.credential.id === c.credentialId);
  const ev = evaluated.find((x) => x.credentialId === c.credentialId);
  const cred = v?.credential;
  const ordered = [...invoices].sort((a, b) => Number(b.claim.id === c.invoiceId) - Number(a.claim.id === c.invoiceId) || b.claim.id - a.claim.id);
  const next = view.warnings + 1;
  return {
    view,
    credential: { id: c.credentialId, claimType: cred?.claimType ?? "", summary: cred?.summary ?? "", issuedAt: cred?.issuedAt ?? 0, expiresAt: cred?.expiresAt ?? 0, stake: cred?.stake ?? 0, hash: cred?.claimHash ?? "", status: v?.status ?? "" },
    checks: (ev?.checks ?? []).map((k) => ({ check: k.check, name: k.name, result: k.result, reason: k.reason, numbers: k.numbers, source: k.source })),
    invoiceBlock: ev?.invoiceBlock?.reason ?? null,
    invoices: ordered, reliability: rel, proof, generatedAt: read().now,
    ifApproved: [
      `The rejection stands: ${view.issuerName} gave wrong information.`,
      `The credential is revoked and its ${usdc(view.stakeNow)} stake is deducted and paid to ${c.beneficiary === read().config.admin ? "the platform" : nameOf(c.beneficiary)}.`,
      next >= EVIDENCE_CONFIG.warningLimit ? `${view.issuerName} gets warning ${next} of ${EVIDENCE_CONFIG.warningLimit} and is REMOVED from the system.` : `${view.issuerName} gets warning ${next} of ${EVIDENCE_CONFIG.warningLimit}.`,
    ],
    ifDismissed: [`The rejection does not stand. No penalty and no warning for ${view.issuerName}.`, c.invoiceId ? "The shop's rejection of the invoice no longer holds the credential back." : "The credential stays as it is."],
  };
}

