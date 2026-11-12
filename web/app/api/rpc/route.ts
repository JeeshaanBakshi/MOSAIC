// The ONE door the browser uses to talk to the engine: POST /api/rpc  { fn: "contract.verify", args: [...] }
// Only functions on the allow-list below can be called. Reads skip the lock and never save.
//
// SECURITY NOTE (prototype): "who is calling" is whatever address the browser sends. There are no real signatures yet.
// On Stellar, `require_auth` makes the network check a signature. Do not treat this as access control.
import { NextResponse } from "next/server";
import * as backend from "@/lib/engine/backend";
import * as contract from "@/lib/engine/contract";
import { nameOf } from "@/lib/engine/accounts";
import { logEvent, withState } from "@/lib/engine/store";
import { ApiError, ContractError } from "@/lib/engine/types";
import { log } from "@/lib/server/log";

const NAMESPACES: Record<string, Record<string, unknown>> = { contract, backend };
const READS = /^(get|list|checks|email)/; // function names that only read

type Outcome = { ok: true; data: unknown } | { ok: false; error: { kind: "contract" | "api"; code: string; message: string } };

export async function POST(request: Request) {
  const started = Date.now();
  let fnName = "";
  try {
    const body = (await request.json().catch(() => null)) as { fn?: unknown; args?: unknown } | null;
    if (!body || typeof body.fn !== "string" || !Array.isArray(body.args)) {
      return NextResponse.json({ ok: false, error: { kind: "server", message: "Bad request." } }, { status: 400 });
    }
    fnName = body.fn;
    const [ns, name] = body.fn.split(".");
    const fn = NAMESPACES[ns]?.[name];
    if (!/^[A-Za-z0-9]+$/.test(name ?? "") || typeof fn !== "function") {
      log("warn", "rpc_unknown", { fn: fnName });
      return NextResponse.json({ ok: false, error: { kind: "server", message: `Unknown function ${body.fn}.` } }, { status: 404 });
    }
    const args = body.args;
    const readOnly = READS.test(name);
    const caller = typeof args[0] === "string" && /^G[A-Z2-7]{55}$/.test(args[0]) ? nameOf(args[0]) : "someone";

    const { result, version } = await withState<Outcome>(async () => {
      try {
        return { ok: true, data: await (fn as (...a: unknown[]) => Promise<unknown>)(...args) };
      } catch (e) {
        if (e instanceof ContractError || e instanceof ApiError) {
          const kind = e instanceof ContractError ? "contract" : "api";
          if (!readOnly) logEvent("warn", "rejected", `${body.fn} by ${caller}: ${e.code}. ${e.message}`); // every refusal is on the record
          return { ok: false, error: { kind, code: e.code, message: e.message } };
        }
        throw e;
      }
    }, { readOnly });

    if (!readOnly) log("info", "rpc", { fn: body.fn, ok: result.ok, ms: Date.now() - started });
    return NextResponse.json({ ...result, version }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log("error", "rpc_failed", { fn: fnName, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { kind: "server", message: e instanceof Error && /busy|configured/i.test(e.message) ? e.message : "Something went wrong on the server. Try again." } }, { status: 500 });
  }
}
