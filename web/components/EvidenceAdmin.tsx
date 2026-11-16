"use client";
// ADMIN: invoice claims that need a person (flagged, or disputed). Rulings are made under Cases.
import { backend, rs } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { Skeleton } from "@/components/ui";
import { ClaimBadge, MatchBadge, TrustBadge, moneyLine } from "@/components/EvidenceBits";

export function EvidenceAttention() {
  const attention = useQuery(() => backend.getEvidenceAttention());
  if (!attention.data) return <Skeleton className="block h-24 w-full" />;
  if (attention.data.length === 0) return <p className="text-sm text-quiet">Nothing is flagged.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2" id="evidence">
      {attention.data.map((v) => (
        <article key={v.claim.id} className="space-y-2 rounded-(--radius-panel) border border-line bg-surface p-5" data-flagged={v.claim.ref}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{v.issuerName}: {v.claim.ref}</span>
            <ClaimBadge state={v.state} /><MatchBadge status={v.match.status} /><TrustBadge trust={v.trust} />
          </div>
          <p className="text-sm text-quiet">{v.shopName} · {moneyLine(v.match, rs)}</p>
          <p className="text-sm text-quiet">{v.trustReasons[0]}</p>
        </article>
      ))}
    </div>
  );
}
