// Ready-made application forms for the demo accounts, so you don't have to type.
// Pure data: used by the "Fill example" button (browser) and by "Load demo" (server).
// Issuer 3 shares a phone number with Shop 1 on purpose.
// CONNECT: delete this file with the "Fill example" button.

import type { RoleId } from "./accounts";
import type { ApplicationForm } from "./types";

export const EXAMPLES: Partial<Record<RoleId, ApplicationForm>> = {
  gupta: { businessName: "Issuer 1", kind: "Supplier", registrationNumber: "23AABCG4521K1Z7", ownerName: "Issuer 1 Owner", phone: "+91 97300 33333", email: "issuer1@issuer1.example", bankAccountHolder: "Issuer 1 Traders" },
  paylink: { businessName: "Issuer 2", kind: "PaymentProvider", registrationNumber: "PA-RBI-2023-0457", ownerName: "Issuer 2 Owner", phone: "+91 80000 44444", email: "issuer2@issuer2.example", bankAccountHolder: "Issuer 2 Technologies Pvt Ltd" },
  quick: { businessName: "Issuer 3", kind: "Supplier", registrationNumber: "23AAGFQ7788M1Z2", ownerName: "Issuer 3 Owner", phone: "+91 98100 11111", email: "issuer3@issuer3.example", bankAccountHolder: "Issuer 3" },
};

/** MOCK-ONLY: a ready-made form so you don't have to type. Issuer 3 shares a phone number with Shop 1 on purpose. */
export function exampleApplication(role: RoleId): ApplicationForm | null {
  return EXAMPLES[role] ?? null;
}


