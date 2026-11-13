"use client";
// "Who am I right now?" Every person in the demo, labelled by what they do.
// With a real wallet, the connected account decides this. Shopkeepers never need a wallet at all:
// in a real product they would log in with their phone number.
//
// CONNECT: replace the "Switch role" selector with a wallet connection (Stellar Wallets Kit / Freighter) for admin,
// issuers and lenders, and a phone-number login for shopkeepers.

import { useSyncExternalStore } from "react";
import { ACCOUNTS, type Account, type RoleId } from "./mock";

export type Persona = RoleId | "sharma" | "mehta";
export type Kind = "admin" | "issuer" | "lender" | "shopkeeper";

export const PERSONAS: Record<Persona, { label: string; name: string; kind: Kind; home: string; shopId?: string }> = {
  sharma: { label: "Shop 1 (shopkeeper)", name: "Shop 1", kind: "shopkeeper", home: "/my-shop", shopId: "shop-1" },
  mehta: { label: "Shop 2 (shopkeeper, new)", name: "Shop 2, a new shop", kind: "shopkeeper", home: "/my-shop", shopId: "shop-2" },
  gupta: { label: "Issuer 1 (supplier)", name: "Issuer 1", kind: "issuer", home: "/issuer" },
  paylink: { label: "Issuer 2 (payment app)", name: "Issuer 2", kind: "issuer", home: "/issuer" },
  quick: { label: "Issuer 3 (round-tripping supplier)", name: "Issuer 3, round-tripping", kind: "issuer", home: "/issuer" },
  selfdeal: { label: "Issuer 4 (self-dealing supplier)", name: "Issuer 4, self-dealing", kind: "issuer", home: "/issuer" },
  asha: { label: "Lender 1 (lender)", name: "Lender 1", kind: "lender", home: "/lender" },
  admin: { label: "MOSAIC admin (platform)", name: "Mosaic admin", kind: "admin", home: "/admin" },
};
export const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];
export const PERSONA_GROUPS: { label: string; kind: Kind }[] = [
  { label: "Shopkeepers", kind: "shopkeeper" },
  { label: "Suppliers and payment apps", kind: "issuer" },
  { label: "Lender", kind: "lender" },
  { label: "Platform", kind: "admin" },
];
export const ISSUER_PERSONAS: Persona[] = ["gupta", "paylink", "quick", "selfdeal"];

/** The Stellar account behind a persona. Shopkeepers have none: they never touch crypto. */
export function accountOf(p: Persona): Account | null {
  return (ACCOUNTS as Record<string, Account>)[p] ?? null;
}

const KEY = "mosaic-mock-role";
let role: Persona = "sharma";
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = localStorage.getItem(KEY) as Persona | null;
    if (saved && PERSONA_IDS.includes(saved)) role = saved;
  } catch { /* storage blocked: fine */ }
}

export function setRole(next: Persona) {
  ensureLoaded();
  role = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useRole(): Persona {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => { ensureLoaded(); return role; },
    () => "sharma" as Persona,
  );
}
