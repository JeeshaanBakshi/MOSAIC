import { ArrowDown, ChevronRight, ExternalLink, Handshake, Landmark, ShieldCheck, Store, type LucideIcon } from "lucide-react";
import { RoleLink } from "@/components/RoleLink";
import { LoadDemoButton } from "@/components/LoadDemoButton";
import { CONTRACT_ID, contractUrl, short, txUrl } from "@/lib/format";
import type { Persona } from "@/lib/session";

const DOORS: { role: Persona; href: string; title: string; body: string; Icon: LucideIcon }[] = [
  { role: "sharma", href: "/my-shop", title: "I run a shop", body: "See who vouches for you. Ask for a loan.", Icon: Store },
  { role: "gupta", href: "/issuer", title: "I supply or serve shops", body: "Vouch for shops. Earn a fee when a lender checks.", Icon: Handshake },
  { role: "asha", href: "/lender", title: "I lend to shops", body: "Check a shop. Approve or decline loans.", Icon: Landmark },
  { role: "admin", href: "/admin", title: "I run Mosaic", body: "Approve issuers. Settle disputes.", Icon: ShieldCheck },
];

const STEPS = [
  ["An issuer vouches", "A supplier or payment app signs a one-line claim about a shop and locks a 30 USDC stake behind it."],
  ["The claim meets the receipts", "Payment-app records must back it up: 70% match, minus money that came straight back. The issuer's own numbers never pass."],
  ["The shop asks for a loan", "The shop pays nothing and never touches crypto."],
  ["The lender pays 1 USDC to check", "The contract splits the fee: 70% to the issuers whose claims passed, 30% to the platform."],
  ["A false claim costs money", "After a default, an upheld dispute pays the stake to the lender. Two upheld disputes suspend the issuer."],
];

const CASES = [
  ["Sharma Store, Delhi (honest)", "A supplier and a payment app vouch, every check passes, a loan limit is shown."],
  ["Sunrise Mart (fake shop)", "Vouched for only by QuickSupply, no payment-app receipts. Unknown, not bad. No limit."],
  ["Anand Traders (self-dealing)", "Shares the shop's phone and bank account: independence fails, the claim is not counted."],
  ["QuickSupply (inflated, round trip)", "Claims ₹1,50,000 a month. The payment app shows ₹1,40,000 came straight back: net flow fails."],
  ["Loan stacking", "Three lenders checked Sharma Store in 30 days: a warning, and the limit is halved."],
];

// Real transactions on the Stellar testnet contract (see README, "Verified on testnet").
const PROOF = [
  { label: "Lender fee split: 0.70 USDC to the supplier, 0.30 to the platform", hash: "17474d8c6f43f14a9b32611f470ae0c74f48047036fcc181a3d132753a57013f" },
  { label: "Dispute upheld: the 30 USDC stake paid to the lender", hash: "14b81f35c177eb1e2c6f2d1cc751e24cdc04a8de97d42940ac3cc1fd2aaba3c6" },
  { label: "An issuer's claim, locking a 30 USDC stake", hash: "84db28679b74d21e95c7b06db93d416c660a447fb00bcda6c9c39334023e2c80" },
];

export default function Home() {
  return (
    <div className="space-y-16 lg:space-y-24">
      <section className="max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-wide text-pine">Verification infrastructure for the next billion customers</p>
        <h1 className="mt-4 text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          A business shouldn&apos;t need a credit history to prove it has a real economic history.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-quiet">
          Distributors and payment apps vouch for the neighbourhood stores they already work with, with money behind their word. Lenders check that proof on Stellar and give those stores a loan. Missing evidence means unknown, never bad.
        </p>
        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <RoleLink role="asha" href="/lender?shop=shop-1"
            className="inline-flex min-h-14 items-center gap-3 rounded-(--radius-control) bg-pine px-8 text-base font-medium text-white shadow-sm transition-colors hover:bg-pine-deep">
            Try the demo with Sharma Store<ChevronRight className="size-5" aria-hidden />
          </RoleLink>
          <a href="#how" className="inline-flex min-h-12 items-center gap-2 text-sm font-medium text-pine underline underline-offset-4">How it works<ArrowDown className="size-4" aria-hidden /></a>
        </div>
        <p className="mt-4 text-sm text-quiet">Opens the lender view with the example data loaded. Nothing to sign up for, no wallet needed.</p>
      </section>

      <section id="how" aria-labelledby="how-h" className="scroll-mt-24">
        <h2 id="how-h" className="mb-6 text-2xl font-medium tracking-tight">How it works</h2>
        <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="border-t-2 border-line pt-4">
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-pine-soft text-sm font-medium text-pine-deep">{i + 1}</span>
              <h3 className="mt-3 text-base font-medium leading-snug">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-quiet">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="stellar-h" className="rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="stellar-h" className="text-2xl font-medium tracking-tight">Built on Stellar</h2>
          <a href={contractUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-pine underline underline-offset-4">
            Contract {short(CONTRACT_ID, 6)}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">on Stellar Expert (testnet)</span>
          </a>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-quiet">A Soroban smart contract on Stellar testnet holds the issuer registry, the stakes, the lender fee split and the disputes. These are real testnet transactions you can open:</p>
        <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
          {PROOF.map((p) => (
            <li key={p.hash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <span>{p.label}</span>
              <a href={txUrl(p.hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-pine underline underline-offset-4">
                {p.hash.slice(0, 10)}…<ExternalLink className="size-3" aria-hidden /><span className="sr-only">View on Stellar Expert</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cases">
        <h2 id="cases" className="mb-4 text-2xl font-medium tracking-tight">What the demo shows</h2>
        <ul className="divide-y divide-line border-y border-line text-sm">
          {CASES.map(([title, body]) => (
            <li key={title} className="py-4 sm:flex sm:gap-6">
              <span className="font-medium sm:w-72 sm:shrink-0">{title}</span>
              <span className="mt-1 block text-quiet sm:mt-0">{body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="who">
        <h2 id="who" className="mb-4 text-2xl font-medium tracking-tight">Explore as</h2>
        <div className="divide-y divide-line border-y border-line">
          {DOORS.map(({ role, href, title, body, Icon }) => (
            <RoleLink key={title} role={role} href={href}
              className="group flex w-full items-center gap-4 py-5 text-left transition-colors hover:bg-wash/60 sm:gap-6 sm:px-4">
              <Icon className="size-6 shrink-0 text-pine" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-medium tracking-tight">{title}</span>
                <span className="mt-1 block max-w-xl text-sm leading-relaxed text-quiet">{body}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-pine" aria-hidden />
            </RoleLink>
          ))}
        </div>
        <div className="mt-8 flex max-w-xl flex-col items-start gap-3">
          <LoadDemoButton />
          <p className="text-sm leading-relaxed text-quiet">The demo loads by itself on the first visit. This button wipes everything for everyone and loads it again.</p>
        </div>
      </section>
    </div>
  );
}
