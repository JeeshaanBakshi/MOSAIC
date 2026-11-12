"use client";
// Keeps every open browser up to date: asks the server "has anything changed?" every few seconds
// (and as soon as you come back to the tab). If it has, every screen re-reads its data.
import { useEffect } from "react";
import { noteVersion } from "@/lib/mock";

const EVERY_MS = 5000;

export function CloudSync() {
  useEffect(() => {
    let stopped = false;
    async function check() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (res.ok) noteVersion(((await res.json()) as { version: number }).version);
      } catch { /* offline: try again next time */ }
    }
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}
