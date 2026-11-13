// The ONE place the pages get their data from:   import { contract, backend, demo } from "@/lib/mock"
//
// Despite the folder name, this is no longer a mock that runs in the browser. It is a thin CLIENT: every call
// is sent to the server (/api/rpc), which runs the engine in lib/engine against the cloud database.
// The pages don't know the difference, which is the point: when you connect the real Stellar contract and your own
// backend, you replace what happens behind these same function names.
//
// CONNECT: `contract.*` -> the Soroban contract (build, simulate, wallet signs, send). `backend.*` -> your FastAPI server.

import type * as EngineContract from "../engine/contract";
import type * as EngineBackend from "../engine/backend";
import { ApiError, ContractError, type ApiErrorCode, type ContractErrorName } from "../engine/types";
import { exampleApplication } from "../engine/examples";
import { noteVersion } from "./version";

type Answer =
  | { ok: true; data: unknown; version?: number }
  | { ok: false; error: { kind: "contract" | "api" | "server"; code?: string; message: string }; version?: number };

async function post(url: string, body: unknown): Promise<{ status: number; json: Answer & { error?: { code?: string } } }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as (Answer & { error?: { code?: string } }) | null;
  if (!json) throw new Error(`The server answered ${res.status} with something unexpected.`);
  if (typeof json.version === "number") noteVersion(json.version);
  return { status: res.status, json };
}

function toError(e: Extract<Answer, { ok: false }>["error"]): Error {
  if (e.kind === "contract") return new ContractError(e.code as ContractErrorName);
  if (e.kind === "api") return new ApiError(e.code as ApiErrorCode, e.message);
  return new Error(e.message);
}

async function rpc(fn: string, args: unknown[]): Promise<unknown> {
  const { json } = await post("/api/rpc", { fn, args });
  if (json.ok) return json.data;
  throw toError(json.error);
}

/** `contract.addIssuer(...)` becomes `rpc("contract.addIssuer", [...])`. The server only runs functions on its allow-list. */
function namespace<T extends object>(ns: string, local: Record<string, unknown> = {}): T {
  return new Proxy(local, {
    get: (target, name) => (typeof name === "string" && name in target ? target[name] : (...args: unknown[]) => rpc(`${ns}.${String(name)}`, args)),
  }) as T;
}

export const contract = namespace<typeof EngineContract>("contract");
export const backend = namespace<typeof EngineBackend>("backend", { exampleApplication }); // the form examples need no server

// ---------- reset (wipes the cloud data for everyone) ----------

async function resetCall(loadDemo: boolean): Promise<boolean> {
  let password: string | undefined;
  for (;;) {
    const { json } = await post("/api/reset", { password, loadDemo });
    if (json.ok) return true;
    if (json.error.code === "PasswordRequired") {
      const typed = window.prompt(password === undefined ? "Enter the reset password:" : "Wrong password. Try again:");
      if (typed === null) return false; // cancelled
      password = typed;
      continue;
    }
    throw toError(json.error);
  }
}

export const demo = {
  /** Wipe ALL data (for every visitor) back to a fresh, empty start. Returns false if you cancelled the password prompt. */
  resetDemo: () => resetCall(false),
  /** Wipe, then load the demo: 4 issuers approved, 5 credentials issued, 2 loan requests. */
  loadDemo: () => resetCall(true),
  /** First visit: fill the demo ONLY IF there is no data yet. Never wipes anything. Returns true if it loaded the demo. */
  ensureDemo: async (): Promise<boolean> => {
    const { json } = await post("/api/reset", { ifEmpty: true });
    return (json as { seeded?: boolean }).seeded === true;
  },
};

// ---------- things that are safe to use in the browser as they are ----------

export { subscribe, getVersion, getServerVersion, noteVersion } from "./version";
export { ACCOUNTS, ROLE_IDS, ISSUER_ROLES, CONTRACT_ADDRESS, nameOf, accountByAddress } from "../engine/accounts";
export type { RoleId, Account } from "../engine/accounts";
export { ContractError, ApiError } from "../engine/types";
export type * from "../engine/types";
export type { Evaluated, Graph, ShopReview, ShopVerdict, IssuerReceipts, ShopMonth } from "../engine/backend";
export type { Shop } from "../engine/data";
export type { PublicApplication, Review, ReviewCheck, Verdict } from "../engine/onboarding";
export type { CheckResult, Result } from "../engine/rules";
export { claimHash } from "../engine/util";
export { rs } from "../engine/rules";
export type { ActivityItem, ManualReview, Email, AuditEntry, LoanRequest } from "../engine/store";
export type { LoanDecision, LoanOutcome, LoanRule } from "../engine/loans";
