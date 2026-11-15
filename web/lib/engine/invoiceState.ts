import "server-only";
// A tiny helper the six-check engine (backend.getChecks) uses: does the SHOP's answer to an invoice claim
// stop a credential from being counted as verified?
//   - the shop REJECTED an invoice backing this credential -> the credential fails (the business denies the transaction)
//   - the shop DISPUTED one, and the admin upheld it       -> fails
//   - the shop DISPUTED one and the admin has not ruled     -> unknown (held back until a person decides)
// Invoices the supplier cancelled itself are ignored: the supplier withdrew them.
// Nothing else changes a verdict: a missing or pending answer is never held against the issuer.
 
import { read } from "./store";

export interface InvoiceBlock {
  result: "fail" | "unknown";
  reason: string;
}

export function invoiceBlock(credentialId: number): InvoiceBlock | null {
  const claims = Object.values(read().db.invoices).filter((c) => c.credentialId === credentialId && !c.cancelled);
  const rejected = claims.find((c) => c.status === "rejected" && !(c.resolution && !c.resolution.upheld)); // a rejection the admin dismissed no longer counts
  if (rejected) return { result: "fail", reason: `The business rejected invoice ${rejected.ref}${rejected.reason ? `: "${rejected.reason.replace(/[.!?\s]+$/, "")}"` : ""}. A valid signature does not make a transaction true.` };
  const upheld = claims.find((c) => c.status === "disputed" && c.resolution?.upheld);
  if (upheld) return { result: "fail", reason: `The business disputed invoice ${upheld.ref} and the admin upheld the dispute.` };
  const open = claims.find((c) => c.status === "disputed" && !c.resolution);
  if (open) return { result: "unknown", reason: `The business disputed invoice ${open.ref}. Held back until the admin decides.` };
  return null;
}
