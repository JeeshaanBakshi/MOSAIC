"use client";
// SHOP PROFILE: what the world knows about one shop. Read-only.
// Reads used: contract get_credentials, checks_last_30_days; backend GET /shops/{id}, /checks, /graph.
import Link from "next/link";
import { backend, contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { loadEvidence } from "@/lib/checks";
import { formatDate } from "@/lib/format";
import { TrustGraph, GraphLegend } from "@/components/TrustGraph";
import { Badge, PageTitle, Rows, Section, Skeleton, Stat } from "@/components/ui";

export function ShopView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const shop = useQuery(() => backend.getShop(id), [id]);
  const graph = useQuery(() => backend.getGraph(id), [id]);
  const evidence = useQuery(() => loadEvidence(id), [id]);
  const checks30 = useQuery(() => contract.checksLast30Days(id), [id]);

  const items = evidence.data ?? [];
  const verified = items.filter((e) => e.overall === "verified").length;

  return (
    <div className={embedded ? "space-y-8 rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8" : "space-y-12"}>
      {embedded ? (
        <div>
          <p className="text-sm font-medium text-pine">Your public profile: this is what a lender sees</p>
          <h2 className="mt-1 text-2xl font-medium tracking-tight">{shop.data?.name ?? id}</h2>
          {shop.data && <p className="mt-1 text-sm text-quiet">{shop.data.type}. {shop.data.address}. Trading since {shop.data.since}.</p>}
        </div>
      ) : (
        <>
          <PageTitle title={shop.data?.name ?? id}>
            {shop.data ? `${shop.data.type}, ${shop.data.address}. Since ${shop.data.since}.` : ""}
          </PageTitle>
          <div className="flex flex-wrap gap-2 text-sm" aria-label="Shops">
            {["shop-1", "shop-2", "shop-3"].map((s) => (
              <Link key={s} href={`/shop/${s}`} aria-current={s === id ? "page" : undefined}
                className={`rounded-full px-4 py-2 font-medium ${s === id ? "bg-pine text-white" : "border border-line text-quiet hover:bg-wash hover:text-ink"}`}>{s}</Link>
            ))}
          </div>
        </>
      )}

      <dl className="grid gap-8 sm:grid-cols-3">
        <Stat label="Credentials on record" value={evidence.loading ? <Skeleton /> : String(items.length)} />
        <Stat label="Verified by every check" value={evidence.loading ? <Skeleton /> : `${verified} of ${items.length}`} />
        <Stat label="Lender checks in the last 30 days" value={checks30.data === undefined ? <Skeleton /> : String(checks30.data)} hint="Stacking counter" />
      </dl>

      <Section title="Trust graph">
        {graph.data && graph.data.nodes.length > 1 ? (
          <TrustGraph graph={graph.data} />
        ) : (
          <p className="text-sm text-quiet">{graph.loading ? <Skeleton className="h-5 w-48" /> : "No credentials yet. Unknown, not bad."}</p>
        )}
        <div className="mt-4"><GraphLegend /></div>
        {items.some((e) => e.overall === "failed") && (
          <div className="mt-6 space-y-2" data-not-counted>
            <h3 className="text-sm font-medium">Not counted</h3>
            <ul className="space-y-1 text-sm text-quiet">
              {items.filter((e) => e.overall === "failed").map((e) => {
                const f = e.rows.find((r) => r.result === "fail" && r.check !== 6);
                return <li key={e.view.credential.id}><span className="font-medium text-ink">{e.view.issuerName}:</span> {f?.reason ?? "did not pass the checks."}</li>;
              })}
            </ul>
          </div>
        )}
      </Section>

      {items.length > 0 && (
        <Section title="What issuers say">
          <Rows>
            {items.map((e) => (
              <div key={e.view.credential.id} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-medium">{e.view.issuerName}</span>
                    <Badge state={e.view.status === "Valid" ? e.overall : e.view.status} />
                  </div>
                  <p className="mt-1 text-sm text-quiet">&ldquo;{e.view.credential.summary}&rdquo;</p>
                </div>
                <p className="text-sm text-quiet">Credential {e.view.credential.id}, expires {formatDate(e.view.credential.expiresAt)}</p>
              </div>
            ))}
          </Rows>
        </Section>
      )}

      {!embedded && (
        <p className="text-sm text-quiet">
          Lenders see every check and the reasons on the <Link className="font-medium text-pine underline underline-offset-4" href={`/lender?shop=${id}`}>Lender page</Link>.
        </p>
      )}
    </div>
  );
}
