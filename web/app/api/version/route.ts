// GET /api/version: a tiny number that goes up whenever ANY visitor changes something.
// Every open browser asks for it every few seconds and re-reads its screen when it changes.
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getStorage } from "@/lib/server/storage";

export async function GET() {
  await connection(); // opt in to running per request (not prerendered at build time)
  try {
    return NextResponse.json({ version: await getStorage().version() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ version: -1 }, { status: 503 });
  }
}
