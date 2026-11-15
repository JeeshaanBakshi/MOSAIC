"use client";
// LENDER: the verification report for one shop. For every credential it answers, in order:
//   Was the issuer verified?  Did the business confirm?  Do invoice and payment match?  Is anything disputed?
//   Is the evidence recent?   Does the issuer have a worrying history?
// Every line says what was checked, what was found, why it matters, what is missing and what to do. Missing is not fraud.
// Backend used: getVerificationReport.
import { CircleCheck, CircleDashed, CircleX, ChevronDown } from "lucide-react";
import { backend, rs, type MatchLine, type ReportCredential } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Badge, Notice, QueryError, Skeleton } from "@/components/ui";
import { ProofBadge, ProofLines, ProofMonths } from "@/components/ProofBits";
import { ClaimBadge, FreshnessBadge, MatchBadge, OFFCHAIN_NOTE, ReliabilityBadge, TrustBadge, moneyLine } from "@/components/EvidenceBits";

const LINE_ICON = { pass: { Icon: CircleCheck, cls: "text-pine", word: "Passed" }, fail: { Icon: CircleX, cls: "text-clay", word: "Failed" }, unknown: { Icon: CircleDashed, cls: "text-faint", word: "Missing" } } as const;

/** One of the five questions a lender asks, as a labelled stamp. */
function Chip({ label, state, children }: { label: string; state: string; children: string }) {
  return <span className="inline-flex items-center gap-2 text-xs text-quiet"><span>{label}</span><Badge state={state}>{children}</Badge></span>;
}

export function VerificationReport({ shopId }: { shopId: string }) {
  const report = useQuery(() => backend.getVerificationReport(shopId), [shopId]);
  if (report.error) return <QueryError what="the verification report" onRetry={report.retry} />;
  if (!report.data) return <Skeleton className="block h-40 w-full" />;
  const creds = report.data.credentials;
  return (
    <section className="space-y-6" aria-label="Verification report" data-report={shopId}>
      <div>
        <h3 className="text-lg font-medium tracking-tight">Verification report</h3>
        <p className="mt-1 max-w-2xl text-sm text-quiet">A signature shows who made a claim. It does not show the claim is true. This report looks at the evidence behind each credential: the business&apos;s answer, the invoice against the payments, how old it is, and the issuer&apos;s history.</p>
      </div>
      {creds.length === 0 && <p className="text-sm text-quiet">No credentials for this shop yet. That is unknown, not bad.</p>}
      {creds.map((c) => <CredentialReport key={c.credentialId} c={c} />)}
      <Notice>
        <b className="font-medium">On Stellar:</b> {report.data.provenance.onChain.join(" ")}<br />
        <b className="font-medium">Not on Stellar:</b> {report.data.provenance.offChain.join(" ")}
      </Notice>
    </section>
  );
}

