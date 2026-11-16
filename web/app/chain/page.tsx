"use client";
// TESTNET INSPECTOR: everything the deployed MOSAIC contract holds and every transaction that called it, read live from
// Stellar testnet (/api/chain). Nothing here comes from the website's simulation, so it is the ground truth the other
// pages are compared with. It refreshes by itself every few seconds.
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate, short, txUrl, usdc } from "@/lib/format";
import type { ChainSnapshot, ChainTx } from "@/lib/server/chainState";
import { Badge, Notice, PageTitle, Panel, Rows, Section, Skeleton } from "@/components/ui";
import { TabPanel, Tabs } from "@/components/Tabs";

type Rec = Record<string, unknown>;
const POLL_MS = 8000;
const num = (v: unknown) => Number(v ?? 0);

export default function ChainPage() {
  const [tab, setTab] = useState<"overview" | "credentials" | "transactions">("overview");
  const [snap, setSnap] = useState<ChainSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // set by a timer each second (never during the first render), so "read Ns ago" counts up

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/chain", { cache: "no-store" });
        const json = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(json.error ?? "Could not read Stellar testnet.");
        setSnap(json); setError(null);
      } catch (e) { if (!stop) setError(e instanceof Error ? e.message : "Could not read Stellar testnet."); }
    }
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(poll); clearInterval(tick); };
  }, []);

  const age = snap && now ? Math.max(0, Math.round((now - snap.fetchedAt) / 1000)) : 0;
  const who = (addr: string): string => snap?.participants[addr] ?? String(snap?.issuers.find((i) => i.address === addr)?.name ?? short(addr, 5));

  return (
    <div className="space-y-12">
      <PageTitle title="Stellar testnet inspector">
        Read live from the chain, not the website&apos;s simulation.
      </PageTitle>

      {error && <Notice tone="error"><b className="font-medium">Could not read the chain.</b> {error} Nothing was changed; it tries again automatically.</Notice>}
      {!snap && !error && <div className="space-y-4" aria-busy="true"><Skeleton className="block h-24 w-full" /><Skeleton className="block h-40 w-full" /></div>}

      {snap && (
        <>
          <Tabs label="Testnet sections" active={tab} onChange={setTab} tabs={[
            { id: "overview", label: "Overview" },
            { id: "credentials", label: "Credentials", count: snap.shops.reduce((n, s) => n + s.credentials.length, 0) },
            { id: "transactions", label: "Transactions", count: snap.history.length },
          ]} />

          {snap.problems.length > 0 && <Notice tone="warn"><b className="font-medium">Some reads failed:</b> {snap.problems.join(" · ")}</Notice>}

          <TabPanel id="overview" active={tab}>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Badge state="pass">Live on Stellar testnet</Badge>
                <span className="inline-flex items-center gap-2 text-sm text-quiet"><RefreshCw className="size-3.5" aria-hidden />Ledger {snap.latestLedger?.toLocaleString("en-US") ?? "?"}, read {age}s ago</span>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-8">
                <dt className="text-quiet">MOSAIC contract</dt>
                <dd className="min-w-0"><a href={`${snap.explorer}/contract/${snap.contractId}`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs text-pine underline underline-offset-4">{snap.contractId}<ExternalLink className="ml-1 inline size-3" aria-hidden /></a></dd>
                <dt className="text-quiet">Test USDC</dt>
                <dd className="min-w-0"><a href={`${snap.explorer}/contract/${snap.usdcId}`} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs text-pine underline underline-offset-4">{snap.usdcId}<ExternalLink className="ml-1 inline size-3" aria-hidden /></a></dd>
                <dt className="text-quiet">Stakes held</dt>
                <dd className="t-num">{snap.contractUsdc === null ? "could not read" : usdc(num(snap.contractUsdc))}</dd>
                {snap.config && (<><dt className="text-quiet">Contract settings</dt><dd>Fee {usdc(num(snap.config.verify_fee))} · {num(snap.config.issuer_share_bps) / 100}% to issuers · stake {usdc(num(snap.config.stake_amount))}</dd></>)}
              </dl>
            </Panel>

            <Match snap={snap} />

            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-lg font-medium tracking-tight">Issuers ({snap.issuers.length})</h2>
                <Rows>
                  {snap.issuers.map((i) => (
                    <div key={String(i.address)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                      <span className="font-medium">{String(i.name)}</span>
                      <Badge state={i.active ? "active" : "suspended"}>{i.active ? "Active" : "Suspended"}</Badge>
                      <span className="text-quiet">{String(i.kind)} · {num(i.upheld_claims)} of 2 upheld</span>
                    </div>
                  ))}
                  {snap.issuers.length === 0 && <p className="py-3 text-sm text-quiet">None on-chain.</p>}
                </Rows>
              </div>
              <div className="space-y-3">
                <h2 className="text-lg font-medium tracking-tight">Disputes ({snap.disputes.length})</h2>
                {snap.disputes.length === 0 ? <p className="text-sm text-quiet">None.</p> : (
                  <Rows>
                    {snap.disputes.map((d) => (
                      <div key={String(d.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                        <span className="font-medium">Dispute {String(d.id)} · credential {String(d.credential_id)}</span>
                        <Badge state={d.resolved ? (d.upheld ? "failed" : "pass") : "open"}>{d.resolved ? (d.upheld ? "Upheld" : "Rejected") : "Open"}</Badge>
                        <span className="text-quiet">{who(String(d.lender))}</span>
                      </div>
                    ))}
                  </Rows>
                )}
              </div>
            </div>
          </TabPanel>

          <TabPanel id="credentials" active={tab}>
            {snap.shops.map((s) => (
              <div key={s.id} className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="text-base font-medium">{s.id}</h3>
                  <span className="text-sm text-quiet">{s.credentials.length} credential{s.credentials.length === 1 ? "" : "s"} · {s.checksLast30Days ?? "?"} verify call{s.checksLast30Days === 1 ? "" : "s"} in 30 days</span>
                  {s.defaulted && <Badge state="fail">Default reported</Badge>}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {s.credentials.map((v) => <CredentialCard key={String((v.credential as Rec).id)} v={v} who={who} />)}
                </div>
              </div>
            ))}
          </TabPanel>

          <TabPanel id="transactions" active={tab}>
            <div className="relative overflow-x-auto">
              <table className="dtable min-w-[40rem]">
                <thead><tr><th>When (UTC)</th><th>Who</th><th>Function</th><th>USDC moved</th><th><span className="sr-only">Link</span></th></tr></thead>
                <tbody>{snap.history.map((h) => <TxRow key={h.id} h={h} who={who} />)}</tbody>
              </table>
            </div>
            <p className="text-xs text-quiet">The six demo accounts only. Others: see the contract on Stellar Expert.</p>
          </TabPanel>
        </>
      )}
    </div>
  );
}

/** The website's simulation next to the chain. They can differ (the website simulates the demo and mirrors the main actions). */
function Match({ snap }: { snap: ChainSnapshot }) {
  const sim = useQuery(async () => {
    const ids = await contract.listShopsWithCredentials();
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await contract.getCredentials(id)).length] as const)));
  });
  const rows = snap.shops.map((s) => ({ id: s.id, chain: s.credentials.length, site: sim.data ? sim.data[s.id] ?? 0 : undefined })); // a shop the website has never heard of has 0
  const allSame = !!sim.data && rows.every((r) => r.site === r.chain);
  return (
    <Section title="Does the website match the chain?" aside={sim.data ? (allSame ? <Badge state="pass">Same counts</Badge> : <Badge state="open">Different</Badge>) : undefined}>
      <Rows>
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="font-medium">{r.id}</span>
            <span className="text-quiet">website {r.site ?? "…"} credential{r.site === 1 ? "" : "s"} · chain {r.chain} credential{r.chain === 1 ? "" : "s"}</span>
          </div>
        ))}
      </Rows>
      <p className="mt-3 text-sm text-quiet">If these differ, the chain is the truth.</p>
    </Section>
  );
}

