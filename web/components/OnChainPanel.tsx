"use client";
// "On-chain": where the real contract lives, whether this site is sending its actions there, this session's REAL
// transactions, and an optional READ-ONLY wallet connection (Freighter via Stellar Wallets Kit). It never signs anything.
// The demo works fully without a wallet.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import { contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { CONTRACT_ID, contractUrl, short, txUrl } from "@/lib/format";
import { Badge, Button, Panel } from "@/components/ui";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function useHealth() {
  const [chain, setChain] = useState<"mirroring_to_testnet" | "simulation_only" | "unknown">("unknown");
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => setChain(h.chain ?? "unknown")).catch(() => setChain("unknown"));
  }, []);
  return chain;
}

function WalletConnect() {
  const [wallet, setWallet] = useState<{ address: string; network: string; passphrase: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  async function connect() {
    setBusy(true);
    setProblem(null);
    try {
      const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit/sdk");
      const { FreighterModule } = await import("@creit.tech/stellar-wallets-kit/modules/freighter");
      if (!started.current) { StellarWalletsKit.init({ modules: [new FreighterModule()] }); started.current = true; }
      const { address } = await StellarWalletsKit.authModal(); // read-only: we only ask for the public address
      const net = await StellarWalletsKit.getNetwork();
      setWallet({ address, network: net.network, passphrase: net.networkPassphrase });
    } catch (e) {
      setProblem(e instanceof Error && e.message ? `Could not connect: ${e.message}` : "No wallet connected. The demo works without one.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try { const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit/sdk"); await StellarWalletsKit.disconnect(); } catch { /* nothing to disconnect */ }
    setWallet(null);
  }

  if (!wallet) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" onClick={connect} loading={busy}><Wallet className="size-4" aria-hidden />Connect wallet (read-only)</Button>
        <p className="text-xs text-quiet">Optional. Shows your address and network. The site never asks your wallet to sign.</p>
        {problem && <p role="status" className="text-sm text-quiet">{problem}</p>}
      </div>
    );
  }
  const onTestnet = wallet.passphrase === TESTNET_PASSPHRASE;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge state={onTestnet ? "pass" : "fail"}>{onTestnet ? "Testnet" : `Not testnet (${wallet.network})`}</Badge>
        <code className="font-mono text-xs" title={wallet.address}>{short(wallet.address, 6)}</code>
        <Button variant="ghost" onClick={disconnect}>Disconnect</Button>
      </div>
      {!onTestnet && <p role="alert" className="text-clay">Your wallet is on {wallet.network}. MOSAIC only works on Stellar testnet: switch the network in your wallet.</p>}
    </div>
  );
}

export function OnChainPanel() {
  const chain = useHealth();
  const { data } = useQuery(() => contract.listActivity());
  const real = (data ?? []).filter((a) => a.onchain).slice(0, 8);
  return (
    <Panel className="space-y-6" id="onchain">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-medium tracking-tight">On-chain</h2>
        <Badge state="pass">Stellar testnet</Badge>
        {chain === "mirroring_to_testnet" && <Badge state="pass">Actions are sent to the contract</Badge>}
        {chain === "simulation_only" && <Badge state="open">Simulation only: no keys on this server</Badge>}
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-8">
        <dt className="text-quiet">Contract</dt>
        <dd><a href={contractUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-xs text-pine underline underline-offset-4">{CONTRACT_ID}<ExternalLink className="size-3 shrink-0" aria-hidden /></a></dd>
        <dt className="text-quiet">Network</dt>
        <dd>Stellar testnet (test USDC, no real money)</dd>
      </dl>
      <div>
        <h3 className="text-sm font-medium">Real transactions this session ({real.length})</h3>
        {real.length === 0 ? (
          <p className="mt-2 text-sm text-quiet">None yet. {chain === "simulation_only" ? "This server has no testnet keys, so every transaction here is simulated." : "Issue a credential, check a shop or revoke one, and its real transaction appears here."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {real.map((a) => (
              <li key={a.hash} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="font-medium">{a.fn}</span>
                <span className="text-quiet">{a.summary}</span>
                <a href={txUrl(a.hash)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-pine underline underline-offset-4">
                  {a.hash.slice(0, 8)}…<ExternalLink className="size-3" aria-hidden /><span className="sr-only">View on Stellar Expert</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <WalletConnect />
    </Panel>
  );
}
