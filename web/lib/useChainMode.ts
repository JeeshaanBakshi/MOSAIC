"use client";
// Is this server sending its actions to the real contract on Stellar testnet ("live"), or simulating them ("demo")?
// Read once from /api/health and shared, so the banner and the On-chain panel can never disagree.
import { useEffect, useState } from "react";

export type ChainMode = "live" | "demo" | "unknown";
let cached: ChainMode | null = null;
let pending: Promise<ChainMode> | null = null;

function load(): Promise<ChainMode> {
  pending ??= fetch("/api/health", { cache: "no-store" })
    .then((r) => r.json())
    .then((h): ChainMode => (h.chain === "mirroring_to_testnet" ? "live" : "demo"))
    .catch((): ChainMode => "unknown")
    .then((m) => (cached = m));
  return pending;
}

export function useChainMode(): ChainMode {
  const [mode, setMode] = useState<ChainMode>(cached ?? "unknown");
  useEffect(() => { let on = true; load().then((m) => on && setMode(m)); return () => { on = false; }; }, []);
  return mode;
}
