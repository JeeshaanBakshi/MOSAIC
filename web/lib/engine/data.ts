import "server-only";
// FAKE reference data, standing in for things the real backend would look up:
// the shops it knows about, the government GST registry, the RBI licence list, sales records and a blacklist.
//
// CONNECT: in the real backend each of these is a lookup, not a table:
//   - GST number  -> the GST portal's taxpayer search (or a verification API provider)
//   - RBI licence -> RBI's published list of authorized payment aggregators
//   - trading records -> the applicant's invoices / sales export, shared with their consent
//   - blacklist   -> your own list of issuers that were suspended before

import type { Party } from "./rules";

export interface Shop extends Party {
  id: string;
  name: string;
  type: string;
  since: number;
}

export const SHOPS: Record<string, Shop> = {
  "shop-1": {
    id: "shop-1", name: "Sharma Store", type: "Neighbourhood grocery (kirana), Delhi", since: 2019,
    owner: "Suresh Sharma", phone: "+91 98100 11111", bankAccount: "SBIN-0001234-55501234", address: "12 Gandhi Road, Karol Bagh, Delhi",
  },
  "shop-2": {
    id: "shop-2", name: "Verma Kirana", type: "Neighbourhood grocery (kirana), Nashik", since: 2022,
    owner: "Anil Verma", phone: "+91 98200 22222", bankAccount: "HDFC-0005678-77700012", address: "4 Station Road, Nashik, Maharashtra",
  },
  // A shop that QuickSupply (QuickSupply) listed itself and alone vouches for. It has no payment-app receipts.
  "shop-3": {
    id: "shop-3", name: "Sunrise Mart", type: "Brand-new shop, listed by QuickSupply", since: 2026,
    owner: "Deepak Rao", phone: "+91 98300 33333", bankAccount: "PUNB-0004321-12345678", address: "7 Link Road, Indore, Madhya Pradesh",
  },
};

/** GST numbers are 15 characters: 2-digit state, 10-character PAN, entity digit, "Z", check character. */
export const GST_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Who is on record for a registration: the owner / authorized person and the official contact details. */
export interface RegistryRecord {
  legalName: string;
  owner: string; // proprietor or authorized signatory
  email: string; // contact email on record
  phone: string; // contact phone on record
}

export const GST_REGISTRY: Record<string, RegistryRecord & { status: "Active" | "Cancelled" }> = {
  "23AABCG4521K1Z7": { legalName: "Gupta Wholesale Traders", status: "Active", owner: "Ramesh Gupta", email: "issuer1@issuer1.example", phone: "+91 97300 33333" },
  "23AAGFQ7788M1Z2": { legalName: "QuickSupply", status: "Active", owner: "Vikram Malhotra", email: "issuer3@issuer3.example", phone: "+91 98100 77777" },
  "23AAHCS1234R1Z9": { legalName: "Anand Traders", status: "Active", owner: "Anand Mehra", email: "issuer4@issuer4.example", phone: "+91 98100 11111" }, // same phone as Sharma Store: self-dealing
  "27AACCD9911P1Z3": { legalName: "Dormant Foods", status: "Cancelled", owner: "Ravi Desai", email: "ravi@dormantfoods.example", phone: "+91 99000 55555" },
};

export const RBI_LICENCES: Record<string, RegistryRecord & { status: "Authorized" | "Revoked" }> = {
  "PA-RBI-2023-0457": { legalName: "PayLink Technologies Pvt Ltd", status: "Authorized", owner: "Neha Kapoor", email: "issuer2@issuer2.example", phone: "+91 80000 44444" },
};

/** Sales history on file per registration number. `counterparties` = shops sold to (suppliers) or merchants served (payment providers). */
export const TRADING_RECORDS: Record<string, { months: number; counterparties: number }> = {
  "23AABCG4521K1Z7": { months: 18, counterparties: 42 },
  "PA-RBI-2023-0457": { months: 24, counterparties: 5200 },
  "23AAGFQ7788M1Z2": { months: 12, counterparties: 30 }, // QuickSupply is a real supplier that inflates its claim
  "23AAHCS1234R1Z9": { months: 12, counterparties: 1 }, // Anand Traders really only sells to one shop
};

export const BLACKLIST = new Set<string>(["29AAAAB0000A1Z5"]);
