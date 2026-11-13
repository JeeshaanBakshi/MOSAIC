import { ChevronRight, Handshake, Landmark, ShieldCheck, Store, type LucideIcon } from "lucide-react";
import { RoleLink } from "@/components/RoleLink";
import { LoadDemoButton } from "@/components/LoadDemoButton";
import type { Persona } from "@/lib/session";

const DOORS: { role: Persona; href: string; title: string; body: string; Icon: LucideIcon }[] = [
  { role: "sharma", href: "/my-shop", title: "I run a shop", body: "See who vouches for you. Ask for a loan.", Icon: Store },
  { role: "gupta", href: "/issuer", title: "I supply or serve shops", body: "Vouch for shops. Earn a fee when a lender checks.", Icon: Handshake },
  { role: "asha", href: "/lender", title: "I lend to shops", body: "Check a shop. Approve or decline loans.", Icon: Landmark },
  { role: "admin", href: "/admin", title: "I run Mosaic", body: "Approve issuers. Settle disputes.", Icon: ShieldCheck },
];

const CASES = [
  ["1. Sharma Store (honest)", "A supplier and a payment app vouch, every check passes, and a loan limit is shown."],
  ["2. Fake shop (Shop 3)", "Listed and vouched for by one supplier only, no payment-app receipts: needs an independent payment app. Unknown, no limit."],
  ["3. Self-dealing (Issuer 4)", "Shares the shop's phone and bank account: independence fails and the claim is not counted."],
  ["4. Inflated, round-trip (Issuer 3)", "Claims ₹1,50,000 a month. The payment app shows ₹1,50,000 out and ₹1,40,000 back within 30 days: net flow fails."],
  ["5. Stacking", "On the Lender page, press \u201cDemo: 2 other lenders also check this shop\u201d on Sharma: 3 checks in 30 days, warning shown."],
];

const STEPS = [
  ["Suppliers and payment apps vouch", "Each puts 30 USDC behind its claim."],
  ["Claims meet the receipts", "A claim counts only if payments back it up."],
  ["The shop asks for a loan", "The shop requests an amount."],
  ["The lender decides", "1 USDC to check, then a recommendation."],
];

export default function Home() {
  return (
    <div className="space-y-14 lg:space-y-20">
      <section className="max-w-3xl">
        <h1 className="text-4xl font-light leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          A business shouldn&apos;t need a credit history to prove it has a real economic history.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-quiet">Suppliers and payment apps vouch for small shops, with money behind their word. Missing evidence means unknown, never bad.</p>
        <RoleLink role="sharma" href="/my-shop" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-(--radius-control) bg-pine px-6 text-sm font-medium text-white transition-colors hover:bg-pine-deep">
          Try the demo with Sharma Store<ChevronRight className="size-4" aria-hidden />
        </RoleLink>
      </section>

      <section aria-labelledby="cases">
        <h2 id="cases" className="mb-4 text-lg font-medium tracking-tight">The fraud demo: 5 cases on the Lender page</h2>
        <ol className="divide-y divide-line border-y border-line text-sm">
          {CASES.map(([title, body]) => (
            <li key={title} className="py-4 sm:flex sm:gap-6">
              <span className="font-medium sm:w-64 sm:shrink-0">{title}</span>
              <span className="mt-1 block text-quiet sm:mt-0">{body}</span>
            </li>
          ))}
        </ol>
        <RoleLink role="asha" href="/lender" className="mt-4 text-sm font-medium text-pine underline underline-offset-4">Open the Lender page as Lender 1</RoleLink>
      </section>

      <section aria-labelledby="who">
        <h2 id="who" className="mb-4 text-lg font-medium tracking-tight">Who are you?</h2>
        <div className="divide-y divide-line border-y border-line">
          {DOORS.map(({ role, href, title, body, Icon }) => (
            <RoleLink key={title} role={role} href={href}
              className="group flex w-full items-center gap-4 py-6 text-left transition-colors hover:bg-wash/60 sm:gap-6 sm:px-4">
              <Icon className="size-6 shrink-0 text-pine" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-light tracking-tight">{title}</span>
                <span className="mt-1 block max-w-xl text-sm leading-relaxed text-quiet">{body}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-pine" aria-hidden />
            </RoleLink>
          ))}
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-4 text-lg font-medium tracking-tight">How it works</h2>
        <ol className="grid gap-x-8 gap-y-6 border-t border-line pt-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <div className="text-sm text-faint">{i + 1}</div>
              <div className="mt-1 font-medium">{title}</div>
              <p className="mt-2 text-sm leading-relaxed text-quiet">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex max-w-xl flex-col items-start gap-4">
          <LoadDemoButton />
          <p className="text-sm leading-relaxed text-quiet">The demo loads by itself on the first visit. This button wipes everything for everyone and loads it again.</p>
        </div>
      </section>

    </div>
  );
}
