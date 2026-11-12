"use client";
// ISSUER (supplier or payment provider): signs credentials about shops and locks a stake behind each.
// Contract functions used: issue_credential, revoke, release_stake, and reads get_issuer / get_credentials / get_config.
import { useState } from "react";
import { backend, claimHash, contract, type RoleId } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { ISSUER_PERSONAS, PERSONAS, accountOf, setRole, useRole } from "@/lib/session";
import { usdc, usdcCad, formatDate } from "@/lib/format";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Field, Notice, PageTitle, Panel, Rows, Section, Stat, inputClass } from "@/components/ui";
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
  const [claimType, setClaimType] = useState("buyer");
  const [amount, setAmount] = useState(45000);
  const [edited, setEdited] = useState<string | null>(null); // the summary, once you type in it yourself
  const [busy, setBusy] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>(["", "", "", "", "", ""]); // evidence: 6 monthly totals
  const [refund, setRefund] = useState("");
  const evidence = useQuery(() => backend.getEvidence(me, shopId), [me, shopId]);
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
    const { result, hash: tx } = await contract.issueCredential(me, shopId, claimType, summary, hash);
    await backend.syncChecks(shopId); // the backend checks the claim against the evidence
    txToast(`Credential #${result} issued. ${stake ? usdc(stake) : "Stake"} locked.`, tx);
  });

  const saveEvidence = () => run("evidence", async () => {
    await backend.submitEvidence(me, shopId, months.map((m) => Number(m || 0)), Number(refund || 0));
    toast.success("Evidence saved. Checks updated.");
  });

  const revoke = (id: number) => run(`revoke-${id}`, async () => {
    const { hash } = await contract.revoke(me, id);
    txToast(`Credential #${id} revoked`, hash);
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
            {registry.loading ? "…" : registry.data === null ? <Badge state="fail">Not approved</Badge> : registry.data?.active ? <Badge state="pass">Approved</Badge> : <Badge state="suspended">Suspended</Badge>}
          </dd>
        </div>
        <Stat label="Disputes upheld against you" value={registry.data ? `${registry.data.upheldClaims} of 2` : "–"} hint="Two suspend you" />
        <Stat label="Your USDC balance" value={balance.data === undefined ? "…" : usdc(balance.data)} />
      </dl>

      {/* Not in the registry yet: the application flow (form, emailed code, sign, wait for the admin). */}
      {registry.data === null && isIssuerRole && <ApplyToJoin role={role as RoleId} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-14">
        <div className="space-y-10 self-start">
        <Panel className="space-y-5">
          <h2 className="text-lg font-medium tracking-tight">Issue a credential</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop ID" hint="A shop is just a name here. It never signs or pays.">
              <input className={inputClass} list="shop-ids" value={shopId} onChange={(e) => setShopId(e.target.value.trim())} />
              <datalist id="shop-ids">{(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</datalist>
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
          <p className="flex gap-3 border-l-2 border-pine pl-4 text-sm leading-relaxed text-quiet">
            <Lock className="mt-0.5 size-4 shrink-0 text-pine" aria-hidden />
            <span>Signing locks <b className="font-medium text-ink">{stake ? usdc(stake) : "30 USDC"}</b> (a digital US dollar{stake ? `, about ${usdcCad(stake)}` : ""}) in the contract until this credential expires, after 90 days. You get it back unless a dispute against you is upheld.</span>
          </p>
          <Button onClick={issue} disabled={busy !== null || !summary || !shopId} className="w-full">
            {busy === "issue" ? "Signing…" : `Sign and issue, locking ${stake ? usdc(stake) : "the stake"}`}
          </Button>
        </Panel>

        <Panel className="space-y-5">
          <h2 className="text-lg font-medium tracking-tight">Add evidence for {shopId || "a shop"}</h2>
          <p className="text-sm text-quiet">Only claims backed by evidence earn fees.</p>
          <Field label={kind === "PaymentProvider" ? "Payments settled to the shop each month (₹)" : "Shop's purchases from you each month (₹)"}>
            <div className="grid grid-cols-3 gap-3">
              {MONTH_LABELS.map((m, i) => (
                <label key={m} className="text-xs text-quiet">{m}
                  <input className={`${inputClass} mt-1`} inputMode="numeric" value={months[i]} placeholder="0"
                    onChange={(e) => setMonths((prev) => prev.map((x, j) => (j === i ? digits(e.target.value) : x)))} />
                </label>
              ))}
            </div>
          </Field>
          <Field label="Sent back to the shop each month (₹)" hint="Refunds, returns. Money that comes straight back doesn't count.">
            <input className={inputClass} inputMode="numeric" value={refund} placeholder="0" onChange={(e) => setRefund(digits(e.target.value))} />
          </Field>
          {evidence.data && <p className="text-sm text-quiet">Saved: {inr(Math.round(evidence.data.months.reduce((t, n) => t + n, 0) / 6))} a month on average.</p>}
          <Button onClick={saveEvidence} disabled={busy !== null || !shopId || !isIssuerRole || !registry.data} className="w-full">
            {busy === "evidence" ? "Saving…" : "Save evidence"}
          </Button>
        </Panel>
        </div>

        <Section title="Your credentials" className="self-start">
          {(mine.data ?? []).length === 0 && <p className="text-sm text-quiet">None yet.</p>}
          <Rows>
            {(mine.data ?? []).map((v) => {
              const c = v.credential;
              const expired = now.data !== undefined && now.data >= c.expiresAt;
              return (
                <div key={c.id} className="space-y-2 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{c.shopId}, credential {c.id}</span>
                    <Badge state={v.status} />
                  </div>
                  <p className="text-sm">&ldquo;{c.summary}&rdquo;</p>
                  <p className="text-sm text-quiet">Expires {formatDate(c.expiresAt)}. Stake locked: {usdc(c.stake)}.</p>
                  {v.status === "Valid" && <p className={`text-sm ${c.passed ? "text-pine" : "text-quiet"}`}>{c.passed ? "Earning fees." : "Not earning yet. Add evidence for this shop."}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!c.revoked && <Button variant="secondary" disabled={busy !== null} onClick={() => revoke(c.id)}>{busy === `revoke-${c.id}` ? "…" : "Revoke"}</Button>}
                    <Button variant="secondary" disabled={busy !== null || c.stake === 0}
                      title={expired ? undefined : "The stake stays locked until the credential expires. Move the date forward from the Admin test tools."}
                      onClick={() => release(c.id)}>
                      {busy === `release-${c.id}` ? "…" : "Release stake"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Rows>
        </Section>
      </div>
    </div>
  );
}
