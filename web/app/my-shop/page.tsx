"use client";
// SHOPKEEPER: "My shop". Who vouches for me, how lenders will see me, ask for a loan, track it.
// The shopkeeper never needs a wallet or crypto: requests are off-chain, and lenders pay the checking fee.
// Backend used: getShop, getShopReview, getLoanDecision (estimate), requestLoan, withdrawLoan, listLoans.
// Contract used: checks_last_30_days.
import { useState } from "react";
import { backend, contract, nameOf, rs, type ShopVerdict } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, setRole, useRole } from "@/lib/session";
import { cad, formatDate } from "@/lib/format";

/** An amount in rupees with its rough Canadian-dollar equivalent. */
const money = (inr: number) => `${rs(inr)} (about ${cad(inr)})`;
import { CircleCheck, CircleX } from "lucide-react";
import { Badge, Button, Field, PageTitle, Panel, Rows, Section, Skeleton, Stat, inputClass } from "@/components/ui";
import { errorToast } from "@/components/toast";
import { LoadDemoButton } from "@/components/LoadDemoButton";
import { ShopView } from "@/app/shop/[id]/ShopView";
import { toast } from "sonner";

export default function MyShopPage() {
  const role = useRole();
  const shopId = PERSONAS[role].shopId;
  if (!shopId) {
    return (
      <div className="space-y-8">
        <PageTitle title="This page is for shopkeepers">Pick a shop.</PageTitle>
        <div className="flex flex-wrap gap-4">
          <Button onClick={() => setRole("sharma")}>Sharma Store</Button>
          <Button variant="secondary" onClick={() => setRole("mehta")}>Verma Kirana (new, no credentials)</Button>
        </div>
      </div>
    );
  }
  return <ShopDashboard shopId={shopId} />;
}

const STANDING: Record<ShopVerdict, { state: string; title: string; word: string }> = {
  looks_genuine: { state: "pass", title: "Lenders will see a genuine, active business", word: "Looks genuine" },
  needs_review: { state: "open", title: "A lender will look more closely", word: "Needs review" },
  not_enough_evidence: { state: "unknown", title: "Lenders can't judge you yet, and that is not bad", word: "Unknown" },
};

const STATUS: Record<string, { state: string; label: string }> = {
  requested: { state: "open", label: "Waiting for a lender" },
  approved: { state: "pass", label: "Approved" },
  declined: { state: "fail", label: "Declined" },
  withdrawn: { state: "unknown", label: "Withdrawn" },
};

