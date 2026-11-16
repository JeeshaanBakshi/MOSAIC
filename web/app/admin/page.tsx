"use client";
// ADMIN: reviews applications to join (fraud check 1) and decides disputes (the stake slash, fraud check 5).
// Contract functions used: add_issuer, reject_issuer, suspend_issuer (mock-only), resolve_dispute,
// and the reads get_credentials / get_issuer / balances. Applications are in components/Applications.tsx.
import { useState } from "react";
import { CONTRACT_ADDRESS, backend, contract, nameOf, type Dispute, type Issuer } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, accountOf, setRole, useRole } from "@/lib/session";
import { usdc, short } from "@/lib/format";
import { Badge, Button, Notice, PageTitle, Panel, Skeleton } from "@/components/ui";
import { Applications } from "@/components/Applications";
import { ShopReviewPanel } from "@/components/ShopReviewPanel";
import { EvidenceAttention } from "@/components/EvidenceAdmin";
import { ReliabilityBadge } from "@/components/EvidenceBits";
import { TabPanel, Tabs } from "@/components/Tabs";
import { CaseFiles } from "@/components/CaseFiles";
import { TestTools } from "@/components/TestTools";
import { OnChainPanel } from "@/components/OnChainPanel";
import { ActivityLog } from "@/components/ActivityLog";
import { SystemLog } from "@/components/SystemLog";
import { errorToast, txToast } from "@/components/toast";
import { TxRef } from "@/components/TxRef";

type AdminTab = "applications" | "issuers" | "cases" | "shops" | "evidence" | "disputes" | "onchain" | "tools";

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
  const reliability = useQuery(() => backend.listIssuerReliability());
  const cases = useQuery(() => backend.getCases({ status: "open" }));
  const evidence = useQuery(() => backend.getEvidenceAttention());
  const requests = useQuery(() => contract.listIssuerRequests());
  const [tab, setTab] = useState<AdminTab>("applications");

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

  const openDisputes = (disputes.data ?? []).filter((d) => !d.resolved).length;
  const waiting = (requests.data ?? []).filter((r) => r.status === "Pending").length;
  const relOf = (a: string) => reliability.data?.find((r) => r.address === a);

  return (
    <div className="space-y-8">
      <PageTitle title="Admin" />

      <Tabs label="Admin sections" active={tab} onChange={setTab} tabs={[
        { id: "applications", label: "Applications", count: waiting },
        { id: "issuers", label: "Issuers" },
        { id: "cases", label: "Cases", count: cases.data?.length },
        { id: "shops", label: "Shop checks" },
        { id: "evidence", label: "Evidence", count: evidence.data?.length },
        { id: "disputes", label: "Disputes", count: openDisputes },
        { id: "onchain", label: "On-chain" },
        { id: "tools", label: "Tools and logs" },
      ]} />

      {!isAdmin && (
        <Notice tone="warn">
          You are {PERSONAS[role].label}, not the admin. <button className="font-medium underline underline-offset-4" onClick={() => setRole("admin")}>Switch to the admin</button>.
        </Notice>
      )}

      <TabPanel id="applications" active={tab}><Applications /></TabPanel>

      <TabPanel id="issuers" active={tab}>
        <div id="issuers" className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Issuer registry</h2>
          {(issuers.data ?? []).length === 0 ? (
            <p className="text-sm text-quiet">No issuers yet.</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="dtable min-w-[44rem]">
                <thead>
                  <tr>
                    <th scope="col">Issuer</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reliability</th>
                    <th scope="col" className="text-right">Warnings</th>
                    <th scope="col" className="text-right">Upheld</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {issuers.data!.map((i) => {
                    const r = relOf(i.address);
                    return (
                      <tr key={i.address}>
                        <td><div className="font-medium">{i.name}</div><div className="text-xs text-faint">{short(i.address)}</div></td>
                        <td>{i.kind === "Supplier" ? "Supplier" : "Payment app"}</td>
                        <td><Badge state={i.active ? "active" : "suspended"}>{i.active ? "Active" : "Suspended"}</Badge></td>
                        <td>{r ? <span title={r.reasons.join(" ")}><ReliabilityBadge category={r.category} /></span> : <Skeleton className="h-5 w-20" />}{r && <div className="mt-1 text-xs text-faint">{r.metrics.credentialsIssued} issued · {r.metrics.confirmed} confirmed · {r.metrics.rejected + r.metrics.disputed} rejected or disputed</div>}</td>
                        <td className="t-num text-right">{r ? `${r.metrics.warnings} of 3` : "-"}</td>
                        <td className="t-num text-right">{i.upheldClaims} of 2</td>
                        <td className="text-right">
                          {i.active && <Button variant="secondary" disabled={busy !== null} onClick={() => suspend(i)} title="Prototype only: the contract suspends automatically after 2 upheld disputes">Suspend</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </TabPanel>

      <TabPanel id="cases" active={tab}><CaseFiles /></TabPanel>

      <TabPanel id="shops" active={tab}><div id="shops"><ShopReviewPanel /></div></TabPanel>

      <TabPanel id="evidence" active={tab}>
        <h2 className="text-lg font-medium tracking-tight">Evidence needing a person ({(evidence.data ?? []).length})</h2>
        <EvidenceAttention />
      </TabPanel>

      <TabPanel id="disputes" active={tab}>
        {outcome && <OutcomePanel o={outcome} />}
        <div id="disputes" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-medium tracking-tight">Disputes</h2>
            <span className="text-sm text-quiet">Stakes held: {escrow.data === undefined ? <Skeleton className="h-4 w-16" /> : usdc(escrow.data)}</span>
          </div>
          {(disputes.data ?? []).length === 0 && <p className="text-sm text-quiet">No disputes yet. Lenders open them from the Lender page.</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {(disputes.data ?? []).map((d) => {
              const c = credentials.data?.find((x) => x.credential.id === d.credentialId);
              return (
                <article key={d.id} className="space-y-3 rounded-(--radius-panel) border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-medium">Dispute {d.id}</span>
                    {d.resolved ? <Badge state={d.upheld ? "failed" : "pass"}>{d.upheld ? "Upheld" : "Rejected"}</Badge> : <Badge state="open">Open</Badge>}
                  </div>
                  <p className="text-sm text-quiet">{nameOf(d.lender)} · credential {d.credentialId}{c && <> · {c.issuerName}</>}</p>
                  {c && <p className="text-sm text-quiet">Stake {usdc(c.credential.stake)} · {c.status.toLowerCase()}</p>}
                  {!d.resolved && (
                    <>
                      <p className="text-xs text-faint">Upholding needs a reported default.</p>
                      <div className="flex gap-2">
                        <Button variant="secondary" disabled={busy !== null} onClick={() => resolve(d, false)}>{busy === `${d.id}-false` ? "…" : "Reject"}</Button>
                        <Button variant="danger" disabled={busy !== null} onClick={() => resolve(d, true)}>{busy === `${d.id}-true` ? "Slashing…" : "Uphold and slash"}</Button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="onchain" active={tab}><OnChainPanel /></TabPanel>

      <TabPanel id="tools" active={tab}>
        <TestTools />
        <div className="grid gap-8 lg:grid-cols-2">
          <ActivityLog />
          <SystemLog />
        </div>
      </TabPanel>
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
