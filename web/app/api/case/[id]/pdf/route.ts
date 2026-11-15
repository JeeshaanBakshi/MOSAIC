// GET /api/case/{id}/pdf: the admin's case file for one rejection, as a PDF.
// PROTOTYPE: anyone with the link can open it (there is no real log-in yet), but it only holds made-up demo data.
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getCaseReport } from "@/lib/engine/cases";
import { withState } from "@/lib/engine/store";
import { ApiError } from "@/lib/engine/types";
import { caseReportPdf } from "@/lib/server/pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Bad case id." }, { status: 400 });
  try {
    const { result } = await withState(() => getCaseReport(id), { readOnly: true });
    return new Response(new Uint8Array(caseReportPdf(result)), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="mosaic-case-${id}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.code === "NotFound" ? 404 : 400 });
    return NextResponse.json({ error: "Could not build the case file." }, { status: 500 });
  }
}
