// HOW IT WORKS: five full-height chapters, text alternating sides, with the particle shape in the free space opposite.
// Each chapter has a giant outlined numeral, a line-by-line text reveal, and a small diagram built from OUR real demo numbers.
import { Lock } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";

const STEPS = [
  ["An issuer vouches", "A supplier or payment app signs a one-line claim about a shop and locks a 30 USDC stake behind it."],
  ["The claim meets the receipts", "Payment-app records must back it up: 70% match, minus money that came straight back. The issuer's own numbers never pass."],
  ["The shop asks for a loan", "The shop pays nothing and never touches crypto."],
  ["The lender pays 1 USDC to check", "The contract splits the fee: 70% to the issuers whose claims passed, 30% to the platform."],
  ["A false claim costs money", "After a default, an upheld dispute pays the stake to the lender. Two upheld disputes suspend the issuer."],
];

function Diagram({ i }: { i: number }) {
  if (i === 0) return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3"><span className="text-quiet">Gupta Wholesale · supplier</span><span className="stamp stamp-ok">Approved issuer</span></div>
      <p className="t-title !text-lg">&ldquo;Sharma Store buys ₹45,000 a month, pays on time.&rdquo;</p>
      <p className="flex items-center gap-2 text-pine"><Lock className="size-4" aria-hidden />30 USDC locked behind this claim</p>
    </div>
  );
  if (i === 1) return (
    <div className="t-num space-y-5 text-sm">
      <div>
        <div className="flex justify-between"><span className="text-quiet">Claimed</span><span>₹45,000 / month</span></div>
        <div className="mt-2 h-1.5 bg-line"><div data-grow className="h-full w-full bg-quiet" /></div>
      </div>
      <div>
        <div className="flex justify-between"><span className="text-quiet">Paid to the verified account, per the payment app</span><span>₹45,500</span></div>
        <div className="relative mt-2 h-1.5 bg-line"><div data-grow="0.15" className="h-full w-full bg-pine" /><span className="absolute -top-1.5 left-[70%] h-4 w-px bg-ink" aria-hidden /></div>
        <p className="mt-2 text-xs text-quiet">The line is 70%: ₹31,500 needed. This one passes.</p>
      </div>
    </div>
  );
  if (i === 2) return (
    <div className="space-y-2 text-sm">
      <p className="t-title !text-lg">Sharma Store, Delhi</p>
      <p className="t-num text-quiet">asks for ₹20,000 over 6 months</p>
      <p className="text-quiet">No wallet. No fee. No crypto on the shop&apos;s side.</p>
    </div>
  );
  if (i === 3) return (
    <div className="t-num space-y-3 text-sm">
      <div className="flex h-8 w-full overflow-hidden"><div data-grow className="flex-[7] bg-pine" /><div data-grow="0.2" className="flex-[3] bg-quiet/50" /></div>
      <div className="flex justify-between"><span><b className="font-medium">0.70 USDC</b> to the issuers whose claims passed</span><span className="text-quiet">0.30 platform</span></div>
    </div>
  );
  return (
    <div className="space-y-3 text-sm">
      <p className="t-num flex items-center gap-3"><span className="stamp stamp-bad">Dispute upheld</span>30 USDC stake paid to the lender</p>
      <p className="flex items-center gap-2 text-quiet" aria-label="Two upheld disputes suspend the issuer"><span className="size-2.5 rounded-full bg-clay" /><span className="size-2.5 rounded-full bg-clay" />two strikes: issuer suspended</p>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className="scroll-mt-24">
      <p className="t-label">Chapter 01 · How it works</p>
      <h2 id="how-h" className="sr-only">How it works</h2>
      <ol>
        {STEPS.map(([title, body], i) => (
          <li key={title} data-shape-index={i + 1} data-shape-side={i % 2 === 0 ? "left" : "right"}
            className={`flex items-center py-12 md:min-h-[88svh] ${i % 2 === 0 ? "md:justify-end" : "md:justify-start"}`}>
            <div className="w-full md:max-w-[28rem]">
              <div className="t-numeral" aria-hidden>0{i + 1}</div>
              <Reveal as="h3" className="t-headline mt-6 !text-[clamp(1.9rem,3.6vw,3.4rem)]">{title}</Reveal>
              <Reveal as="p" className="t-lead mt-5" delay={0.1}>{body}</Reveal>
              <div data-rise className="mt-8 border-t border-line pt-5"><Diagram i={i} /></div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