function CredentialCard({ v, who }: { v: Rec; who: (a: string) => string }) {
  const c = v.credential as Rec;
  const status = String(v.status);
  const decoded = { ...c, claim_hash: `0x${String(c.claim_hash).slice(0, 8)}…${String(c.claim_hash).slice(-6)}`, stake: `${c.stake}  // ${usdc(num(c.stake))} (7 decimal places)`, expires_at: `${c.expires_at}  // ${formatDate(num(c.expires_at))}`, issued_at: `${c.issued_at}  // ${formatDate(num(c.issued_at))}` };
  return (
    <article className="space-y-3 rounded-(--radius-panel) border border-line bg-surface p-5" data-credential={String(c.id)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium">#{String(c.id)} by {who(String(c.issuer))}</span>
        <Badge state={status}>{status}</Badge>
        <Badge state={c.passed ? "pass" : "unknown"}>{c.passed ? "Passed the backend checks" : "Not passed yet"}</Badge>
      </div>
      <p className="text-sm text-quiet">&ldquo;{String(c.summary)}&rdquo; Stake locked {usdc(num(c.stake))}, expires {formatDate(num(c.expires_at))}.</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-quiet underline underline-offset-4">Raw contract value (decoded)</summary>
        <pre className="mt-2 overflow-x-auto rounded-(--radius-control) bg-wash p-3 font-mono text-xs leading-relaxed">{JSON.stringify({ credential: decoded, status }, null, 2)}</pre>
        <p className="mt-2 text-xs text-quiet">claim_hash is a fingerprint; the evidence is never on-chain. Full hash: <span className="break-all font-mono">{String(c.claim_hash)}</span></p>
      </details>
    </article>
  );
}

function TxRow({ h, who }: { h: ChainTx; who: (a: string) => string }) {
  const party = (a: string) => (a.startsWith("C") ? "the contract" : who(a)); // a C... address is a contract (here, MOSAIC holding stakes)
  const moved = h.transfers.filter((t) => t.asset.startsWith("USDC") || t.asset === "");
  return (
    <tr>
      <td className="whitespace-nowrap text-quiet">{h.time.replace("T", " ").replace("Z", "")}</td>
      <td>{h.callerName ?? who(h.caller)}</td>
      <td><span className="font-medium">{h.fn}</span>{!h.ok && <span className="ml-2"><Badge state="fail">Failed</Badge></span>}<div className="text-xs text-faint">{h.args.filter((a) => typeof a === "string" && !/^G[A-Z2-7]{55}$/.test(a)).slice(0, 2).map(String).join(", ")}</div></td>
      <td className="t-num text-quiet">{moved.length ? moved.map((t) => `${Number(t.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${party(t.from)} to ${party(t.to)})`).join(", ") : "none"}</td>
      <td className="text-right"><a href={txUrl(h.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-pine underline underline-offset-4">{h.txHash.slice(0, 8)}…<ExternalLink className="size-3" aria-hidden /><span className="sr-only">View on Stellar Expert</span></a></td>
    </tr>
  );
}
