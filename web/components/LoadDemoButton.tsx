"use client";
// One click: wipe the shared data and load the example data (3 issuers, 3 credentials, 1 loan request).
// Same call as the Admin "Load demo" button, placed on the home page so anyone can start from it.
import { useState } from "react";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { demo } from "@/lib/mock";
import { Button } from "./ui";
import { errorToast } from "./toast";

export function LoadDemoButton() {
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!window.confirm("Reset all data for everyone and load the example data (3 issuers, 3 credentials, 1 loan request)?")) return;
    setBusy(true);
    try {
      if ((await demo.loadDemo()) !== false) toast.success("Example data loaded. Pick a role above.");
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} onClick={load}>
      <Database className="size-4" aria-hidden />Load example data
    </Button>
  );
}
