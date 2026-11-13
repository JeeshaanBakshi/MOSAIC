"use client";
// ISSUER (supplier or payment provider): signs credentials about shops and locks a stake behind each.
// Contract functions used: issue_credential, revoke, release_stake, and reads get_issuer / get_credentials / get_config.
import { useState } from "react";
import { backend, claimHash, contract, type RoleId } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { ISSUER_PERSONAS, PERSONAS, accountOf, setRole, useRole } from "@/lib/session";
import { usdc, usdcCad, formatDate } from "@/lib/format";
import { CircleCheck, CircleDashed, Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Field, Notice, PageTitle, Panel, QueryError, Section, Skeleton, Stat, inputClass } from "@/components/ui";
import { Hash } from "@/components/Hash";
import { ActivityLog } from "@/components/ActivityLog";
import { ApplyToJoin } from "@/components/ApplyToJoin";
import { errorToast, txToast } from "@/components/toast";

const CLAIM_TYPES = [
  { value: "buyer", label: "Regular buyer", text: (rs: string) => `Regular buyer for 12 months, buys ${rs} a month, pays on time` },
  { value: "receipts", label: "Payment-app receipts (UPI)", text: (rs: string) => `Payment-app (UPI) receipts above ${rs} a month for 6 months` },
  { value: "on_time", label: "Pays on time", text: (rs: string) => `Pays invoices on time, about ${rs} a month on 30-day credit` },
];

