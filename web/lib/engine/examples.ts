// Ready-made application forms for the demo accounts, so you don't have to type.
// Pure data: used by the "Fill example" button (browser) and by "Load demo" (server).
// Anand Traders shares a phone number with Sharma Store on purpose (self-dealing).
// CONNECT: delete this file with the "Fill example" button.

import type { RoleId } from "./accounts";
import type { ApplicationForm } from "./types";

export const EXAMPLES: Partial<Record<RoleId, ApplicationForm>> = {
  gupta: { businessName: "Gupta Wholesale", kind: "Supplier", registrationNumber: "23AABCG4521K1Z7", ownerName: "Ramesh Gupta", phone: "+91 97300 33333", email: "issuer1@issuer1.example", bankAccountHolder: "Gupta Wholesale Traders" },
  paylink: { businessName: "PayLink", kind: "PaymentProvider", registrationNumber: "PA-RBI-2023-0457", ownerName: "Neha Kapoor", phone: "+91 80000 44444", email: "issuer2@issuer2.example", bankAccountHolder: "PayLink Technologies Pvt Ltd" },
  quick: { businessName: "QuickSupply", kind: "Supplier", registrationNumber: "23AAGFQ7788M1Z2", ownerName: "Vikram Malhotra", phone: "+91 98100 77777", email: "issuer3@issuer3.example", bankAccountHolder: "QuickSupply" },
  selfdeal: { businessName: "Anand Traders", kind: "Supplier", registrationNumber: "23AAHCS1234R1Z9", ownerName: "Anand Mehra", phone: "+91 98100 11111", email: "issuer4@issuer4.example", bankAccountHolder: "Anand Traders" },
};

/** MOCK-ONLY: a ready-made form so you don't have to type. Anand Traders shares a phone number with Sharma Store on purpose. */
export function exampleApplication(role: RoleId): ApplicationForm | null {
  return EXAMPLES[role] ?? null;
}


