"use client";
// ADMIN: rejection cases. When a shop or a lender rejects a supplier's claim, a case opens here. The admin downloads the case
// file (a PDF with the reason, the checks, the invoice evidence and the supplier's record) and decides:
//   Approve = the rejection stands: stake deducted, credential revoked, the supplier gets a warning (the 3rd removes it).
//   Dismiss = no penalty.
// Backend used: getCases, decideCase. The PDF comes from /api/case/{id}/pdf.
import { useState } from "react";
import { FileDown } from "lucide-react";
import { backend } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, accountOf, useRole } from "@/lib/session";
import { formatDate, usdc } from "@/lib/format";
import { Badge, Button, Skeleton, inputClass } from "@/components/ui";
import { errorToast } from "@/components/toast";
import { toast } from "sonner";

const KIND = { shop_rejection: "The shop rejected or disputed an invoice", lender_rejection: "A lender reported wrong information" } as const;

export function CaseFiles() {
  const role = useRole();
  const me = accountOf(role)?.address ?? "";
  const isAdmin = PERSONAS[role].kind === "admin";
  const cases = useQuery(() => backend.getCases());
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const list = cases.data ?? [];
  const open = list.filter((c) => c.file.status === "open");

  async function decide(id: number, decision: "approve" | "dismiss") {
    setBusy(`${id}-${decision}`);
    try {
      const r = await backend.decideCase(me, id, decision, note[id] ?? "");
      toast.success(decision === "dismiss" ? "Dismissed. No penalty." : r.removed ? `Approved. ${usdc(r.stakeDeducted)} deducted. The supplier had 3 warnings and is removed from the system.` : `Approved. ${usdc(r.stakeDeducted)} deducted. Warning ${r.warnings} of 3.`);
    } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  return (
    <div id="cases" className="space-y-4">
      <h2 className="text-lg font-medium tracking-tight">Rejection cases ({open.length} open)</h2>
      {cases.loading && <Skeleton className="block h-24 w-full" />}
      {!cases.loading && list.length === 0 && <p className="text-sm text-quiet">No cases yet.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((c) => {
          const f = c.file;
          return (
            <article key={f.id} className="space-y-3 rounded-(--radius-panel) border border-line bg-surface p-5" data-case={f.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium">Case {f.id}: {c.issuerName}</span>
                <Badge state={f.status === "open" ? "open" : f.status === "approved" ? "failed" : "pass"}>{f.status === "open" ? "Open" : f.status === "approved" ? "Approved" : "Dismissed"}</Badge>
                <span className="ml-auto text-xs text-quiet">Warnings {c.warnings} of {c.warningLimit}</span>
              </div>
              <p className="text-sm text-quiet">{c.shopName} · {KIND[f.kind]} · {f.raisedByName}, {formatDate(f.openedAt)}</p>
              <p className="text-sm">&ldquo;{f.reason}&rdquo;</p>
              {f.status === "open" ? (
                <div className="space-y-3">
                  <a href={`/api/case/${f.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-pine underline underline-offset-4"><FileDown className="size-4" aria-hidden />Case file (PDF)</a>
                  <p className="text-xs text-quiet">
                    Approve: {usdc(c.stakeNow)} stake deducted, warning {Math.min(c.warnings + 1, c.warningLimit)} of {c.warningLimit}.
                    {c.removesIssuer && <b className="font-medium text-clay"> Last warning: {c.issuerName} is removed.</b>}
                  </p>
                  <input className={inputClass} placeholder="Your note (required)" value={note[f.id] ?? ""} onChange={(e) => setNote({ ...note, [f.id]: e.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" disabled={busy !== null || !isAdmin || (note[f.id] ?? "").trim().length < 3} loading={busy === `${f.id}-approve`} onClick={() => decide(f.id, "approve")}>Approve: deduct stake and warn</Button>
                    <Button variant="secondary" disabled={busy !== null || !isAdmin || (note[f.id] ?? "").trim().length < 3} loading={busy === `${f.id}-dismiss`} onClick={() => decide(f.id, "dismiss")}>Dismiss: no penalty</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 text-sm text-quiet">
                  <p>Ruling, {formatDate(f.decision!.at)}: &ldquo;{f.decision!.note}&rdquo;</p>
                  {f.status === "approved" && <p>{usdc(f.decision!.stakeDeducted)} deducted. Warning {f.decision!.warnings} of {c.warningLimit}.{f.decision!.removed ? " Removed from the system." : ""}</p>}
                  <a href={`/api/case/${f.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-pine underline underline-offset-4"><FileDown className="size-3.5" aria-hidden />Case file (PDF)</a>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <details className="text-xs text-quiet"><summary className="cursor-pointer underline underline-offset-4">Simulation note</summary><p className="mt-2 max-w-2xl">The stake deduction and the removal run in the website&apos;s simulation, not on Stellar. The deployed contract only slashes after a reported default and is unchanged.</p></details>
    </div>
  );
}
