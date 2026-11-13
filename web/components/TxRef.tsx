"use client";
// How a transaction is shown everywhere: a REAL Stellar testnet transaction gets a link to Stellar Expert;
// anything else says plainly that it is simulated and was not sent to Stellar.
import { ExternalLink } from "lucide-react";
import { Hash } from "@/components/Hash";
import { txUrl } from "@/lib/format";

export function TxRef({ hash, onchain, label = "Transaction" }: { hash: string; onchain?: boolean; label?: string }) {
  if (!onchain) return <span>{label} <Hash value={hash} label="transaction hash" /> <b className="font-medium">(simulated, not sent to Stellar)</b></span>;
  return (
    <span>
      {label} <Hash value={hash} label="transaction hash" />{" "}
      <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-pine underline underline-offset-4">
        View on Stellar Expert<ExternalLink className="size-3" aria-hidden />
      </a>{" "}(real, testnet)
    </span>
  );
}