const MONTH_LABELS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function IssuerPage() {
  const role = useRole();
  const acct = accountOf(role); // shopkeepers have no Stellar account
  const me = acct?.address ?? "";
  const isIssuerRole = !!acct?.kind;

  const registry = useQuery(() => contract.getIssuer(me), [me]);
  const config = useQuery(() => contract.getConfig());
  const balance = useQuery(() => contract.getBalance(me), [me]);
  const now = useQuery(() => contract.getNow());
  const shops = useQuery(() => backend.getShops());
  const mine = useQuery(async () => {
    const shopIds = await contract.listShopsWithCredentials();
    const lists = await Promise.all(shopIds.map((s) => contract.getCredentials(s)));
    return lists.flat().filter((v) => v.credential.issuer === me);
  }, [me]);

  const [shopId, setShopId] = useState("shop-1");
  const shopName = (id: string) => (shops.data ?? []).find((s) => s.id === id)?.name ?? id;
  const [claimType, setClaimType] = useState("buyer");
  const [amount, setAmount] = useState(45000);
  const [edited, setEdited] = useState<string | null>(null); // the summary, once you type in it yourself
  const [busy, setBusy] = useState<string | null>(null);
  const blank6 = () => ["", "", "", "", "", ""];
  const [months, setMonths] = useState<string[]>(blank6()); // supplier says: 6 monthly totals
  const [refund, setRefund] = useState("");
  const [receipts, setReceipts] = useState<string[]>(blank6()); // payment app: money in, per month
  const [payees, setPayees] = useState([{ account: "", out: blank6(), back: blank6() }]); // payment app: per payee account
  const says = useQuery(() => backend.getSupplierSays(me, shopId), [me, shopId]);
  const feed = useQuery(() => backend.getPaymentFeed(me, shopId), [me, shopId]);
  const kind = registry.data?.kind;

  const template = CLAIM_TYPES.find((c) => c.value === claimType)!.text(inr(amount || 0));
  const summary = edited ?? template;
  const stake = config.data?.stakeAmount;

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const issue = () => run("issue", async () => {
    // The fingerprint of the evidence. Only this hash goes on-chain, never the evidence itself.
    const hash = await claimHash({ shop_id: shopId, issuer: me, claim_type: claimType, summary, monthly_amount_inr: amount });
    const { result, hash: tx, onchain } = await contract.issueCredential(me, shopId, claimType, summary, hash);
    await backend.syncChecks(shopId); // the backend checks the claim against the evidence
    txToast(`Credential #${result} issued. ${stake ? usdc(stake) : "Stake"} locked.`, tx, onchain);
  });

  const saveSays = () => run("says", async () => {
    await backend.submitSupplierSays(me, shopId, months.map((m) => Number(m || 0)), Number(refund || 0));
    toast.success("Saved as \"Supplier says\". The checks do not use it.");
  });

  const saveFeed = () => run("feed", async () => {
    const rows = payees.filter((p) => p.account.trim());
    await backend.submitPaymentFeed(me, shopId, MONTH_LABELS.map((_, i) => ({
      receipts: Number(receipts[i] || 0),
      payees: Object.fromEntries(rows.map((p) => [p.account.trim(), { out: Number(p.out[i] || 0), back: Number(p.back[i] || 0) }])),
    })));
    toast.success("Payment records saved. Checks updated.");
  });
  const setPayee = (n: number, patch: Partial<(typeof payees)[number]>) => setPayees((prev) => prev.map((p, j) => (j === n ? { ...p, ...patch } : p)));
  const setCell = (n: number, field: "out" | "back", i: number, v: string) => setPayee(n, { [field]: payees[n][field].map((x, j) => (j === i ? digits(v) : x)) });

  const revoke = (id: number) => run(`revoke-${id}`, async () => {
    const { hash, onchain } = await contract.revoke(me, id);
    txToast(`Credential #${id} revoked`, hash, onchain);
  });

  const release = (id: number) => run(`release-${id}`, async () => {
    const { result, hash } = await contract.releaseStake(me, id);
    txToast(`Credential #${id}: ${usdc(result)} returned`, hash);
  });

  return (
    <div className="space-y-12">
      <PageTitle title="Vouch for a shop you trade with">
        Each claim locks a {stake ? usdc(stake) : "30 USDC"} stake.
      </PageTitle>

      {!isIssuerRole && (
        <Notice tone="warn">
          You are {PERSONAS[role].label}, not an issuer. Switch to{" "}
          {ISSUER_PERSONAS.map((r, i) => (
            <span key={r}>
              {i > 0 && (i === ISSUER_PERSONAS.length - 1 ? ", or " : ", ")}
              <button className="font-medium underline underline-offset-4" onClick={() => setRole(r)}>{PERSONAS[r].label}</button>
            </span>
          ))}
          .
        </Notice>
      )}

      <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="You are" value={PERSONAS[role].label.split(" (")[0]} />
        <div>
          <dt className="text-sm text-quiet">In the issuer registry</dt>
          <dd className="mt-2">
            {registry.loading ? <Skeleton /> : registry.data === null ? <Badge state="fail">Not approved</Badge> : registry.data?.active ? <Badge state="pass">Approved</Badge> : <Badge state="suspended">Suspended</Badge>}
          </dd>
        </div>
        <Stat label="Disputes upheld against you" value={registry.data ? `${registry.data.upheldClaims} of 2` : "–"} hint="Two suspend you" />
        <Stat label="Your USDC balance" value={balance.data === undefined ? <Skeleton /> : usdc(balance.data)} />
      </dl>

      {/* Not in the registry yet: the application flow (form, emailed code, sign, wait for the admin). */}
      {registry.data === null && isIssuerRole && <ApplyToJoin role={role as RoleId} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
        <div className="space-y-10 self-start">
        <Panel className="space-y-6">
          <h2 className="text-lg font-medium tracking-tight">Issue a credential</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop" hint="A shop is just a name here. It never signs or pays.">
              <select className={inputClass} value={shopId} onChange={(e) => setShopId(e.target.value)}>
                {(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
              </select>
            </Field>
            <Field label="Claim type">
              <select className={inputClass} value={claimType} onChange={(e) => { setClaimType(e.target.value); setEdited(null); }}>
                {CLAIM_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Amount (₹ per month)" hint="At least 70% must match real payments.">
            <input className={inputClass} type="number" min={0} step={1000} value={amount} onChange={(e) => { setAmount(Number(e.target.value)); setEdited(null); }} />
          </Field>
          <Field label="Summary (public)" hint="A one-line conclusion. Never put raw data or personal details here.">
            <textarea className={inputClass} rows={2} value={summary} onChange={(e) => setEdited(e.target.value)} />
          </Field>
          <p className="flex gap-4 rounded-(--radius-control) bg-wash px-4 py-4 text-sm leading-relaxed text-quiet">
            <Lock className="mt-1 size-4 shrink-0 text-pine" aria-hidden />
            <span>Signing locks <b className="font-medium text-ink">{stake ? usdc(stake) : "30 USDC"}</b> (a digital US dollar{stake ? `, about ${usdcCad(stake)}` : ""}) in the contract until this credential expires, after 90 days. You get it back unless a dispute against you is upheld.</span>
          </p>
          <Button onClick={issue} disabled={busy !== null || !summary || !shopId} loading={busy === "issue"} className="w-full">
            {busy === "issue" ? "Signing…" : `Sign and issue, locking ${stake ? usdc(stake) : "the stake"}`}
          </Button>
        </Panel>

        {kind === "PaymentProvider" ? (
        <Panel className="space-y-6">
          <h2 className="text-lg font-medium tracking-tight">Share payment records for {shopName(shopId)}</h2>
          <p className="text-sm text-quiet">These are the numbers the checks use to judge supplier claims (and your own). Only claims backed by payment-app records earn fees.</p>
          <Field label="Money in to the shop each month (₹)" hint="Everything that came in, including transfers back from payees.">
            <div className="grid grid-cols-3 gap-4">
              {MONTH_LABELS.map((m, i) => (
                <label key={m} className="text-xs text-quiet">{m}
                  <input className={`${inputClass} mt-1`} inputMode="numeric" value={receipts[i]} placeholder="0"
                    onChange={(e) => setReceipts((prev) => prev.map((x, j) => (j === i ? digits(e.target.value) : x)))} />
                </label>
              ))}
            </div>
          </Field>
          {payees.map((p, n) => (
            <div key={n} className="space-y-4 rounded-(--radius-control) border border-line p-4">
              <Field label={`Payee account ${n + 1}`} hint="The account the shop paid, e.g. a supplier's verified bank account.">
                <input className={inputClass} value={p.account} placeholder="ICIC-0009012-11122233" onChange={(e) => setPayee(n, { account: e.target.value })} />
              </Field>
              {(["out", "back"] as const).map((field) => (
                <Field key={field} label={field === "out" ? "Shop paid out each month (₹)" : "Came back from this account each month (₹)"}>
                  <div className="grid grid-cols-3 gap-4">
                    {MONTH_LABELS.map((m, i) => (
                      <label key={m} className="text-xs text-quiet">{m}
                        <input className={`${inputClass} mt-1`} inputMode="numeric" value={p[field][i]} placeholder="0" onChange={(e) => setCell(n, field, i, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </Field>
              ))}
            </div>
          ))}
          <Button variant="secondary" onClick={() => setPayees((prev) => [...prev, { account: "", out: blank6(), back: blank6() }])} disabled={payees.length >= 10}>Add another payee account</Button>
          {feed.data && <p className="text-sm text-quiet">Saved: {inr(Math.round(feed.data.months.reduce((t, m) => t + m.receipts, 0) / 6))} a month in, on average.</p>}
          <Button onClick={saveFeed} disabled={busy !== null || !shopId || !isIssuerRole || !registry.data || !receipts.some((m) => Number(m) > 0)} loading={busy === "feed"} className="w-full">
            {busy === "feed" ? "Saving…" : "Save payment records"}
          </Button>
        </Panel>
        ) : (
        <Panel className="space-y-6">
          <h2 className="text-lg font-medium tracking-tight">What you say you sold {shopName(shopId)}</h2>
          <p className="text-sm text-quiet">Shown to lenders as &ldquo;Supplier says&rdquo;. It never passes a check: payment-app records of what the shop paid your verified account do.</p>
          <Field label="Shop's purchases from you each month (₹)">
            <div className="grid grid-cols-3 gap-4">
              {MONTH_LABELS.map((m, i) => (
                <label key={m} className="text-xs text-quiet">{m}
                  <input className={`${inputClass} mt-1`} inputMode="numeric" value={months[i]} placeholder="0"
                    onChange={(e) => setMonths((prev) => prev.map((x, j) => (j === i ? digits(e.target.value) : x)))} />
                </label>
              ))}
            </div>
          </Field>
          <Field label="Sent back to the shop each month (₹)" hint="Refunds, returns. Shown as what you say; the checks use the payment app's numbers.">
            <input className={inputClass} inputMode="numeric" value={refund} placeholder="0" onChange={(e) => setRefund(digits(e.target.value))} />
          </Field>
          {says.data && <p className="text-sm text-quiet">Saved: {inr(Math.round(says.data.months.reduce((t, n) => t + n, 0) / 6))} a month on average (supplier says).</p>}
          <Button onClick={saveSays} disabled={busy !== null || !shopId || !isIssuerRole || !registry.data || !months.some((m) => Number(m) > 0)} loading={busy === "says"} className="w-full">
            {busy === "says" ? "Saving…" : "Save what I say"}
          </Button>
        </Panel>
        )}
        </div>

        <Section title="Your credentials" className="self-start">
          {mine.error && <QueryError what="your credentials" onRetry={mine.retry} />}
          {!mine.error && !mine.loading && (mine.data ?? []).length === 0 && (
            <EmptyState title="No credentials yet">
              Fill in the form to vouch for your first shop. Each credential locks {stake ? usdc(stake) : "a stake"} until it expires.
            </EmptyState>
          )}
          <div className="space-y-4">
            {(mine.data ?? []).map((v) => {
              const c = v.credential;
              const expired = now.data !== undefined && now.data >= c.expiresAt;
              return (
                <article key={c.id} className="space-y-4 rounded-(--radius-panel) border border-line bg-surface p-6">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base font-medium">{shopName(c.shopId)} <span className="text-xs font-normal text-faint">{c.shopId}</span></h3>
                    <Badge state={v.status} />
                  </div>
                  <p className="text-base">&ldquo;{c.summary}&rdquo;</p>
                  {v.status === "Valid" && (
                    <p className={`flex items-center gap-2 text-sm ${c.passed ? "text-pine" : "text-quiet"}`}>
                      {c.passed ? <CircleCheck className="size-4 shrink-0" aria-hidden /> : <CircleDashed className="size-4 shrink-0" aria-hidden />}
                      {c.passed ? "Earning fees." : "Not earning yet. The checks need payment-app records for this shop."}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-quiet">Credential</dt><dd className="text-right">#{c.id}</dd>
                    <dt className="text-quiet">Expires</dt><dd className="text-right">{formatDate(c.expiresAt)}</dd>
                    <dt className="text-quiet">Stake locked</dt><dd className="text-right">{c.stake > 0 ? usdc(c.stake) : "None (released or slashed)"}</dd>
                    <dt className="text-quiet">Evidence hash</dt><dd className="text-right"><Hash value={c.claimHash} label="evidence hash" /></dd>
                  </dl>
                  <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row">
                    {!c.revoked && <Button variant="secondary" disabled={busy !== null} loading={busy === `revoke-${c.id}`} onClick={() => revoke(c.id)}>Revoke</Button>}
                    <Button variant="secondary" disabled={busy !== null || c.stake === 0} loading={busy === `release-${c.id}`}
                      title={expired ? undefined : "The stake stays locked until the credential expires. Move the date forward from the Admin test tools."}
                      onClick={() => release(c.id)}>
                      Release stake
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </Section>
      </div>

      {acct && <ActivityLog caller={acct.name} title="Your transactions" />}
    </div>
  );
}