function ShopDashboard({ shopId }: { shopId: string }) {
  const shop = useQuery(() => backend.getShop(shopId), [shopId]);
  const review = useQuery(() => backend.getShopReview(shopId), [shopId]);
  const loans = useQuery(() => backend.listLoans({ shopId }), [shopId]);
  const checks30 = useQuery(() => contract.checksLast30Days(shopId), [shopId]);

  const [amount, setAmount] = useState(20000);
  const [amountText, setAmountText] = useState("20000"); // what is typed in the box (digits only, no leading zeros)
  const [months, setMonths] = useState(6);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const estimate = useQuery(() => backend.getLoanDecision(shopId, amount || 0, months), [shopId, amount, months]);

  const r = review.data;
  const waiting = (loans.data ?? []).find((l) => l.status === "requested");

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }
  const ask = () => run("ask", async () => {
    await backend.requestLoan(shopId, amount, months, purpose);
    setPurpose("");
    toast.success("Request sent. Lenders can see it now.");
  });
  const withdraw = (id: number) => run(`w-${id}`, async () => {
    await backend.withdrawLoan(shopId, id);
    toast.success("Request withdrawn");
  });

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle title={shop.data?.name ?? shopId}>Your public profile first, then your loan.</PageTitle>
        <LoadDemoButton />
      </div>

      <ShopView id={shopId} embedded />

      <section className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div className="max-w-xl">
          {r ? (
            <>
              <Badge state={STANDING[r.verdict].state}>{STANDING[r.verdict].word}</Badge>
              <h2 className="mt-4 text-2xl font-light leading-snug tracking-tight">{STANDING[r.verdict].title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-quiet">
                {r.verdict === "not_enough_evidence"
                  ? "Ask the businesses you work with, your supplier and your payment app, to vouch for you on Mosaic. Two of them are enough."
                  : r.verdictReason}
              </p>
            </>
          ) : <Skeleton className="block h-24 w-full" />}
        </div>
        <Stat label="Lender checks in the last 30 days" value={checks30.data === undefined ? <Skeleton /> : String(checks30.data)} />
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
        <Panel className="space-y-6 self-start">
          <h2 className="text-lg font-medium tracking-tight">Ask for a loan</h2>
          {waiting ? (
            <p className="text-sm leading-relaxed text-quiet">
              You have a request waiting for a lender: {money(waiting.amountInr)} over {waiting.months} months. Withdraw it to ask for something different.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How much (₹, Indian rupees)">
                  <input className={inputClass} type="text" inputMode="numeric" value={amountText} onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9); // digits only, no leading zero
                    setAmountText(digits);
                    setAmount(Number(digits));
                  }} />
                </Field>
                <Field label="Pay back over">
                  <select className={inputClass} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                    {[3, 6, 9, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
                  </select>
                </Field>
              </div>
              <Field label="What is it for?">
                <input className={inputClass} placeholder="For example, extra stock for the festival season" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </Field>
              {estimate.data && (
                <p className="rounded-(--radius-control) bg-wash px-4 py-4 text-sm leading-relaxed text-quiet">
                  {estimate.data.outcome === "approve" && <>Based on your verified records, lenders&apos; checks suggest up to <b className="font-medium text-ink">{money(estimate.data.limitInr)}</b>.{amount > estimate.data.limitInr && " You can still ask for more, but expect less."}</>}
                  {estimate.data.outcome === "review" && <>A lender will look at your request by hand. Their checks suggest up to <b className="font-medium text-ink">{money(estimate.data.limitInr)}</b>.</>}
                  {estimate.data.outcome === "not_enough_evidence" && <>There isn&apos;t enough evidence yet for lenders to suggest an amount. You can still ask, and a lender may decide by hand.</>}
                </p>
              )}
              <Button onClick={ask} disabled={busy !== null || !amount || purpose.trim().length < 3} className="w-full">
                {busy === "ask" ? "Sending…" : `Ask for ${rs(amount || 0)}`}
              </Button>
            </>
          )}
        </Panel>

        <Section title="Who vouches for you" className="self-start">
          {r && r.issuers.length === 0 && <p className="text-sm text-quiet">Nobody yet.</p>}
          <Rows>
            {r?.issuers.map((i) => (
              <div key={i.issuer} className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 font-medium">
                    {i.overall === "verified" ? <CircleCheck className="size-[18px] text-pine" aria-hidden /> : i.overall === "failed" ? <CircleX className="size-[18px] text-clay" aria-hidden /> : null}
                    {i.issuerName}
                  </span>
                  <span className="text-xs text-quiet">{i.overall === "verified" ? "Counts" : i.overall === "failed" ? "Does not count" : "Not checked yet"}</span>
                </div>
                <p className="mt-1 text-sm text-quiet">
                  {i.kind === "PaymentProvider" ? "Your payment app" : "Your supplier"} says {i.claimedMonthly ? `${rs(i.claimedMonthly)} a month` : "no amount"}.
                </p>
                {i.overall === "failed" && <p className="mt-1 text-sm text-clay">Not counted: {i.failedReason ?? "it did not pass the checks"}</p>}
              </div>
            ))}
          </Rows>
        </Section>
      </div>

      <Section title="Your loan requests">
        {(loans.data ?? []).length === 0 && <p className="text-sm text-quiet">No requests yet.</p>}
        <Rows>
          {(loans.data ?? []).map((l) => (
            <div key={l.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-medium">{money(l.amountInr)} over {l.months} months</span>
                  <Badge state={STATUS[l.status].state}>{l.status === "approved" ? `Approved ${rs(l.approvedInr ?? 0)}` : STATUS[l.status].label}</Badge>
                </div>
                <p className="mt-1 text-sm text-quiet">For &ldquo;{l.purpose}&rdquo;. Asked on {formatDate(l.requestedAt)}{l.lender && <>, decided by {nameOf(l.lender)}</>}.</p>
                {l.note && <p className="mt-1 text-sm text-quiet">Lender&apos;s note: {l.note}</p>}
              </div>
              {l.status === "requested" && <Button variant="secondary" disabled={busy !== null} onClick={() => withdraw(l.id)}>{busy === `w-${l.id}` ? "…" : "Withdraw"}</Button>}
            </div>
          ))}
        </Rows>
      </Section>
    </div>
  );
}
