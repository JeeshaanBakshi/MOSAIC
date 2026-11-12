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
          <p className="text-sm leading-relaxed text-quiet">Fills the app with example shops, issuers and credentials. Switch people with &ldquo;You are&rdquo; in the menu.</p>
        </div>
      </section>

    </div>
  );
}
