// Display helpers. USDC has 7 decimals, so the contract stores whole numbers of "stroops".
export const USDC_UNIT = 10_000_000;
export const usdcToStroops = (amount: number) => Math.round(amount * USDC_UNIT);

export function usdc(stroops: number): string {
  const n = stroops / USDC_UNIT;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

/** Always UTC so the server and the browser print the same thing. Canadian style: "Nov 11, 2026". */
export function formatDate(unixSecs: number): string {
  if (!unixSecs) return "–";
  return new Date(unixSecs * 1000).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "");
}

// Indicative exchange rates, for orientation only (not a quote). Update them when you ship.
export const CAD_PER_INR = 0.0165;
export const CAD_PER_USD = 1.38;

const round = (n: number) => (n >= 100 ? Math.round(n / 5) * 5 : Math.round(n));
/** About how many Canadian dollars an amount in rupees is, e.g. 20000 -> "CA$330". */
export const cad = (inr: number) => `CA$${round(inr * CAD_PER_INR).toLocaleString("en-CA")}`;
/** USDC is a digital US dollar. 30 USDC -> "CA$41". */
export const usdcCad = (stroops: number) => {
  const n = (stroops / USDC_UNIT) * CAD_PER_USD;
  return `CA$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-CA")}`;
};

export const short = (s: string, n = 4) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
