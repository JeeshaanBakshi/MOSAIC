"use client";
// LENDER: loan requests from shops. For each one: pay 1 USDC to check the shop (contract.verify), read the
// recommendation built from verified numbers only (backend.getLoanDecision), then approve or decline (backend.decideLoan).
// Going beyond the recommendation needs a written note. The evidence (six fraud checks per credential) is shown below,
// with a button to dispute a false claim.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Gavel, Search } from "lucide-react";
import { ACCOUNTS, backend, contract, nameOf, rs, type LoanOutcome, type Payout } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, accountOf, setRole, useRole } from "@/lib/session";
import { loadEvidence, type EvidenceItem } from "@/lib/checks";
import { distinctValidIssuers, suggestedAmount } from "@/lib/lender";
import { cad, formatDate, usdc } from "@/lib/format";

/** An amount in rupees with its rough Canadian-dollar equivalent. */
const money = (inr: number) => `${rs(inr)} (about ${cad(inr)})`;
import { Badge, Button, Field, Notice, PageTitle, Panel, Rows, Section, Stat, inputClass } from "@/components/ui";
import { CheckList } from "@/components/CheckList";
import { errorToast, txToast } from "@/components/toast";
import { toast } from "sonner";

const STACKING_ALERT = 3; // 3 or more lender checks in 30 days: the shop may be borrowing from several lenders at once

const OUTCOME: Record<LoanOutcome, { state: string; label: string }> = {
  approve: { state: "pass", label: "Recommend approve" },
  review: { state: "open", label: "Needs your judgment" },
  not_enough_evidence: { state: "unknown", label: "Not enough evidence" },
};

interface Verified { shopId: string; payouts: Payout[]; hash: string }

