import "server-only";
// One JSON line per event, so the hosting dashboard (Vercel > Logs) is easy to read and search.
// Never log secrets, codes or full email addresses.

export type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** "issuer1@issuer1.example" -> "a***@guptawholesale.example" */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return domain ? `${name.slice(0, 1)}***@${domain}` : "***";
}
