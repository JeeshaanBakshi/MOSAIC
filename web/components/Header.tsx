"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PERSONAS, PERSONA_IDS, setRole, useRole, type Persona } from "@/lib/session";

const LINKS = [
  { href: "/my-shop", label: "My shop" },
  { href: "/issuer", label: "Issuer" },
  { href: "/lender", label: "Lender" },
  { href: "/admin", label: "Admin" },
];

export function Header() {
  const role = useRole();
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <Logo /> MOSAIC
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {/* usePathname() needs Suspense in Next 16. The fallback is the same links, none highlighted. */}
          <Suspense fallback={<NavLinks path="" />}>
            <ActiveNavLinks />
          </Suspense>
        </nav>
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-stone-500">
          {/* CONNECT: replace with "Connect wallet" (issuers, lenders, admin) and a phone login (shopkeepers). */}
          <span className="hidden sm:inline">You are</span>
          <select aria-label="Acting as" value={role} onChange={(e) => setRole(e.target.value as Persona)}
            className="max-w-[16rem] rounded-xl border border-stone-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-stone-900">
            {PERSONA_IDS.map((p) => <option key={p} value={p}>{PERSONAS[p].label}</option>)}
          </select>
        </label>
      </div>
    </header>
  );
}

function ActiveNavLinks() {
  return <NavLinks path={usePathname()} />;
}

function NavLinks({ path }: { path: string }) {
  return LINKS.map((l) => (
    <Link key={l.href} href={l.href}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${path.startsWith(l.href) ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
      {l.label}
    </Link>
  ));
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="9" height="9" rx="2" fill="#e8890c" />
      <rect x="12" y="1" width="9" height="9" rx="2" fill="#10b981" />
      <rect x="1" y="12" width="9" height="9" rx="2" fill="#1c1917" />
      <rect x="12" y="12" width="9" height="9" rx="2" fill="#d6d3d1" />
    </svg>
  );
}
