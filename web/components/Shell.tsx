"use client";
// The frame around every page: a quiet rail on large screens, a top bar and drawer on smaller ones.
// CONNECT: replace the "You are" switcher with a wallet button (issuers, lenders, admin) and a phone login (shopkeepers).
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Handshake, Info, Landmark, Menu, ShieldCheck, Store, X, type LucideIcon } from "lucide-react";
import { PERSONAS, PERSONA_GROUPS, PERSONA_IDS, setRole, useRole, type Persona } from "@/lib/session";

const NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/my-shop", label: "My shop", Icon: Store },
  { href: "/issuer", label: "Issuer", Icon: Handshake },
  { href: "/lender", label: "Lender", Icon: Landmark },
  { href: "/admin", label: "Admin", Icon: ShieldCheck },
];

/** True on large screens (the rail), false on phones and tablets (the drawer). The server assumes large. */
function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop(); // render ONE navigation, never both: two role switchers in the page would confuse screen readers and tests
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Large screens: fixed rail */}
      {desktop && (
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
          <Rail onNavigate={() => {}} />
        </aside>
      )}

      {/* Smaller screens: top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6 lg:hidden">
        <Wordmark />
        <button aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="drawer"
          onClick={() => setOpen((o) => !o)} className="grid size-10 place-items-center rounded-(--radius-control) text-ink hover:bg-wash">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && <div className="fixed inset-0 top-14 z-20 bg-ink/20 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      {!desktop && open && (
        <aside id="drawer" className="fixed inset-x-0 top-14 z-30 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-line bg-surface lg:hidden">
          <Rail compact onNavigate={() => setOpen(false)} />
        </aside>
      )}

      <main className="mx-auto w-full max-w-[68rem] px-6 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-14">{children}</main>
    </div>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 text-ink">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <rect x="1" y="1" width="8" height="8" rx="1.5" fill="#2E5E8C" />
        <rect x="11" y="1" width="8" height="8" rx="1.5" fill="#2E5E8C" opacity=".55" />
        <rect x="1" y="11" width="8" height="8" rx="1.5" fill="#2E5E8C" opacity=".3" />
        <rect x="11" y="11" width="8" height="8" rx="1.5" fill="#2E5E8C" opacity=".12" />
      </svg>
      <span className="text-lg font-medium tracking-tight">Mosaic</span>
    </Link>
  );
}

function Rail({ compact = false, onNavigate }: { compact?: boolean; onNavigate: () => void }) {
  const role = useRole();
  return (
    <div className={`flex h-full flex-col ${compact ? "gap-6 px-6 py-6 sm:px-6" : "gap-10 px-6 py-8"}`}>
      {!compact && <Wordmark />}
      <nav aria-label="Main" className="flex flex-col gap-1">
        <Suspense fallback={<NavLinks path="" onNavigate={onNavigate} />}>
          <ActiveNav onNavigate={onNavigate} />
        </Suspense>
      </nav>
      <div className="mt-auto space-y-4">
        <label className="block">
          <span className="text-sm font-medium">You are</span>
          <select aria-label="You are" value={role} onChange={(e) => setRole(e.target.value as Persona)}
            className="mt-2 block min-h-10 w-full rounded-(--radius-control) border border-line bg-surface px-4 text-sm text-ink focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine/20">
            {PERSONA_GROUPS.map((g) => (
              <optgroup key={g.kind} label={g.label}>
                {PERSONA_IDS.filter((p) => PERSONAS[p].kind === g.kind).map((p) => <option key={p} value={p}>{PERSONAS[p].name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="flex gap-2 text-xs leading-relaxed text-quiet">
          <Info className="mt-1 size-3.5 shrink-0" aria-hidden />
          Prototype. The blockchain is simulated, the money is test USDC, and all data is made up.
        </p>
      </div>
    </div>
  );
}

function ActiveNav({ onNavigate }: { onNavigate: () => void }) {
  return <NavLinks path={usePathname()} onNavigate={onNavigate} />;
}

function NavLinks({ path, onNavigate }: { path: string; onNavigate: () => void }) {
  return NAV.map(({ href, label, Icon }) => {
    const active = path.startsWith(href) || (href === "/my-shop" && path.startsWith("/shop/"));
    return (
      <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
        className={`flex min-h-10 items-center gap-4 rounded-(--radius-control) px-4 text-sm font-medium transition-colors ${active ? "bg-pine-soft text-pine" : "text-quiet hover:bg-wash hover:text-ink"}`}>
        <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
        {label}
      </Link>
    );
  });
}
