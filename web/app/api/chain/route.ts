// GET /api/chain: everything the deployed MOSAIC contract holds, read live from Stellar testnet. No keys, no simulation.
// Safe to open in a browser: it only reads public testnet data.
import { connection, NextResponse } from "next/server";
import { getChainSnapshot } from "@/lib/server/chainState";

export async function GET() {
  await connection();
  try {
    return NextResponse.json(await getChainSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 160) : "Could not read Stellar testnet." }, { status: 502 });
  }
}
