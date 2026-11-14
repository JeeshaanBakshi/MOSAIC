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
import { distinctValidIssuers, distinctVerifiedIssuers, suggestedAmount } from "@/lib/lender";
import { cad, formatDate, usdc } from "@/lib/format";

/** An amount in rupees with its rough Canadian-dollar equivalent. */
const money = (inr: number) => `${rs(inr)} (about ${cad(inr)})`;
import { Badge, Button, EmptyState, Field, Notice, PageTitle, Panel, QueryError, Rows, Section, Skeleton, Stat, inputClass } from "@/components/ui";
import { Hash } from "@/components/Hash";
import { CheckList, type RowLike } from "@/components/CheckList";
import { errorToast, txToast } from "@/components/toast";
import { TxRef } from "@/components/TxRef";
import { OnChainPanel } from "@/components/OnChainPanel";
import { toast } from "sonner";

const STACKING_ALERT = 3; // 3 or more lender checks in 30 days: the shop may be borrowing from several lenders at once

const OUTCOME: Record<LoanOutcome, { state: string; label: string }> = {
  approve: { state: "pass", label: "Recommend approve" },
  review: { state: "open", label: "Needs your judgment" },
  not_enough_evidence: { state: "unknown", label: "Not enough evidence" },
};

interface Verified { shopId: string; payouts: Payout[]; hash: string; onchain: boolean }

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
  const wanted = params.get("shop"); // the landing page's "Try the demo" opens the lender view on this shop
  const autoId = wanted ? waiting.find((x) => x.shopId === wanted)?.id ?? null : null;
  const decided = (loans.data ?? []).filter((l) => l.status === "approved" || l.status === "declined").slice(0, 5);
  const loan = waiting.find((l) => l.id === (loanId ?? autoId)) ?? null;
  const checked = !!loan && verified?.shopId === loan.shopId; // paid to see this shop's evidence
  const decision = useQuery(() => (loan && checked ? backend.getLoanDecision(loan.shopId, loan.amountInr, loan.months) : Promise.resolve(null)), [loan?.id, checked]);
  // Only while a loan is selected: once decided it leaves the waiting list, but the old recommendation may still be on screen.
  const suggested = loan && decision.data ? suggestedAmount(loan.amountInr, decision.data.limitInr) : 0; // 0 = no suggestion
  const approveAmount = amount ?? suggested;

  const fee = config.data?.verifyFee;
  const shopName = (id: string) => (shops.data ?? []).find((s) => s.id === id)?.name ?? id;
  const items = evidence.data ?? [];
  // Count voices, not paperwork: several credentials from the same issuer are still one issuer.
  const issuerCount = distinctValidIssuers(items.map((e) => e.view));
  const verifiedCount = distinctVerifiedIssuers(items.map((e) => ({ issuer: e.view.credential.issuer, verified: e.view.status === "Valid" && e.overall === "verified" })));
  const rules: RowLike[] = (decision.data?.rules ?? []).map((r) => ({ label: r.label, result: r.result, reason: r.reason, source: r.source }));
  const stackingRule = decision.data?.rules.find((r) => r.id === "stacking");
  const passedRules = rules.filter((r) => r.result === "pass");
  const failedRules = rules.filter((r) => r.result === "fail");
  const missingRules = rules.filter((r) => r.result === "unknown");
  const outOfRange = !!loan && approveAmount > 0 && (approveAmount < 1000 || approveAmount > loan.amountInr); // the server only allows ₹1,000 up to what they asked for
  const beyond = !!decision.data && (decision.data.outcome !== "approve" || approveAmount > decision.data.limitInr);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const verifyShop = (id: string) => run("verify", async () => {
    await backend.syncChecks(id); // make sure the contract knows which claims passed
    const { result, hash, onchain } = await contract.verify(me, id);
    setVerified({ shopId: id, payouts: result.payouts, hash, onchain: !!onchain });
    txToast(`Checked ${shopName(id)}. Paid ${fee ? usdc(fee) : "the fee"}.`, hash, onchain);
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
    const { result, hash, onchain } = await contract.openDispute(me, credentialId);
    txToast(`Dispute #${result} opened on credential #${credentialId}. Now the admin decides.`, hash, onchain);
  });

  return (
    <div className="space-y-12">
      <PageTitle title="Loan requests from shops">
        Pay {fee ? usdc(fee) : "1 USDC"} to check a shop. Most of the fee goes to the issuers who vouched for it.
      </PageTitle>

      {PERSONAS[role].kind !== "lender" && (
        <Notice tone="warn">
          You are {PERSONAS[role].label}. <button className="font-medium underline underline-offset-4" onClick={() => setRole("asha")}>Switch to Saathi Microfinance, the lender</button>.
          {!accountOf(role) && " Shopkeepers have no wallet, so they can't pay to check a shop."}
        </Notice>
      )}

      <Section title={`Waiting for a decision (${waiting.length})`}>
        {loans.error && <QueryError what="loan requests" onRetry={loans.retry} />}
        {!loans.error && waiting.length === 0 && (
          <EmptyState title="No loan requests waiting">Shops ask for loans from their My shop page.</EmptyState>
        )}
        <Rows>
          {waiting.map((l) => (
            <div key={l.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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
        <Panel className="space-y-8">
          <div>
            <p className="text-sm text-quiet">Reviewing</p>
            <h2 className="text-xl font-light tracking-tight">{loan.shopName}: {money(loan.amountInr)} over {loan.months} months</h2>
          </div>
          {!checked ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-quiet">Pay {fee ? usdc(fee) : "1 USDC"} to see the evidence and the recommendation.</p>
              <Button onClick={() => verifyShop(loan.shopId)} disabled={busy !== null || !me} loading={busy === "verify"}>
                {busy === "verify" ? "Paying and checking…" : `Check the shop (${fee ? usdc(fee) : "1 USDC"})`}
              </Button>
            </div>
          ) : decision.error ? (
            <QueryError what="the recommendation" onRetry={decision.retry} />
          ) : !decision.data ? (
            <div className="space-y-4" aria-busy="true"><Skeleton className="block h-8 w-2/3" /><Skeleton className="block h-4 w-1/2" /><Skeleton className="block h-32 w-full" /></div>
          ) : (
            <>
              <VerdictCard decision={decision.data} passed={passedRules.length} total={decision.data.rules.length} paid={fee} verified={verified} />

              {stackingRule?.result === "fail" && <Notice tone="warn"><b className="font-medium">Possible loan stacking.</b> {stackingRule.reason}</Notice>}

              <div className="space-y-8">
                <CheckGroup title="Failed" rows={failedRules} />
                <CheckGroup title="Missing" note="Unknown is not bad: there is just no evidence yet." rows={missingRules} />
                <CheckGroup title="Passed" rows={passedRules} />
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-quiet">
                <Button variant="ghost" disabled={busy !== null} loading={busy === "stack"}
                  onClick={() => run("stack", async () => { const { hash } = await contract.simulateOtherLenderChecks(loan.shopId, 2); txToast("Demo: 2 other lenders also checked this shop", hash); })}>
                  Demo: 2 other lenders also check this shop
                </Button>
                <span>Shows the stacking warning (check 6).</span>
              </div>

              <div className="space-y-6 rounded-(--radius-panel) bg-wash p-6">
                <h3 className="text-base font-medium">Your decision</h3>
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field label="Approve (₹)" hint={outOfRange ? `Between ₹1,000 and ${money(loan.amountInr)}, the amount they asked for.` : suggested > 0 ? `They asked for ${money(loan.amountInr)}. Suggested: ${money(suggested)}.` : `They asked for ${money(loan.amountInr)}. No suggestion: not enough verified evidence.`}>
                    <input className={inputClass} inputMode="numeric" placeholder="Enter an amount" value={approveAmount ? String(approveAmount) : ""} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 9)))} />
                  </Field>
                  <Field label={beyond ? "Note (required)" : "Note (optional)"} hint={beyond ? "Say why you are going beyond the recommendation." : undefined}>
                    <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, visited the shop and known to us for 3 years." />
                  </Field>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={() => decide(false)} disabled={busy !== null} loading={busy === "decline"}>Decline</Button>
                  <Button onClick={() => decide(true)} disabled={busy !== null || !approveAmount || outOfRange || (beyond && !note.trim())} loading={busy === "approve"}>
                    {busy === "approve" ? "Saving…" : `Approve ${rs(approveAmount || 0)}`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>
      )}

      {decided.length > 0 && (
        <Section title="Recent decisions">
          <Rows>
            {decided.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-sm">
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
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Shop ID" hint="Try shop-1, shop-2 or shop-3.">
              <input className={inputClass} list="shops" value={shopId} onChange={(e) => setShopId(e.target.value.trim())} />
              <datalist id="shops">{(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</datalist>
            </Field>
          </div>
          <Button onClick={() => verifyShop(shopId)} disabled={busy !== null || !shopId || !me} loading={busy === "verify"} className="sm:w-56">
            {busy === "verify" ? "Paying and checking…" : `Verify (${fee ? usdc(fee) : "1 USDC"})`}
          </Button>
        </div>
      </details>
      <p className="-mt-8 text-sm text-quiet">Paying from {PERSONAS[role].label}. Balance {balance.data === undefined ? <Skeleton className="h-4 w-14" /> : usdc(balance.data)}.</p>

      {verified && (
        <section className="space-y-8 border-t border-line pt-8" aria-label={`Evidence for ${shopName(verified.shopId)}`}>
          <h2 className="text-lg font-medium tracking-tight">Evidence for {shopName(verified.shopId)} <span className="text-xs font-normal text-faint">{verified.shopId}</span></h2>

          <div className="grid gap-6 sm:grid-cols-2">
            <Stat label="Distinct issuers" value={`${verifiedCount} of ${issuerCount} verified`} hint="Several credentials from one issuer count once." />
            <div>
              <Stat label="Lender checks, last 30 days" value={stacking.data === undefined ? <Skeleton /> : String(stacking.data)} hint="Many at once can mean the shop is borrowing from several lenders." />
              <div className="mt-2">{(stacking.data ?? 0) >= STACKING_ALERT ? <Badge state="fail">Possible loan stacking</Badge> : <Badge state="pass">Normal</Badge>}</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-(--radius-panel) border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-quiet">A dispute can only be upheld after the shop defaults. If this shop did not repay a loan from you, report it here.</p>
            <Button variant="secondary" disabled={busy !== null || !me} loading={busy === "default"}
              onClick={() => run("default", async () => { const { hash, onchain } = await contract.reportDefault(me, verified.shopId); txToast(`${verified.shopId} reported as defaulted`, hash, onchain); })}>
              Report a default
            </Button>
          </div>

          <details className="group">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />Where your fee went
            </summary>
            <Rows className="mt-2">
              {verified.payouts.map((p) => (
                <div key={p.to} className="flex justify-between gap-4 py-2 text-sm">
                  <span className={p.to === ACCOUNTS.admin.address ? "text-quiet" : ""}>{p.to === ACCOUNTS.admin.address ? "Mosaic platform" : nameOf(p.to)}</span>
                  <span className="tabular-nums">{usdc(p.amount)}</span>
                </div>
              ))}
            </Rows>
            <p className="mt-2 text-sm text-quiet">70% goes to issuers whose claims passed the checks.{verified.onchain ? " These amounts were read from the real transaction." : ""}</p>
            <p className="mt-2 text-xs text-quiet"><TxRef hash={verified.hash} onchain={verified.onchain} /></p>
          </details>

          {evidence.error && <QueryError what="the evidence" onRetry={evidence.retry} />}
          {!evidence.error && !evidence.loading && items.length === 0 && (
            <EmptyState title={`No credentials for ${shopName(verified.shopId)}`}>That means unknown, not bad: this shop has no evidence yet. Ask its supplier or payment app to vouch.</EmptyState>
          )}

          <div className="space-y-6">
            {items.map((e) => {
              const id = e.view.credential.id;
              const d = (disputes.data ?? []).find((x) => x.credentialId === id);
              return <CredentialBlock key={id} item={e} dispute={d} busy={busy === `dispute-${id}`} anyBusy={busy !== null} onDispute={() => dispute(id)} />;
            })}
          </div>
        </section>
      )}

      <OnChainPanel />
    </div>
  );
}

/** The answer first: what to do, and how sure we are. Then the fee that was paid and where it went. */
function VerdictCard({ decision, passed, total, paid, verified }: {
  decision: { outcome: LoanOutcome; limitInr: number; summary: string };
  passed: number; total: number; paid?: number; verified: Verified | null;
}) {
  const tone = { approve: "bg-pine-soft", review: "bg-wash", not_enough_evidence: "bg-wash" }[decision.outcome];
  const headline = decision.outcome === "approve" ? `Approve up to ${rs(decision.limitInr)}`
    : decision.outcome === "review" ? "Needs your judgement" : "Unknown, not bad";
  const sub = decision.outcome === "review" ? `Suggested limit ${rs(decision.limitInr)}. ${decision.summary}`
    : decision.outcome === "not_enough_evidence" ? "There isn't enough verified evidence yet to suggest a limit. That is not a mark against the shop." : decision.summary;
  const platform = (verified?.payouts ?? []).filter((p) => p.to === ACCOUNTS.admin.address).reduce((t, p) => t + p.amount, 0);
  const issuers = (verified?.payouts ?? []).filter((p) => p.to !== ACCOUNTS.admin.address).reduce((t, p) => t + p.amount, 0);
  return (
    <div className={`space-y-4 rounded-(--radius-panel) p-6 ${tone}`} data-verdict={decision.outcome}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge state={OUTCOME[decision.outcome].state}>{OUTCOME[decision.outcome].label}</Badge>
        <span className="text-sm font-medium">{passed} of {total} checks passed</span>
      </div>
      <p className="text-3xl font-medium leading-tight tracking-tight">{headline}</p>
      <p className="max-w-2xl text-base leading-relaxed text-quiet">{sub}</p>
      {verified && (
        <div className="border-t border-ink/10 pt-4 text-sm text-quiet">
          <p>
            {paid ? `You paid ${usdc(paid)}. ` : ""}
            {usdc(issuers)} went to the issuers whose claims passed, {usdc(platform)} to the platform{verified.onchain ? ", read from the real transaction" : ""}.
          </p>
          <p className="mt-1"><TxRef hash={verified.hash} onchain={verified.onchain} /></p>
        </div>
      )}
    </div>
  );
}

function CheckGroup({ title, note, rows }: { title: string; note?: string; rows: RowLike[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-medium">{title} ({rows.length})</h3>
      {note && <p className="mt-1 text-sm text-quiet">{note}</p>}
      <div className="mt-2"><CheckList rows={rows} /></div>
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
  const passedN = rows.filter((r) => r.result === "pass").length;
  const anyFail = rows.some((r) => r.result === "fail" && r.check !== 6);

  return (
    <article className="rounded-(--radius-panel) border border-line bg-surface p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h3 className="text-lg font-medium tracking-tight">{view.issuerName}</h3>
            <Badge state={shown}>{shown === "verified" ? "Verified" : shown === "failed" ? "Did not pass" : shown === "unknown" ? "Unknown" : shown}</Badge>
          </div>
          <p className="text-base">&ldquo;{c.summary}&rdquo;</p>
          <p className="text-sm text-quiet">Credential {c.id}, expires {formatDate(c.expiresAt)}, on-chain status {view.status.toLowerCase()}.</p>
          <p className="text-sm text-quiet">Evidence hash <Hash value={c.claimHash} label="evidence hash" /></p>
        </div>
        <div className="shrink-0">
          {dispute ? (
            <p className={`text-sm font-medium ${dispute.resolved && !dispute.upheld ? "text-quiet" : "text-clay"}`}>
              Dispute {dispute.id} {dispute.resolved ? (dispute.upheld ? "upheld, stake slashed" : "rejected") : "open, waiting for the admin"}
            </p>
          ) : (
            <Button variant="danger" disabled={anyBusy || c.stake === 0} loading={busy} title={c.stake === 0 ? "No stake left to claim" : undefined} onClick={onDispute}>
              {!busy && <Gavel className="size-4" aria-hidden />}{busy ? "Opening…" : "Open dispute"}
            </Button>
          )}
        </div>
      </div>
      <details className="group mt-6 border-t border-line pt-4" open={anyFail}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
          {passedN} of {rows.length} checks passed
        </summary>
        <div className="mt-4"><CheckList rows={rows} /></div>
      </details>
    </article>
  );
}
