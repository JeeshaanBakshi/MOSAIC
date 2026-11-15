// Small shared pieces for the new evidence features: one badge per kind of status, with plain words.
// Every badge has a word and an icon, so colour is never the only signal.
import { Badge } from "@/components/ui";
import { FRESHNESS_LABEL, MATCH_LABEL, RELIABILITY_LABEL, type ClaimState, type Freshness, type MatchStatus, type Reliability, type Trust } from "@/lib/mock";

const TRUST: Record<Trust, { state: string; label: string }> = {
  strong: { state: "pass", label: "Strong supporting evidence" },
  review: { state: "open", label: "Needs review" },
  flagged: { state: "fail", label: "Flagged" },
  awaiting: { state: "unknown", label: "Awaiting evidence" },
};
export const TrustBadge = ({ trust }: { trust: Trust }) => <Badge state={TRUST[trust].state}>{TRUST[trust].label}</Badge>;

const CLAIM: Record<ClaimState, { state: string; label: string }> = {
  confirmed: { state: "pass", label: "Confirmed by both parties" },
  pending: { state: "open", label: "Pending confirmation" },
  rejected: { state: "fail", label: "Rejected by business" },
  disputed: { state: "fail", label: "Disputed" },
  expired: { state: "unknown", label: "Expired" },
};
export const ClaimBadge = ({ state }: { state: ClaimState }) => <Badge state={CLAIM[state].state}>{CLAIM[state].label}</Badge>;

const MATCH: Record<MatchStatus, string> = {
  fully_matched: "pass", partially_matched: "open", unmatched: "unknown", duplicate: "fail", cancelled: "fail", requires_review: "fail",
};
export const MatchBadge = ({ status }: { status: MatchStatus }) => <Badge state={MATCH[status]}>{MATCH_LABEL[status]}</Badge>;

const FRESH: Record<Freshness, string> = { recent: "pass", ageing: "open", stale: "unknown", expired: "unknown" };
export const FreshnessBadge = ({ status }: { status: Freshness }) => <Badge state={FRESH[status]}>{FRESHNESS_LABEL[status]}</Badge>;

const REL: Record<Reliability, string> = { established: "pass", limited_history: "unknown", under_review: "open", restricted: "fail" };
export const ReliabilityBadge = ({ category }: { category: Reliability }) => <Badge state={REL[category]}>{RELIABILITY_LABEL[category]}</Badge>;

/** The invoice's own money, in plain words: "₹45,000 invoice, ₹15,000 paid (33.3%), ₹30,000 outstanding". */
export function moneyLine(m: { effectiveAmount: number; matchedAmount: number; matchingPercentage: number; outstandingAmount: number; creditNotes: number }, rs: (n: number) => string) {
  const owed = m.creditNotes ? `${rs(m.effectiveAmount)} owed after ${rs(m.creditNotes)} credit` : `${rs(m.effectiveAmount)} invoice`;
  return `${owed}, ${rs(m.matchedAmount)} matched (${m.matchingPercentage}%), ${rs(m.outstandingAmount)} outstanding`;
}

/** What is on Stellar and what is not, said once, in the same words everywhere. */
export const OFFCHAIN_NOTE = "Invoice claims, confirmations and matching are kept by the MOSAIC backend, off-chain. Only the supplier's credential is on Stellar testnet.";
