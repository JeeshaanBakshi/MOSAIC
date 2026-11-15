"use client";
// ADMIN: issuer reliability (the numbers and the reasons, not a score) and the evidence that needs a person:
// flagged invoice claims and business disputes waiting for a ruling.
// Backend used: listIssuerReliability, getEvidenceAttention. Real numbers only: nothing invented. Rulings are made in Rejection cases.
import { backend, rs } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Rows, Section, Skeleton } from "@/components/ui";
import { ClaimBadge, MatchBadge, ReliabilityBadge, TrustBadge, moneyLine } from "@/components/EvidenceBits";

export function EvidenceAdmin() {
  const rel = useQuery(() => backend.listIssuerReliability());
  const attention = useQuery(() => backend.getEvidenceAttention());
  return (
    <>
      <Section id="reliability" title="Issuer reliability" aside="Numbers and reasons, not a score">
        {!rel.data ? <Skeleton className="block h-24 w-full" /> : (
          <div className="relative overflow-x-auto">
            <table className="dtable min-w-[48rem]">
              <thead><tr><th>Issuer</th><th>Category</th><th className="text-right">Credentials</th><th className="text-right">Confirmed</th><th className="text-right">Rejected</th><th className="text-right">Disputed</th><th className="text-right">Upheld</th><th className="text-right">Duplicates</th><th className="text-right">Warnings</th></tr></thead>
              <tbody>
                {rel.data.map((r) => (
                  <tr key={r.address}>
                    <td><div className="font-medium">{r.name}</div><div className="max-w-xs text-xs text-faint">{r.reasons.join(" ")}</div></td>
                    <td><ReliabilityBadge category={r.category} /></td>
                    <td className="t-num text-right">{r.metrics.credentialsIssued}</td>
                    <td className="t-num text-right">{r.metrics.confirmed}</td>
                    <td className="t-num text-right">{r.metrics.rejected}</td>
                    <td className="t-num text-right">{r.metrics.disputed}</td>
                    <td className="t-num text-right">{r.metrics.upheldOnChain + r.metrics.upheldInvoice}</td>
                    <td className="t-num text-right">{r.metrics.duplicates}</td>
                    <td className="t-num text-right">{r.metrics.warnings} of 3</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-quiet">Fewer than 5 credentials and answered claims is &ldquo;Limited history&rdquo;: no disputes yet proves little. Two upheld disputes, or a suspension, is &ldquo;Restricted&rdquo;. Use the registry above to suspend an issuer.</p>
      </Section>

      <Section id="evidence" title={`Evidence needing a person (${(attention.data ?? []).length})`} aside="Flagged invoices and business disputes">
        {!attention.data ? <Skeleton className="block h-24 w-full" /> : attention.data.length === 0 ? <p className="text-sm text-quiet">Nothing is flagged.</p> : (
          <Rows>
            {attention.data.map((v) => (
              <div key={v.claim.id} className="space-y-3 py-5" data-flagged={v.claim.ref}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-medium">{v.issuerName}: {v.claim.ref}, {rs(v.claim.amountInr)} for {v.shopName}</span>
                  <ClaimBadge state={v.state} /><MatchBadge status={v.match.status} /><TrustBadge trust={v.trust} />
                </div>
                <p className="text-sm text-quiet">{v.trustReasons.join(" ")} {moneyLine(v.match, rs)}. Submitted {formatDate(v.claim.createdAt)}.</p>
                {v.claim.status === "disputed" && !v.claim.resolution && <p className="text-sm text-quiet">A case is open for this: decide it under Rejection cases above.</p>}
              </div>
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}