export function LenderView() {
  const params = useSearchParams();
  const role = useRole();
  const me = accountOf(role)?.address ?? "";

  const [shopId, setShopId] = useState(params.get("shop") ?? "shop-1");
  const [verified, setVerified] = useState<Verified | null>(null);
  const [loanId, setLoanId] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null); // what to approve (null = use the suggestion)
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const config = useQuery(() => contract.getConfig());
  const balance = useQuery(() => contract.getBalance(me), [me]);
  const shops = useQuery(() => backend.getShops());
  const loans = useQuery(() => backend.listLoans());
  const evidence = useQuery(() => (verified ? loadEvidence(verified.shopId) : Promise.resolve([] as EvidenceItem[])), [verified?.shopId]);
  const stacking = useQuery(() => (verified ? contract.checksLast30Days(verified.shopId) : Promise.resolve(0)), [verified?.shopId]);
  const disputes = useQuery(() => contract.listDisputes());

  const waiting = (loans.data ?? []).filter((l) => l.status === "requested");
  const decided = (loans.data ?? []).filter((l) => l.status === "approved" || l.status === "declined").slice(0, 5);
  const loan = waiting.find((l) => l.id === loanId) ?? null;
  const checked = !!loan && verified?.shopId === loan.shopId; // paid to see this shop's evidence
  const decision = useQuery(() => (loan && checked ? backend.getLoanDecision(loan.shopId, loan.amountInr, loan.months) : Promise.resolve(null)), [loan?.id, checked]);
  // Only while a loan is selected: once decided it leaves the waiting list, but the old recommendation may still be on screen.
  const suggested = loan && decision.data ? suggestedAmount(loan.amountInr, decision.data.limitInr) : 0; // 0 = no suggestion
  const approveAmount = amount ?? suggested;

  const fee = config.data?.verifyFee;
  const items = evidence.data ?? [];
  // Count voices, not paperwork: several credentials from the same issuer are still one issuer.
  const issuerCount = distinctValidIssuers(items.map((e) => e.view));
  const beyond = !!decision.data && (decision.data.outcome !== "approve" || approveAmount > decision.data.limitInr);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const verifyShop = (id: string) => run("verify", async () => {
    await backend.syncChecks(id); // make sure the contract knows which claims passed
    const { result, hash } = await contract.verify(me, id);
    setVerified({ shopId: id, payouts: result.payouts, hash });
    txToast(`Checked ${id}. Paid ${fee ? usdc(fee) : "the fee"}.`, hash);
  });

  const pick = (id: number, shop: string) => {
    setLoanId(id);
    setShopId(shop);
    setAmount(null);
    setNote("");
  };

  const decide = (approve: boolean) => run(approve ? "approve" : "decline", async () => {
    if (!loan) return;
    const { id, shopName } = loan; // keep a copy: after saving, this loan leaves the waiting list
    const l = await backend.decideLoan(me, id, approve, approveAmount, note);
    setLoanId(null);
    toast.success(approve ? `Approved ${rs(l.approvedInr ?? 0)} for ${shopName}` : `Declined ${shopName}'s request`);
  });

  const dispute = (credentialId: number) => run(`dispute-${credentialId}`, async () => {
    const { result, hash } = await contract.openDispute(me, credentialId);
    txToast(`Dispute #${result} opened on credential #${credentialId}. Now the admin decides.`, hash);
  });

  return (
    <div className="space-y-12">
      <PageTitle title="Loan requests from shops">
        Pay {fee ? usdc(fee) : "1 USDC"} to check a shop. Most of the fee goes to the issuers who vouched for it.
      </PageTitle>

      {PERSONAS[role].kind !== "lender" && (
        <Notice tone="warn">
          You are {PERSONAS[role].label}. <button className="font-medium underline underline-offset-4" onClick={() => setRole("asha")}>Switch to Lender 1, the lender</button>.
          {!accountOf(role) && " Shopkeepers have no wallet, so they can't pay to check a shop."}
        </Notice>
      )}

      <Section title={`Waiting for a decision (${waiting.length})`}>
        {waiting.length === 0 && <p className="text-sm text-quiet">No requests waiting.</p>}
        <Rows>
          {waiting.map((l) => (
            <div key={l.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{l.shopName} asks for {money(l.amountInr)} over {l.months} months</div>
                <p className="text-sm text-quiet">For &ldquo;{l.purpose}&rdquo;. Asked on {formatDate(l.requestedAt)}.</p>
              </div>
              <Button variant={l.id === loanId ? "primary" : "secondary"} onClick={() => pick(l.id, l.shopId)} aria-pressed={l.id === loanId}>{l.id === loanId ? "Reviewing" : "Review"}</Button>
            </div>
          ))}
        </Rows>
      </Section>

      {loan && (
        <Panel className="space-y-6">
          <div>
            <p className="text-sm text-quiet">Reviewing</p>
            <h2 className="text-2xl font-light tracking-tight">{loan.shopName}: {money(loan.amountInr)} over {loan.months} months</h2>
          </div>
          {!checked ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-quiet">Pay {fee ? usdc(fee) : "1 USDC"} to see the evidence and the recommendation.</p>
              <Button onClick={() => verifyShop(loan.shopId)} disabled={busy !== null || !me}>{busy === "verify" ? "Paying and checking…" : `Check the shop (${fee ? usdc(fee) : "1 USDC"})`}</Button>
            </div>
          ) : !decision.data ? (
            <p className="text-sm text-quiet">Working out the recommendation…</p>
          ) : (
            <>
              <div>
                <Badge state={OUTCOME[decision.data.outcome].state}>{OUTCOME[decision.data.outcome].label}</Badge>
                <p className="mt-2 text-lg font-light leading-snug">{decision.data.summary}</p>
              </div>
              <CheckList rows={decision.data.rules.map((r) => ({ label: r.label, result: r.result, reason: r.reason }))} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Approve (₹)" hint={suggested > 0 ? `They asked for ${money(loan.amountInr)}. Suggested: ${money(suggested)}.` : `They asked for ${money(loan.amountInr)}. No suggestion: not enough verified evidence.`}>
                  <input className={inputClass} inputMode="numeric" placeholder="Enter an amount" value={approveAmount ? String(approveAmount) : ""} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 9)))} />
                </Field>
                <Field label="Note" hint={beyond ? "Required, because you are going beyond the recommendation." : "Optional."}>
                  <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, visited the shop and known to us for 3 years." />
                </Field>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => decide(false)} disabled={busy !== null}>{busy === "decline" ? "…" : "Decline"}</Button>
                <Button onClick={() => decide(true)} disabled={busy !== null || !approveAmount}>{busy === "approve" ? "Saving…" : `Approve ${rs(approveAmount || 0)}`}</Button>
              </div>
            </>
          )}
        </Panel>
      )}

      {decided.length > 0 && (
        <Section title="Recent decisions">
          <Rows>
            {decided.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                <Badge state={l.status === "approved" ? "pass" : "fail"}>{l.status === "approved" ? `Approved ${rs(l.approvedInr ?? 0)}` : "Declined"}</Badge>
                <span className="font-medium">{l.shopName}</span>
                <span className="text-quiet">asked {rs(l.amountInr)}{l.lender ? `, decided by ${nameOf(l.lender)}` : ""}{l.recommendation && `, checks said ${l.recommendation.replace(/_/g, " ")}`}{l.note && `, note: ${l.note}`}</span>
              </div>
            ))}
          </Rows>
        </Section>
      )}

      <details className="group border-t border-line pt-6">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-medium tracking-tight">
          <Search className="size-[18px] text-quiet" aria-hidden />Check any shop
          <ChevronDown className="ml-auto size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Shop ID" hint="Try shop-1 or shop-2.">
              <input className={inputClass} list="shops" value={shopId} onChange={(e) => setShopId(e.target.value.trim())} />
              <datalist id="shops">{(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</datalist>
            </Field>
          </div>
          <Button onClick={() => verifyShop(shopId)} disabled={busy !== null || !shopId || !me} className="sm:w-56">
            {busy === "verify" ? "Paying and checking…" : `Verify (${fee ? usdc(fee) : "1 USDC"})`}
          </Button>
        </div>
      </details>
      <p className="-mt-8 text-sm text-quiet">Paying from {PERSONAS[role].label}. Balance {balance.data === undefined ? "…" : usdc(balance.data)}.</p>

      {verified && (
        <section className="space-y-8" aria-label={`Evidence for ${verified.shopId}`}>
          <div className="grid gap-8 border-t border-line pt-8 md:grid-cols-2">
            <div>
              <Stat label={`Lender checks on ${verified.shopId}, last 30 days`} value={String(stacking.data ?? "…")} />
              <div className="mt-2 flex items-center gap-2">
                {(stacking.data ?? 0) >= STACKING_ALERT ? <Badge state="fail">Possible loan stacking</Badge> : <Badge state="pass">Normal</Badge>}
              </div>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-quiet">Many checks at once can mean the shop is borrowing from several lenders.</p>
            </div>
            <div>
              <h3 className="text-sm font-medium">Where your fee went</h3>
              <Rows className="mt-2">
                {verified.payouts.map((p) => (
                  <div key={p.to} className="flex justify-between gap-4 py-2 text-sm">
                    <span className={p.to === ACCOUNTS.admin.address ? "text-quiet" : ""}>{p.to === ACCOUNTS.admin.address ? "Mosaic platform" : nameOf(p.to)}</span>
                    <span className="tabular-nums">{usdc(p.amount)}</span>
                  </div>
                ))}
              </Rows>
              <p className="mt-2 text-sm leading-relaxed text-quiet">70% goes to issuers whose claims passed the checks.</p>
              <p className="mt-1 truncate text-xs text-faint">Transaction hash {verified.hash.slice(0, 20)}… (simulated)</p>
            </div>
          </div>

          {!evidence.loading && items.length === 0 && (
            <p className="text-sm text-quiet">No credentials yet. Unknown, not bad.</p>
          )}

          {items.length > 0 && (
            <Stat label={`Distinct issuers vouching for ${verified.shopId}`} value={String(issuerCount)} hint="Counted once per issuer." />
          )}

          <div className="space-y-10">
            {items.map((e) => {
              const id = e.view.credential.id;
              const d = (disputes.data ?? []).find((x) => x.credentialId === id);
              return <CredentialBlock key={id} item={e} dispute={d} busy={busy === `dispute-${id}`} anyBusy={busy !== null} onDispute={() => dispute(id)} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function CredentialBlock({ item, dispute, busy, anyBusy, onDispute }: {
  item: EvidenceItem;
  dispute?: { id: number; resolved: boolean; upheld: boolean };
  busy: boolean;
  anyBusy: boolean;
  onDispute: () => void;
}) {
  const { view, rows, overall } = item;
  const c = view.credential;
  const shown = view.status === "Valid" ? overall : view.status;

  return (
    <article className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-xl font-light tracking-tight">{view.issuerName}</h3>
            <Badge state={shown}>{shown === "verified" ? "Verified" : shown === "failed" ? "Did not pass" : shown === "unknown" ? "Unknown" : shown}</Badge>
          </div>
          <p className="mt-1">&ldquo;{c.summary}&rdquo;</p>
          <p className="mt-1 text-sm text-quiet">
            Credential {c.id}, issued {formatDate(c.issuedAt)}, expires {formatDate(c.expiresAt)}, on-chain status {view.status.toLowerCase()}, evidence hash {c.claimHash.slice(0, 8)}…
          </p>
        </div>
        <div className="shrink-0">
          {dispute ? (
            <p className={`text-sm font-medium ${dispute.resolved && !dispute.upheld ? "text-quiet" : "text-clay"}`}>
              Dispute {dispute.id} {dispute.resolved ? (dispute.upheld ? "upheld, stake slashed" : "rejected") : "open, waiting for the admin"}
            </p>
          ) : (
            <Button variant="danger" disabled={anyBusy || c.stake === 0} title={c.stake === 0 ? "No stake left to claim" : undefined} onClick={onDispute}>
              <Gavel className="size-4" aria-hidden />{busy ? "Opening…" : "Open dispute"}
            </Button>
          )}
        </div>
      </div>
      <CheckList rows={rows} />
    </article>
  );
}
