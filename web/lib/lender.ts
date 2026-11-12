// Small pure helpers for the lender page, kept here so they can be tested without a browser.

/** What to suggest approving. With no verified numbers (limit 0) there is NO suggestion: 0, never the amount asked for. */
export function suggestedAmount(requestedInr: number, limitInr: number): number {
  return limitInr > 0 ? Math.min(requestedInr, limitInr) : 0;
}

/** How many different issuers stand behind a shop. Several credentials from one issuer are still one voice. */
export function distinctValidIssuers(views: { status: string; credential: { issuer: string } }[]): number {
  return new Set(views.filter((v) => v.status === "Valid").map((v) => v.credential.issuer)).size;
}
