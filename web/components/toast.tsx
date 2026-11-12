"use client";
import { toast } from "sonner";
import { ApiError, ContractError } from "@/lib/mock";

/** Success toast with the (fake) transaction hash.
 *  CONNECT: make the hash a link, e.g. https://stellar.expert/explorer/testnet/tx/<hash> */
export function txToast(message: string, hash: string) {
  toast.success(message, { description: `tx ${hash.slice(0, 16)}…  (fake hash)`, duration: 8000 });
}

export function errorToast(err: unknown) {
  if (err instanceof ContractError) {
    toast.error(`Rejected: ${err.code}`, { description: `${err.message} Nothing was changed.`, duration: 9000 });
  } else if (err instanceof ApiError) {
    toast.error(err.code === "InvalidInput" ? "Check your details" : `Backend: ${err.code}`, { description: err.message, duration: 9000 });
  } else {
    toast.error("Something went wrong", { description: err instanceof Error ? err.message : String(err) });
  }
}
