"use client";
// ADMIN: is this shop genuine, judging by the receipts?
// For each issuer that vouched for the shop, it shows the payments behind the claim month by month
// (what was paid, what came straight back within 30 days, and the net), then shop-level checks and a verdict.
// Data: backend.getShopReview(shopId). CONNECT: GET /shops/{id}/review on your backend.
import { useState } from "react";
import { backend, contract, rs, type IssuerReceipts, type ShopVerdict } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { Badge, Section } from "./ui";
import { CheckList } from "./CheckList";

const VERDICT: Record<ShopVerdict, { state: string; label: string }> = {
  looks_genuine: { state: "pass", label: "Looks genuine" },
  needs_review: { state: "open", label: "Needs review" },
  not_enough_evidence: { state: "unknown", label: "Not enough evidence, which is not bad" },
};

const MONTH = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });

export function ShopReviewPanel() {
  const shops = useQuery(async () => {
    const known = (await backend.getShops()).map((s) => ({ id: s.id, name: s.name }));
    const extra = (await contract.listShopsWithCredentials()).filter((id) => !known.some((k) => k.id === id));
    return [...known, ...extra.map((id) => ({ id, name: id }))];
  });
  const [picked, setPicked] = useState("shop-1");
  const review = useQuery(() => backend.getShopReview(picked), [picked]);
  const r = review.data;

  return (
    <Section id="shops" title="Shop checks" aside="Is the shop genuine, judging by its receipts?">
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-quiet">
        Every claim is compared with the shop&apos;s real payment records. The shop is judged only on claims the receipts back up.
        A claim that isn&apos;t backed counts against the issuer, not the shop.
      </p>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Shop">
        {(shops.data ?? []).map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === picked} onClick={() => setPicked(s.id)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${s.id === picked ? "border-pine text-ink" : "border-transparent text-quiet hover:text-ink"}`}>
            {s.name}
          </button>
        ))}
      </div>

      {!r ? (
        <p className="text-sm text-quiet">{review.error ? `Could not load: ${review.error.message}` : "Checking the receipts…"}</p>
      ) : (
        <div className="space-y-10">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-light tracking-tight">{r.shop?.name ?? picked}</h3>
              <Badge state={VERDICT[r.verdict].state}>{VERDICT[r.verdict].label}</Badge>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed">{r.verdictReason}</p>
            <CheckList rows={r.checks.map((c) => ({ label: c.label, result: c.result, reason: c.reason, source: "from receipts" }))} />
          </div>
          {r.issuers.map((i) => <IssuerReceiptsBlock key={i.issuer} row={i} />)}
        </div>
      )}
    </Section>
  );
}

function IssuerReceiptsBlock({ row }: { row: IssuerReceipts }) {
  const pct = row.claimedMonthly ? Math.round((100 * row.avgNet) / row.claimedMonthly) : null;
  return (
    <article className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h4 className="font-medium">{row.issuerName}</h4>
        <span className="text-sm text-quiet">{row.kind === "PaymentProvider" ? "Payment app" : row.kind === "Supplier" ? "Supplier" : "Unknown issuer"}, credential {row.credentialIds.join(", ")}</span>
        <Badge state={row.overall} />
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-quiet">
        Claims {row.claimedMonthly ? `${rs(row.claimedMonthly)} a month` : "no amount"}. The receipts show {row.flow} averaging{" "}
        <span className="font-medium text-ink">{rs(row.avgNet)} a month</span> after money that came straight back{pct !== null && <> ({pct}% of the claim; at least 70% is needed)</>}.
      </p>
      {row.months.every((m) => m.paid === 0) ? (
        <p className="text-sm text-quiet">No payment records for this issuer and shop. Unknown, not bad.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm tabular-nums">
            <thead className="text-left text-quiet">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-4 font-medium">Month</th>
                <th scope="col" className="pr-4 text-right font-medium">Paid</th>
                <th scope="col" className="pr-4 text-right font-medium">Came back within 30 days</th>
                <th scope="col" className="text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {row.months.map((m) => (
                <tr key={m.month}>
                  <td className="py-2 pr-4">{MONTH(m.month)}</td>
                  <td className="pr-4 text-right">{rs(m.paid)}</td>
                  <td className={`pr-4 text-right ${m.returned ? "text-clay" : "text-faint"}`}>{m.returned ? `minus ${rs(m.returned)}` : "none"}</td>
                  <td className="text-right font-medium">{rs(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
