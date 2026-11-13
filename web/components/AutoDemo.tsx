"use client";
// First visit: if the shared data is EMPTY, the server fills it with the demo (once, under its lock), so there is
// always something to look at. If anyone has data already, nothing happens. Skipped on ?reset=1 pages.
// CONNECT: delete with the rest of the prototype-only parts.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { demo } from "@/lib/mock";

export function AutoDemo() {
  const ran = useRef(false); // React dev mode runs effects twice
  useEffect(() => {
    if (ran.current || window.location.search.includes("reset=1")) return;
    ran.current = true;
    demo.ensureDemo().then((seeded) => { if (seeded) toast.success("Example data loaded: 5 demo cases are ready"); }).catch(() => { /* the page still works, empty */ });
  }, []);
  return null;
}
