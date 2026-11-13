"use client";
// ADMIN: reviews applications to join (fraud check 1) and decides disputes (the stake slash, fraud check 5).
// Contract functions used: add_issuer, reject_issuer, suspend_issuer (mock-only), resolve_dispute,
// and the reads get_credentials / get_issuer / balances. Applications are in components/Applications.tsx.
import { useState } from "react";
import { CONTRACT_ADDRESS, contract, nameOf, type Dispute, type Issuer } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, accountOf, setRole, useRole } from "@/lib/session";
import { usdc, short } from "@/lib/format";
import { Badge, Button, Notice, PageTitle, Panel, Rows, Section, Skeleton } from "@/components/ui";
import { Applications } from "@/components/Applications";
import { ShopReviewPanel } from "@/components/ShopReviewPanel";
import { TestTools } from "@/components/TestTools";
import { OnChainPanel } from "@/components/OnChainPanel";
import { ActivityLog } from "@/components/ActivityLog";
import { SystemLog } from "@/components/SystemLog";
import { errorToast, txToast } from "@/components/toast";
import { TxRef } from "@/components/TxRef";

interface Snapshot { lender: number; escrow: number; issuer: Issuer | null }
interface Outcome { id: number; upheld: boolean; hash: string; onchain: boolean; issuerName: string; before: Snapshot; after: Snapshot }

