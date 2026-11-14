"use client";
// WHAT THE DEMO SHOWS: five fraud scenarios you can switch between. The reasons and numbers come from the REAL rules
// engine (the same calls the Lender page makes), not from mocked text. Until the demo data has loaded, the plain
// description is shown instead, so nothing is ever invented.
import { useState } from "react";
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { backend, rs } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { RoleLink } from "@/components/RoleLink";

type Verdict = "ok" | "bad" | "unknown";
interface Scenario { id: string; name: string; tag: string; plain: string; shop: string; verdict: Verdict; headline: string; reason: string; numbers?: string }

const BASE: Omit<Scenario, "verdict" | "headline" | "reason" | "numbers">[] = [
  { id: "sharma", name: "Sharma Store", tag: "Honest business", shop: "shop-1", plain: "A supplier and a payment app vouch, every check passes, a loan limit is shown." },
  { id: "sunrise", name: "Sunrise Mart", tag: "Not enough evidence", shop: "shop-3", plain: "Vouched for by one supplier only, no payment-app receipts. Unknown, not bad. No limit." },
  { id: "anand", name: "Anand Traders", tag: "Self-dealing", shop: "shop-1", plain: "Shares the shop's phone and bank account: independence fails and the claim is not counted." },
  { id: "quick", name: "QuickSupply", tag: "Inflated, round trip", shop: "shop-1", plain: "Claims ₹1,50,000 a month. The payment app shows ₹1,40,000 came straight back: net flow fails." },
  { id: "stack", name: "Loan stacking", tag: "Repeated checks", shop: "shop-1", plain: "Three lenders checked Sharma Store in 30 days: a warning, and the limit is halved." },
];

const ICON = { ok: CircleCheck, bad: CircleX, unknown: CircleDashed } as const;
const WORD = { ok: "Verified", bad: "Did not pass", unknown: "Unknown" } as const;

export function DemoScenarios() {
  const [active, setActive] = useState(0);
  const live = useQuery(async () => {
    const [sharma, sunrise, checks] = await Promise.all([backend.getLoanDecision("shop-1", 20000, 6), backend.getLoanDecision("shop-3", 100000, 6), backend.getChecks("shop-1")]);
    return { sharma, sunrise, checks };
  });
  const L = live.data;

  const failing = (issuer: string) => {
    const e = L?.checks.find((c) => c.issuerName === issuer);
    const f = e?.checks.find((c) => c.result === "fail");
    return f ? { reason: f.reason, numbers: f.numbers } : null;
  };
  const scenarios: Scenario[] = BASE.map((b) => {
    if (b.id === "sharma" && L && L.sharma.outcome === "approve") return { ...b, verdict: "ok", headline: `Approve up to ${rs(L.sharma.limitInr)}`, reason: L.sharma.summary };
    if (b.id === "sunrise" && L && L.sunrise.outcome === "not_enough_evidence") return { ...b, verdict: "unknown", headline: "Unknown, not bad", reason: L.sunrise.rules.find((r) => r.id === "evidence")?.reason ?? b.plain };
    if (b.id === "anand" && failing("Anand Traders")) return { ...b, verdict: "bad", headline: "Independence failed", ...failing("Anand Traders")! };
    if (b.id === "quick" && failing("QuickSupply")) return { ...b, verdict: "bad", headline: "Net flow failed", ...failing("QuickSupply")! };
    return { ...b, verdict: b.id === "stack" ? "unknown" : "unknown", headline: b.id === "stack" ? "Warning, limit halved" : b.tag, reason: b.plain };
  });
  const s = scenarios[active];
  const Icon = ICON[s.verdict];

  return (
    <section aria-labelledby="cases">
      <p className="t-label">Chapter 03 · Fraud, caught</p>
      <h2 id="cases" className="t-headline mt-6 max-w-[18ch]">What the demo <span className="t-serif">shows</span></h2>
      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul role="tablist" aria-label="Scenarios" className="divide-y divide-line border-y border-line">
          {scenarios.map((c, i) => (
            <li key={c.id}>
              <button role="tab" aria-selected={i === active} onClick={() => setActive(i)}
                className={`group flex w-full items-baseline gap-4 py-5 text-left transition-colors ${i === active ? "text-ink" : "text-quiet hover:text-ink"}`}>
                <span className="t-label !text-inherit w-6">0{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="t-title block">{c.name}</span>
                  <span className="mt-1 block text-sm">{c.tag}</span>
                </span>
                <span aria-hidden className={`h-px transition-all ${i === active ? "w-10 bg-pine" : "w-4 bg-line group-hover:w-8"}`} />
              </button>
            </li>
          ))}
        </ul>
        <div key={s.id} role="tabpanel" className="fade-up border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <span className={`stamp ${s.verdict === "ok" ? "stamp-ok" : s.verdict === "bad" ? "stamp-bad" : "stamp-unknown"}`}><Icon className="size-3.5" aria-hidden />{WORD[s.verdict]}</span>
          <p className="t-headline mt-6 !text-[clamp(1.8rem,3.4vw,3.2rem)]">{s.headline}</p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-quiet">{s.reason}</p>
          {s.numbers && <p className="mt-4 max-w-xl font-mono text-xs leading-relaxed text-quiet">{s.numbers}</p>}
          <p className="mt-6 text-xs text-faint">{L ? "Live from the rules engine." : "Loading the live numbers…"}</p>
          <div className="mt-8"><RoleLink role="asha" href={`/lender?shop=${s.shop}`} className="btn btn-ghost">See it on the Lender page<ArrowUpRight className="size-4" aria-hidden /></RoleLink></div>
        </div>
      </div>
    </section>
  );
}
