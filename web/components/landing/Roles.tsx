// EXPLORE: four doors, one per role. Hover slides the arrow out and lights the title; clicking switches who you are
// (the same switch as the "You are" menu) and opens that role's page.
import { ArrowUpRight, Handshake, Landmark, ShieldCheck, Store, type LucideIcon } from "lucide-react";
import { RoleLink } from "@/components/RoleLink";
import type { Persona } from "@/lib/session";

const DOORS: { role: Persona; href: string; title: string; body: string; Icon: LucideIcon }[] = [
  { role: "sharma", href: "/my-shop", title: "I run a shop", body: "See who vouches for you. Ask for a loan.", Icon: Store },
  { role: "gupta", href: "/issuer", title: "I supply or serve shops", body: "Vouch for shops. Earn a fee when a lender checks.", Icon: Handshake },
  { role: "asha", href: "/lender", title: "I lend to shops", body: "Check a shop. Approve or decline loans.", Icon: Landmark },
  { role: "admin", href: "/admin", title: "I run Mosaic", body: "Approve issuers. Settle disputes.", Icon: ShieldCheck },
];

export function Roles() {
  return (
    <section aria-labelledby="who">
      <p className="t-label">Chapter 04 · Explore</p>
      <h2 id="who" className="t-headline mt-6">Explore <span className="t-serif">as</span></h2>
      <div className="mt-10 divide-y divide-line border-y border-line">
        {DOORS.map(({ role, href, title, body, Icon }) => (
          <RoleLink key={title} role={role} href={href} className="group relative flex w-full items-center gap-5 py-8 text-left transition-colors hover:bg-pine-soft/60 sm:gap-8 sm:px-4">
            <Icon className="size-7 shrink-0 text-quiet transition-colors group-hover:text-pine" strokeWidth={1.25} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="t-headline block !text-[clamp(1.6rem,3vw,2.8rem)] transition-transform duration-500 group-hover:translate-x-2">{title}</span>
              <span className="mt-2 block text-quiet">{body}</span>
            </span>
            <ArrowUpRight className="size-7 shrink-0 text-quiet opacity-0 transition-all duration-500 group-hover:translate-x-1 group-hover:text-pine group-hover:opacity-100" aria-hidden />
          </RoleLink>
        ))}
      </div>
    </section>
  );
}