export default function AdminPage() {
  const role = useRole();
  const me = accountOf(role)?.address ?? "";
  const isAdmin = role === "admin";

  const issuers = useQuery(() => contract.listIssuers());
  const disputes = useQuery(() => contract.listDisputes());
  const credentials = useQuery(async () => {
    // The contract has no "list everything" function, so we ask shop by shop (see CONNECT notes in lib/mock/contract.ts).
    const shops = await contract.listShopsWithCredentials();
    return (await Promise.all(shops.map((s) => contract.getCredentials(s)))).flat();
  });
  const escrow = useQuery(() => contract.getBalance(CONTRACT_ADDRESS));

  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const suspend = (i: Issuer) => run(`suspend-${i.address}`, async () => {
    const { hash } = await contract.suspendIssuer(me, i.address);
    txToast(`${i.name} suspended`, hash);
  });

  async function snapshot(d: Dispute, issuer: string): Promise<Snapshot> {
    const [lender, escrowBal, iss] = await Promise.all([contract.getBalance(d.lender), contract.getBalance(CONTRACT_ADDRESS), contract.getIssuer(issuer)]);
    return { lender, escrow: escrowBal, issuer: iss };
  }

  const resolve = (d: Dispute, upheld: boolean) => run(`${d.id}-${upheld}`, async () => {
    const cred = credentials.data?.find((c) => c.credential.id === d.credentialId);
    const issuerAddr = cred?.credential.issuer ?? "";
    const before = await snapshot(d, issuerAddr);
    const { hash, onchain } = await contract.resolveDispute(me, d.id, upheld);
    const after = await snapshot(d, issuerAddr);
    setOutcome({ id: d.id, upheld, hash, onchain: !!onchain, issuerName: cred?.issuerName ?? "issuer", before, after });
    txToast(upheld ? `Dispute #${d.id} upheld: stake slashed to the lender` : `Dispute #${d.id} rejected`, hash, onchain);
  });

  return (
    <div className="space-y-12">
      <PageTitle title="Admin">
        Approve issuers and settle disputes. Two upheld disputes suspend an issuer.
      </PageTitle>

      <nav aria-label="On this page" className="-mx-6 flex gap-1 overflow-x-auto border-b border-line px-6 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
        {[["#applications", "Applications"], ["#issuers", "Issuers"], ["#shops", "Shop checks"], ["#disputes", "Disputes"], ["#tools", "Test tools"], ["#logs", "Logs"]].map(([href, label]) => (
          <a key={href} href={href} className="shrink-0 border-b-2 border-transparent px-4 py-4 text-sm font-medium text-quiet hover:border-pine hover:text-ink">{label}</a>
        ))}
      </nav>

      {!isAdmin && (
        <Notice tone="warn">
          You are {PERSONAS[role].label}, not the admin. <button className="font-medium underline underline-offset-4" onClick={() => setRole("admin")}>Switch to the admin</button>.
          The buttons still work, so you can see the contract refuse you with NotAdmin.
        </Notice>
      )}

      {outcome && <OutcomePanel o={outcome} />}

      <div id="applications" className="scroll-mt-24"><Applications /></div>

      <Section id="issuers" title="Issuer registry" aside="Fraud check 1: only approved issuers can sign">
        {(issuers.data ?? []).length === 0 ? (
          <p className="text-sm text-quiet">No issuers yet. Until an application is approved, the contract rejects every credential.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-quiet">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4 font-medium">Issuer</th>
                  <th scope="col" className="pr-4 font-medium">Kind</th>
                  <th scope="col" className="pr-4 font-medium">Disputes upheld</th>
                  <th scope="col" className="pr-4 font-medium">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {issuers.data!.map((i) => (
                  <tr key={i.address}>
                    <td className="py-4 pr-4"><div className="font-medium">{i.name}</div><div className="text-xs text-faint">{short(i.address)}</div></td>
                    <td className="pr-4">{i.kind === "Supplier" ? "Supplier" : "Payment app"}</td>
                    <td className="pr-4 tabular-nums">{i.upheldClaims} of 2</td>
                    <td className="pr-4"><Badge state={i.active ? "active" : "suspended"}>{i.active ? "Active" : "Suspended"}</Badge></td>
                    <td className="text-right">
                      {i.active && <Button variant="secondary" disabled={busy !== null} onClick={() => suspend(i)} title="Prototype only: the contract suspends automatically after 2 upheld disputes">Suspend</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ShopReviewPanel />

      <Section id="disputes" title="Disputes" aside={<>Stakes held by the contract: {escrow.data === undefined ? <Skeleton className="h-4 w-16" /> : usdc(escrow.data)}</>}>
        {(disputes.data ?? []).length === 0 && <p className="text-sm text-quiet">No disputes yet. Lenders open them from the Lender page.</p>}
        <Rows>
          {(disputes.data ?? []).map((d) => {
            const c = credentials.data?.find((x) => x.credential.id === d.credentialId);
            return (
              <div key={d.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-medium">Dispute {d.id}</span>
                    {d.resolved ? <Badge state={d.upheld ? "failed" : "pass"}>{d.upheld ? "Upheld" : "Rejected"}</Badge> : <Badge state="open">Open</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-quiet">
                    {nameOf(d.lender)} disputes credential {d.credentialId}
                    {c && <> from {c.issuerName}: &ldquo;{c.credential.summary}&rdquo;</>}
                  </p>
                  {c && <p className="text-sm text-quiet">Stake still locked: {usdc(c.credential.stake)}. Status: {c.status.toLowerCase()}.</p>}
                  {!d.resolved && <p className="text-xs text-faint">Upholding needs a lender to have reported that the shop defaulted. Otherwise the contract refuses.</p>}
                </div>
                {!d.resolved && (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" disabled={busy !== null} onClick={() => resolve(d, false)}>{busy === `${d.id}-false` ? "…" : "Reject"}</Button>
                    <Button variant="danger" disabled={busy !== null} onClick={() => resolve(d, true)}>{busy === `${d.id}-true` ? "Slashing…" : "Uphold and slash"}</Button>
                  </div>
                )}
              </div>
            );
          })}
        </Rows>
      </Section>

      <OnChainPanel />

      <TestTools />

      <Section id="logs" title="Logs" className="space-y-6">
        <ActivityLog />
        <SystemLog />
      </Section>
    </div>
  );
}

function OutcomePanel({ o }: { o: Outcome }) {
  const rows: [string, string, string][] = [
    ["Lender USDC", usdc(o.before.lender), usdc(o.after.lender)],
    ["Stakes held by the contract", usdc(o.before.escrow), usdc(o.after.escrow)],
    [`${o.issuerName}: disputes upheld`, `${o.before.issuer?.upheldClaims ?? 0} of 2`, `${o.after.issuer?.upheldClaims ?? 0} of 2`],
    [`${o.issuerName}: status`, o.before.issuer?.active ? "Active" : "Suspended", o.after.issuer?.active ? "Active" : "Suspended"],
  ];
  return (
    <Panel>
      <h2 className="text-lg font-medium tracking-tight">Dispute {o.id} {o.upheld ? "upheld: stake slashed" : "rejected: nothing moved"}</h2>
      <div className="relative mt-4 overflow-x-auto">
        <table className="w-full min-w-[24rem] text-left text-sm">
          <thead className="text-quiet"><tr className="border-b border-line"><th scope="col" className="py-2 font-medium"><span className="sr-only">Item</span></th><th scope="col" className="font-medium">Before</th><th scope="col" className="font-medium">After</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, b, a]) => (
              <tr key={label}>
                <td className="py-2 pr-4 font-medium">{label}</td>
                <td className="pr-4 tabular-nums text-quiet">{b}</td>
                <td className={`tabular-nums ${a !== b ? "font-medium text-clay" : ""}`}>{a}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-faint"><TxRef hash={o.hash} onchain={o.onchain} label="Transaction hash" /></p>
    </Panel>
  );
}
