"use client";
// ADMIN: applications to join the registry.
//   - The AUTOMATIC checks run by themselves for every application (backend.getReview).
//   - The admin may ALSO review by hand: tick what they verified themselves and write a note.
//   - Approve is allowed when every check passed, or after a manual review that covers each check that didn't.
//   - Approve = contract.addIssuer.  Reject = contract.rejectIssuerRequest.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { backend, contract, type IssuerRequest, type Review, type Verdict } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { accountOf, useRole } from "@/lib/session";
import { short } from "@/lib/format";
import { Badge, Button, Field, Panel, Section, inputClass } from "./ui";
import { CheckList } from "./CheckList";
import { errorToast, txToast } from "./toast";
import { toast } from "sonner";

const VERDICT: Record<Verdict, { state: string; label: string }> = {
  recommend_approve: { state: "pass", label: "Recommend approve" },
  needs_review: { state: "open", label: "Needs a manual look" },
  recommend_reject: { state: "fail", label: "Recommend reject" },
};

export function Applications() {
  const requests = useQuery(() => contract.listIssuerRequests());
  const pending = (requests.data ?? []).filter((r) => r.status === "Pending");
  const rejected = (requests.data ?? []).filter((r) => r.status === "Rejected");

  return (
    <Section title={`Applications to join (${pending.length} waiting)`}>
      {pending.length === 0 && (
        <p className="text-sm text-quiet">No applications waiting.</p>
      )}
      <div className="space-y-6">{pending.map((r) => <ApplicationCard key={r.address} request={r} />)}</div>
      {rejected.length > 0 && <p className="mt-4 text-sm text-quiet">Rejected: {rejected.map((r) => r.name).join(", ")}. </p>}
    </Section>
  );
}

function ApplicationCard({ request }: { request: IssuerRequest }) {
  const review = useQuery(() => backend.getReview(request.address), [request.address]);
  if (!review.data) return <Panel className="text-sm text-quiet">Running the automatic checks for {request.name}…</Panel>;
  return <ReviewPanel request={request} review={review.data} />;
}

function ReviewPanel({ request, review }: { request: IssuerRequest; review: Review }) {
  const role = useRole();
  const me = accountOf(role)?.address ?? "";
  const { application: a, checks, verdict, approval } = review;

  // The manual review form starts from whatever was saved before.
  const [checked, setChecked] = useState<Record<string, boolean>>(review.manualReview?.checked ?? {});
  const [note, setNote] = useState(review.manualReview?.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const v = VERDICT[verdict];
  const allPassed = checks.every((c) => c.result === "pass");
  const notPassed = checks.filter((c) => c.result !== "pass");

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const save = () => run("save", async () => {
    await backend.saveManualReview(request.address, checked, note);
    toast.success("Manual review saved");
  });
  const approve = () => run("approve", async () => {
    const { hash } = await contract.addIssuer(me, request.address, a.businessName, a.kind);
    txToast(`${a.businessName} approved and added to the registry`, hash);
  });
  const reject = () => run("reject", async () => {
    const { hash } = await contract.rejectIssuerRequest(me, request.address);
    txToast(`${a.businessName} rejected`, hash);
  });

  const tax = a.kind === "Supplier" ? "GSTIN" : "RBI licence";
  return (
    <Panel className="space-y-6" data-application={a.businessName}>
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-xl font-light tracking-tight">{a.businessName}</h3>
          <Badge state={v.state}>{v.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-quiet">
          {a.kind === "Supplier" ? "Supplier" : "Payment app"}, {tax} {a.registrationNumber}, applying as {short(a.address)}.
        </p>
        <p className="text-sm text-quiet">{a.ownerName}, {a.phone}, {a.email}. Bank account holder: {a.bankAccountHolder}.</p>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium">Automatic checks</h4>
        <CheckList rows={checks.map((c) => ({ label: c.label, result: c.result, reason: c.reason }))} />
      </div>

      <details open={!allPassed} className="group rounded-(--radius-control) border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
          Review by hand {allPassed ? "(optional, everything passed)" : `(needed, ${notPassed.length} check${notPassed.length === 1 ? "" : "s"} did not pass)`}
          {review.manualReview && <span className="ml-auto text-xs font-normal text-pine">Saved</span>}
        </summary>
        <div className="space-y-4 border-t border-line px-4 py-4">
          <p className="max-w-xl text-sm leading-relaxed text-quiet">
            Do your own checking: call the owner, look at the papers, visit the shop. Tick each check you verified yourself and write what you found.
            A check that failed automatically can only be overruled this way.
          </p>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.id}>
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 size-4 accent-[#2e5a4d]" checked={!!checked[c.id]} onChange={(e) => setChecked((x) => ({ ...x, [c.id]: e.target.checked }))} />
                  <span>I checked <span className="font-medium">{c.label}</span> myself{c.result !== "pass" && <span className="ml-1 text-clay">(automatic result: {c.result === "fail" ? "failed" : "unknown"})</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          <Field label="Note (required if any check did not pass)">
            <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, called the owner on the registered number and visited the warehouse." />
          </Field>
          <Button variant="secondary" onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save manual review"}</Button>
        </div>
      </details>

      <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-sm ${approval.allowed ? "text-pine" : "text-clay"}`}>{approval.reason}</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={reject} disabled={busy !== null}>{busy === "reject" ? "…" : "Reject"}</Button>
          <Button onClick={approve} disabled={busy !== null || !approval.allowed}>
            {busy === "approve" ? "Signing…" : allPassed ? "Approve" : "Approve after manual review"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
