// POST /api/statement: a supplier uploads one month's bill PDF (multipart form). The PDF goes to the file store; the engine
// checks the supplier, the shop and the file, and keeps the numbers. PROTOTYPE: the "issuer" field is whatever the browser sends.
import { connection, NextResponse } from "next/server";
import { submitStatement } from "@/lib/engine/statements";
import { logEvent, withState } from "@/lib/engine/store";
import { ApiError, ContractError } from "@/lib/engine/types";
import { log } from "@/lib/server/log";

export const maxDuration = 30;

export async function POST(request: Request) {
  await connection();
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return NextResponse.json({ ok: false, error: { kind: "api", code: "InvalidInput", message: "Attach the bill as a PDF file." } }, { status: 400 });
    if (file.size > 600_000) return NextResponse.json({ ok: false, error: { kind: "api", code: "InvalidInput", message: "That file is too big. The limit is 400 KB: send a text PDF, not a photo." } }, { status: 413 });
    const get = (k: string) => String(form.get(k) ?? "");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { result, version } = await withState(async () => {
      try {
        const id = await submitStatement(get("issuer"), get("shopId"), { month: get("month"), billedInr: Number(get("billedInr")), billCount: Number(get("billCount")), nameOnBill: get("nameOnBill"), fileName: file.name }, bytes);
        return { ok: true as const, id };
      } catch (e) {
        if (e instanceof ContractError || e instanceof ApiError) { logEvent("warn", "rejected", `statement upload: ${e.code}. ${e.message}`); return { ok: false as const, error: { kind: e instanceof ContractError ? "contract" : "api", code: e.code, message: e.message } }; }
        throw e;
      }
    });
    return NextResponse.json({ ...result, version }, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log("error", "statement_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { kind: "server", message: "Something went wrong on the server. Try again." } }, { status: 500 });
  }
}
