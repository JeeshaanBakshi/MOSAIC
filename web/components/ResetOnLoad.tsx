"use client";
// Visiting any page with ?reset=1 starts over: ALL data wiped in the cloud (for everyone), and you act as Admin again.
// The flag is then removed from the URL so a refresh doesn't wipe things a second time.
// CONNECT: delete this with the rest of the prototype-only parts.
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { demo } from "@/lib/mock";
import { setRole } from "@/lib/session";
import { errorToast } from "./toast";

export function ResetOnLoad() {
  const wanted = useSearchParams().get("reset") === "1";
  const path = usePathname();
  const router = useRouter();
  const done = useRef(false); // React dev mode runs effects twice; reset only once

  useEffect(() => {
    if (!wanted || done.current) return;
    done.current = true;
    router.replace(path); // drop ?reset=1 first, so a refresh never wipes twice
    demo.resetDemo().then((done) => {
      if (!done) return; // password prompt cancelled
      setRole("admin");
      toast.success("Fresh start: all data wiped, acting as MOSAIC admin");
    }).catch(errorToast);
  }, [wanted, path, router]);

  return null;
}
