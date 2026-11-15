// GET /api/statement/{id}: open an uploaded monthly bill (PDF). PROTOTYPE: anyone with the link can open it; it only holds made-up demo data.
import { connection, NextResponse } from "next/server";
import { withState } from "@/lib/engine/store";
import { readStatementFile } from "@/lib/server/statementFiles";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const { result } = await withState(() => readStatementFile(id), { readOnly: true });
  if (!result) return NextResponse.json({ error: "No such bill (or its file is no longer stored)." }, { status: 404 });
  return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.fileName.replace(/"/g, "")}"`, "Cache-Control": "no-store" } });
}
