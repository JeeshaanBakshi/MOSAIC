// POST /api/reset  { password?, loadDemo? }  wipes ALL data for EVERY visitor and starts again from empty.
// If RESET_PASSWORD is set on the server, the password must match. (Set it before you share the link publicly.)
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as demo from "@/lib/engine/demo";
import { read, resetEverything, withState } from "@/lib/engine/store";
import { log } from "@/lib/server/log";

export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { password?: unknown; loadDemo?: unknown; ifEmpty?: unknown };

    // First visit: load the demo only if nothing exists yet. Never wipes, so it needs no password.
    if (body.ifEmpty === true) {
      if (process.env.AUTO_DEMO === "off") return NextResponse.json({ ok: true, seeded: false });
      const { result: seeded, version } = await withState(async () => {
        const s = read();
        const empty = s.txCount === 1 && Object.keys(s.issuers).length === 0 && Object.keys(s.db.applications).length === 0 && s.db.loans.length === 0;
        if (empty) await demo.loadDemo();
        return empty;
      });
      if (seeded) log("info", "auto_demo", { note: "First visit: demo loaded into empty data" });
      return NextResponse.json({ ok: true, seeded, version }, { headers: { "Cache-Control": "no-store" } });
    }
    const required = process.env.RESET_PASSWORD;
    if (required) {
      const given = typeof body.password === "string" ? body.password : "";
      if (!same(given, required)) {
        log("warn", "reset_denied", { reason: given ? "wrong password" : "password required" });
        return NextResponse.json({ ok: false, error: { kind: "api", code: "PasswordRequired", message: "A reset password is needed." } }, { status: 401 });
      }
    }
    let version = await resetEverything();
    log("warn", "reset", { loadDemo: body.loadDemo === true });
    if (body.loadDemo === true) {
      version = (await withState(() => demo.loadDemo())).version;
    }
    return NextResponse.json({ ok: true, version }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log("error", "reset_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { kind: "server", message: "The reset failed. Try again." } }, { status: 500 });
  }
}
