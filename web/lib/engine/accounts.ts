// The five fake "people" in the demo. In the real app each one is a Stellar account
// (a keypair held by a wallet like Freighter).
// CONNECT: replace these with real G... addresses from your wallet / `stellar keys address <name>`.

import { fakeAddress } from "./util";
import type { IssuerKind } from "./types";

export type RoleId = "admin" | "gupta" | "paylink" | "quick" | "selfdeal" | "asha";

export interface Account {
  id: RoleId;
  name: string;
  label: string; // one-line description
  address: string;
  kind?: IssuerKind; // only for issuers
  home: string; // the page this role mostly uses
}

export const ACCOUNTS: Record<RoleId, Account> = {
  admin: { id: "admin", name: "Admin", label: "approves issuers, resolves disputes, receives the platform fee", address: fakeAddress("admin"), home: "/admin" },
  gupta: { id: "gupta", name: "Gupta Wholesale", label: "supplier (honest issuer)", address: fakeAddress("gupta"), kind: "Supplier", home: "/issuer" },
  paylink: { id: "paylink", name: "PayLink", label: "payment provider (honest issuer)", address: fakeAddress("paylink"), kind: "PaymentProvider", home: "/issuer" },
  quick: { id: "quick", name: "QuickSupply", label: "supplier that inflates its claims", address: fakeAddress("quick"), kind: "Supplier", home: "/issuer" },
  selfdeal: { id: "selfdeal", name: "Anand Traders", label: "supplier that deals with the shop's own people (self-dealing)", address: fakeAddress("selfdeal"), kind: "Supplier", home: "/issuer" },
  asha: { id: "asha", name: "Saathi Microfinance", label: "lender", address: fakeAddress("asha"), home: "/lender" },
};

export const ROLE_IDS = Object.keys(ACCOUNTS) as RoleId[];
export const ISSUER_ROLES: RoleId[] = ["gupta", "paylink", "quick", "selfdeal"];

/** The USDC token contract and the MOSAIC contract are accounts too: contracts can hold money. */
export const USDC_ADDRESS = fakeAddress("usdc-token", "C");
export const CONTRACT_ADDRESS = fakeAddress("mosaic-contract", "C");

const byAddress: Record<string, string> = Object.fromEntries([
  ...ROLE_IDS.map((r) => [ACCOUNTS[r].address, ACCOUNTS[r].name]),
  [CONTRACT_ADDRESS, "MOSAIC contract"],
  ["shop-1", "Sharma Store"], // shops have no wallet, but they appear in the activity log when they approve an issuer
  ["shop-2", "Verma Kirana"],
  ["shop-3", "Sunrise Mart"],
  ["lender-2", "Lender 2"], // the demo's "other lenders" (stacking counter)
  ["lender-3", "Lender 3"],
]);

export function nameOf(address: string): string {
  return byAddress[address] ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function accountByAddress(address: string): Account | undefined {
  return ROLE_IDS.map((r) => ACCOUNTS[r]).find((a) => a.address === address);
}