function CredentialReport({ c }: { c: ReportCredential }) {
  const conf = { confirmed: ["pass", "Confirmed"], pending: ["open", "Pending"], rejected: ["fail", "Rejected"], disputed: ["fail", "Disputed"], none: ["unknown", "No invoice yet"] }[c.confirmation];
  const match = { matched: ["pass", "Matched"], partial: ["open", "Partly matched"], review: ["fail", "Needs review"], none: ["unknown", "No evidence yet"] }[c.invoiceMatch];
  const issuer = { yes: ["pass", "Verified"], no: ["fail", "Did not pass"], unknown: ["unknown", "Not enough evidence"] }[c.issuerVerified];
  return (
    <article className="space-y-5 rounded-(--radius-panel) border border-line bg-surface p-6" data-trust={c.trust}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h4 className="text-base font-medium">{c.issuerName}</h4>
        <TrustBadge trust={c.trust} />
        <ReliabilityBadge category={c.reliability.category} />
        <span className="flex items-center gap-2 text-xs text-quiet">
          <FreshnessBadge status={c.freshness.status} />
          {c.freshness.daysSinceVerified === 0 ? "today" : `${c.freshness.daysSinceVerified} days since last evidence`}
        </span>
      </div>
      <p className="text-sm text-quiet">&ldquo;{c.summary}&rdquo; Credential #{c.credentialId}, on-chain status {c.onchainStatus.toLowerCase()}.</p>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Chip label="Issuer verified" state={issuer[0]}>{issuer[1]}</Chip>
        <Chip label="Business confirmed" state={conf[0]}>{conf[1]}</Chip>
        <Chip label="Invoice and payment" state={match[0]}>{match[1]}</Chip>
        <Chip label="Evidence disputed" state={c.disputed ? "fail" : "pass"}>{c.disputed ? "Yes" : "No"}</Chip>
        {c.proof && <span className="inline-flex items-center gap-2 text-xs text-quiet">Supplier proof <ProofBadge status={c.proof.status} /></span>}
      </div>

      <ul className="space-y-1 text-sm leading-relaxed text-quiet">{c.trustReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>

      {c.invoices.length > 0 && (
        <div className="divide-y divide-line border-y border-line">
          {c.invoices.map((v) => {
            const ref = v.match.lines.find((l) => l.id === "reference"), amt = v.match.lines.find((l) => l.id === "amount");
            return (
              <div key={v.claim.id} className="space-y-3 py-4" data-invoice={v.claim.ref}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm font-medium">{v.claim.ref}: {rs(v.claim.amountInr)}, {formatDate(v.claim.invoiceDate)}</span>
                  <ClaimBadge state={v.state} /><MatchBadge status={v.match.status} /><TrustBadge trust={v.trust} />
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Chip label="Invoice matched" state={ref?.result === "pass" ? "pass" : "unknown"}>{ref?.result === "pass" ? "Reference found" : "No reference found"}</Chip>
                  <Chip label="Payment matched" state={amt?.result === "pass" ? "pass" : amt?.result === "fail" ? "fail" : "unknown"}>{amt?.result === "pass" ? "Amount covered" : amt?.result === "fail" ? "Not covered" : "No payment yet"}</Chip>
                </div>
                <p className="text-sm text-quiet">{moneyLine(v.match, rs)}.</p>
                {v.claim.reason && <p className="text-sm text-quiet">The business said: &ldquo;{v.claim.reason}&rdquo;</p>}
                <details className="group">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
                    <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />Why it was judged this way
                  </summary>
                  <EvidenceLines lines={v.match.lines} />
                  <p className="mt-3 text-xs text-quiet">Evidence: {v.claim.evidenceRef || "none given"}. Fingerprint {v.claim.hash.slice(0, 12)}… Checked {formatDate(v.match.verifiedAt)}. {OFFCHAIN_NOTE}</p>
                </details>
              </div>
            );
          })}
        </div>
      )}

      {c.proof && (
        <details className="group" open={c.proof.status === "flagged"} data-proof={c.issuerName}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
            <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />Is {c.issuerName} really this shop&apos;s supplier? ({c.proof.lines.filter((l) => l.result === "pass").length} of {c.proof.lines.length} checks passed)
          </summary>
          <div className="mt-2 space-y-4">
            <ProofMonths months={c.proof.months} statements={c.proof.statements} />
            <ProofLines lines={c.proof.lines} />
            <p className="text-xs text-quiet">The bill PDFs are stored for a person to open. Their text is not read yet; the totals typed in are checked against the payment records. Off-chain.</p>
          </div>
        </details>
      )}

      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />Issuer history ({c.reliability.metrics.credentialsIssued} credentials)
        </summary>
        <p className="mt-2 text-sm text-quiet">{c.reliability.reasons.join(" ")} {c.issuerVerifiedWhy}</p>
        <p className="mt-1 text-xs text-quiet">{c.reliability.metrics.confirmed} confirmed · {c.reliability.metrics.rejected} rejected · {c.reliability.metrics.disputed} disputed · {c.reliability.metrics.upheldOnChain + c.reliability.metrics.upheldInvoice} upheld · {c.reliability.metrics.duplicates} duplicates · {c.reliability.metrics.revoked} revoked</p>
      </details>
    </article>
  );
}

function EvidenceLines({ lines }: { lines: MatchLine[] }) {
  return (
    <ul className="mt-2 divide-y divide-line border-y border-line">
      {lines.map((l) => {
        const { Icon, cls, word } = LINE_ICON[l.result];
        return (
          <li key={l.id} className="flex gap-4 py-3">
            <Icon className={`mt-1 size-[18px] shrink-0 ${cls}`} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <span className="font-medium"><span className="sr-only">{word}: </span>{l.label}</span>
              <p className="text-quiet"><b className="font-medium text-ink">Found:</b> {l.found}</p>
              <p className="text-quiet"><b className="font-medium text-ink">Why it matters:</b> {l.why}</p>
              {l.missing && <p className="text-quiet"><b className="font-medium text-ink">Missing:</b> {l.missing}</p>}
              {l.action && <p className="text-quiet"><b className="font-medium text-ink">What to do:</b> {l.action}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
