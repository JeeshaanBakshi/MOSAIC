"use client";
import { toast } from "sonner";
import { ApiError, ContractError } from "@/lib/mock";
import { txUrl } from "@/lib/format";

/** Success toast. A real testnet transaction gets a Stellar Expert link; anything else says it is simulated. */
export function txToast(message: string, hash: string, onchain = false) {
  if (onchain) {
    toast.success(message, {
      description: `Real Stellar testnet transaction ${hash.slice(0, 12)}…`,
      action: { label: "View on Stellar Expert", onClick: () => window.open(txUrl(hash), "_blank", "noopener,noreferrer") },
      duration: 20000,
    });
  } else {
    toast.success(message, { description: "Simulated: not sent to Stellar", duration: 8000 });
  }
}

export function errorToast(err: unknown) {
  if (err instanceof ContractError) {
    toast.error(`Rejected: ${err.code}`, { description: `${err.message} Nothing was changed.`, duration: 9000 });
  } else if (err instanceof ApiError) {
    toast.error(err.code === "InvalidInput" ? "Check your details" : err.code === "NotSentToStellar" ? "Not sent to Stellar" : `Backend: ${err.code}`, { description: err.message, duration: 9000 });
  } else {
    toast.error("Something went wrong", { description: err instanceof Error ? err.message : String(err) });
  }
}
