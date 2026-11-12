// Small helpers for the mock. Nothing here exists on a real chain.

/** 64 hex characters that look like a transaction hash (deterministic, NOT a real hash). */
export function fakeHash(seed: string): string {
  let h = 2166136261 >>> 0;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    for (const ch of seed + i) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    out.push(h.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // Stellar addresses use this alphabet

/** A fake Stellar address: "G" (account) or "C" (contract) + 55 characters. */
export function fakeAddress(seed: string, prefix: "G" | "C" = "G"): string {
  const hex = fakeHash("addr:" + seed) + fakeHash("addr2:" + seed);
  let s: string = prefix;
  for (let i = 0; i < 55; i++) s += B32[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 32];
  return s;
}

/** The old fake network delay. The app has a real server now, so this does nothing. Kept so the engine code stays readable. */
export const sleep = async (ms: number): Promise<void> => {
  void ms;
};

/** SHA-256 of the claim as hex. The same fingerprint the real app would put on-chain. */
export async function claimHash(claim: Record<string, string | number>): Promise<string> {
  const sorted = Object.fromEntries(Object.keys(claim).sort().map((k) => [k, claim[k]]));
  const bytes = new TextEncoder().encode(JSON.stringify(sorted));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
