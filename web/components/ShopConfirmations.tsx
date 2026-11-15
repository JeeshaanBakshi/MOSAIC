"use client";
// SHOPKEEPER: "Pending transaction confirmations". A supplier says "I sold this shop goods worth Rs X". The shop answers:
// confirm, reject or dispute (with a reason). This is the second signature: a supplier's claim is only as strong as the shop's word.
// Backend used: getInvoices, getVerificationReport (for freshness), confirmInvoice, rejectInvoice, disputeInvoice.
import { useState } from "react";
import { backend, rs, type InvoiceView } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Button, Notice, Rows, Section, Skeleton, inputClass } from "@/components/ui";
import { ClaimBadge, FreshnessBadge, MatchBadge, OFFCHAIN_NOTE, TrustBadge, moneyLine } from "@/components/EvidenceBits";
import { errorToast } from "@/components/toast";
import { toast } from "sonner";

export function ShopConfirmations({ shopId }: { shopId: string }) {
  const invoices = useQuery(() => backend.getInvoices({ shopId }), [shopId]);
  const report = useQuery(() => backend.getVerificationReport(shopId), [shopId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: number; to: "reject" | "dispute" } | null>(null);
  const [reason, setReason] = useState("");

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key);
    try { await f(); toast.success(done); setAsking(null); setReason(""); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const all = (invoices.data ?? []).filter((v) => !v.claim.cancelled);
  const pending = all.filter((v) => v.state === "pending");
  const history = all.filter((v) => v.state !== "pending");

  return (
    <Section title={`Pending transaction confirmations (${pending.length})`} aside="A supplier's claim counts for more once you confirm it.">
      {invoices.loading && <Skeleton className="block h-24 w-full" />}
      {!invoices.loading && all.length === 0 && <p className="text-sm text-quiet">No supplier has submitted an invoice about your shop yet.</p>}

      <Rows>
        {pending.map((v) => (
          <div key={v.claim.id} className="space-y-4 py-5" data-invoice={v.claim.ref}>
            <Details v={v} />
            {asking?.id === v.claim.id ? (
              <div className="space-y-3 rounded-(--radius-control) bg-wash p-4">
                <label className="block text-sm font-medium">{asking.to === "reject" ? "Why are you rejecting it?" : "What is wrong with it?"}
                  <textarea className={`${inputClass} mt-2`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example, we never ordered this, or the goods did not arrive." />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy !== null || reason.trim().length < 3} loading={busy === `${asking.to}-${v.claim.id}`}
                    onClick={() => run(`${asking.to}-${v.claim.id}`, () => (asking.to === "reject" ? backend.rejectInvoice(shopId, v.claim.id, reason) : backend.disputeInvoice(shopId, v.claim.id, reason)), asking.to === "reject" ? "Rejected. Lenders will see it." : "Disputed. The admin will look at it.")}>
                    {asking.to === "reject" ? "Reject this transaction" : "Dispute this transaction"}
                  </Button>
                  <Button variant="ghost" onClick={() => { setAsking(null); setReason(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy !== null} loading={busy === `c-${v.claim.id}`} onClick={() => run(`c-${v.claim.id}`, () => backend.confirmInvoice(shopId, v.claim.id), "Confirmed. Thank you.")}>Confirm transaction</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setAsking({ id: v.claim.id, to: "reject" }); setReason(""); }}>Reject</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setAsking({ id: v.claim.id, to: "dispute" }); setReason(""); }}>Dispute</Button>
              </div>
            )}
          </div>
        ))}
      </Rows>
      {pending.length === 0 && all.length > 0 && <p className="text-sm text-quiet">Nothing waiting for you.</p>}

      {history.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium">Your answers ({history.length})</h3>
          <Rows className="mt-2">
            {history.map((v) => (
              <div key={v.claim.id} className="space-y-3 py-4">
                <Details v={v} />
                {v.claim.reason && <p className="text-sm text-quiet">Your reason: &ldquo;{v.claim.reason}&rdquo;</p>}
                {v.claim.resolution && <p className="text-sm text-quiet">Admin: {v.claim.resolution.upheld ? "upheld your dispute" : "dismissed the dispute"}. &ldquo;{v.claim.resolution.note}&rdquo;</p>}
              </div>
            ))}
          </Rows>
        </div>
      )}

      {(report.data?.credentials ?? []).length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium">How fresh your evidence is</h3>
          <Rows className="mt-2">
            {report.data!.credentials.map((c) => (
              <div key={c.credentialId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span className="font-medium">{c.issuerName}</span>
                <span className="flex items-center gap-3 text-quiet">
                  {c.freshness.daysSinceVerified === 0 ? "checked today" : `${c.freshness.daysSinceVerified} days since the last check`}
                  <FreshnessBadge status={c.freshness.status} />
                </span>
              </div>
            ))}
          </Rows>
          <p className="mt-2 text-xs text-quiet">Old evidence stays on your profile, but lenders see how old it is.</p>
        </div>
      )}

      <div className="mt-6"><Notice>{OFFCHAIN_NOTE} In this demo you pick who you are from the role switcher, so this is not real log-in security. A real version asks the shopkeeper to log in with a phone code.</Notice></div>
    </Section>
  );
}

function Details({ v }: { v: InvoiceView }) {
  const c = v.claim;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">{v.issuerName}: invoice {c.ref}, {rs(c.amountInr)}</span>
        <ClaimBadge state={v.state} />
        <MatchBadge status={v.match.status} />
        {v.trust !== "awaiting" && <TrustBadge trust={v.trust} />}
      </div>
      <p className="text-sm text-quiet">
        {c.category}{c.description ? `: ${c.description}` : ""}. Invoice dated {formatDate(c.invoiceDate)}, submitted {formatDate(c.createdAt)}. Evidence: {c.evidenceRef || "none given"}.
      </p>
      <p className="text-sm text-quiet">{moneyLine(v.match, rs)}.</p>
    </div>
  );
}
