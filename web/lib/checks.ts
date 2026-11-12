// Builds the "six fraud checks" view for each credential by combining
//   - what the CONTRACT knows:  check 1 (registry), check 5 (stake)   [check 6 is per shop, see the lender page]
//   - what the BACKEND knows:   checks 2, 3, 4 (payment match, independence, net flow)
// Pages call this one function and never care which side each check came from.

import { backend, contract, type CredentialView, type Issuer, type Result } from "./mock";
import { usdc } from "./format";

export interface CheckRow {
  check: number;
  label: string;
  result: Result;
  reason: string;
  source: "contract" | "rules engine";
}

export interface EvidenceItem {
  view: CredentialView;
  issuer: Issuer | null;
  rows: CheckRow[]; // checks 1-5 in order
  overall: "verified" | "failed" | "unknown";
}

export const CHECK_LABELS: Record<number, string> = {
  1: "Issuer registry",
  2: "Payment match (at least 70%)",
  3: "Independence",
  4: "Net flow (round-trips removed)",
  5: "Stake at risk",
  6: "Stacking counter",
};

export async function loadEvidence(shopId: string): Promise<EvidenceItem[]> {
  const [views, evaluated] = await Promise.all([
    contract.getCredentials(shopId),
    backend.getChecks(shopId).catch(() => null), // if the backend is down, checks 2-4 become "unknown"
  ]);
  const issuers = await Promise.all(views.map((v) => contract.getIssuer(v.credential.issuer)));

  return views.map((view, i) => {
    const issuer = issuers[i];
    const cred = view.credential;
    const ev = evaluated?.find((e) => e.credentialId === cred.id);

    const check1: CheckRow = {
      check: 1, label: CHECK_LABELS[1], source: "contract",
      result: issuer?.active ? "pass" : "fail",
      reason: !issuer ? "Not in the issuer registry."
        : issuer.active ? `Approved ${issuer.kind === "PaymentProvider" ? "payment provider" : "supplier"}, ${issuer.upheldClaims} upheld dispute(s).`
        : `Suspended after ${issuer.upheldClaims} upheld disputes.`,
    };
    const check5: CheckRow = {
      check: 5, label: CHECK_LABELS[5], source: "contract",
      result: cred.stake > 0 ? "pass" : "unknown",
      reason: cred.stake > 0 ? `${usdc(cred.stake)} locked behind this claim. It goes to the lender if the claim is proven false.`
        : "No stake left (returned after expiry, or already slashed).",
    };
    const middle: CheckRow[] = ev
      ? ev.checks.map((c) => ({ check: c.check, label: CHECK_LABELS[c.check], result: c.result, reason: c.reason, source: "rules engine" as const }))
      : [2, 3, 4].map((n) => ({ check: n, label: CHECK_LABELS[n], result: "unknown" as const, reason: "Rules engine unavailable.", source: "rules engine" as const }));

    const rows = [check1, ...middle, check5];
    const overall = rows.some((r) => r.result === "fail") ? "failed" : ev?.overall ?? "unknown";
    return { view, issuer, rows, overall };
  });
}
