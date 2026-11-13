// GET /api/health: is the deployment wired up? Safe to open in a browser. Never shows keys or data.
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { emailConfigured } from "@/lib/server/email";
import { CONTRACT_ID, chainEnabled } from "@/lib/server/chain";
import { getStorage, storageKind } from "@/lib/server/storage";

export async function GET() {
  await connection();
  let storageReachable = false;
  try {
    await getStorage().version();
    storageReachable = true;
  } catch { /* reported below */ }
  const storage = storageKind();
  const ok = storageReachable && storage !== "missing";
  return NextResponse.json(
    {
      ok,
      storage, // "redis" in the cloud, "memory" on a developer's laptop, "missing" = not configured
      storageReachable,
      email: emailConfigured() ? "configured" : "not_configured", // "not_configured": codes show in an on-screen inbox, nothing is emailed
      resetProtected: !!process.env.RESET_PASSWORD,
      chain: chainEnabled() ? "mirroring_to_testnet" : "simulation_only", // are website actions also sent to the real contract? (no keys shown)
      contract: CONTRACT_ID,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
