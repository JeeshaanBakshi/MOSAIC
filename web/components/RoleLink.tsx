"use client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { setRole, type Persona } from "@/lib/session";

/** Switches who you are, then goes to the page. */
export function RoleLink({ role, href, className, children }: { role: Persona; href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={() => { setRole(role); router.push(href); }}>
      {children}
    </button>
  );
}
