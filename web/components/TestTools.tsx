"use client";
// ADMIN ONLY: tools for testing and demos. Reset wipes the CLOUD data, so it affects everyone using this site.
// CONNECT: delete this panel when you connect the real chain (the clock is the ledger's; there is no "reset").
import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Database, RefreshCw, RotateCcw } from "lucide-react";
import { contract, demo, noteVersion, getVersion } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Balances } from "./Balances";
import { Button, Section } from "./ui";
import { errorToast } from "./toast";

export function TestTools() {
  const now = useQuery(() => contract.getNow());
  const [busy, setBusy] = useState(false);

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(true);
    try {
      if ((await f()) !== false) toast.success(label); // false = the password prompt was cancelled
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="tools" title="Test tools" aside={`App date: ${now.data ? formatDate(now.data) : "…"}`}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => run("Skipped 30 days", () => contract.advanceTime(30))}><CalendarPlus className="size-4" aria-hidden />30 days (simulation only)</Button>
        <Button variant="secondary" disabled={busy} onClick={() => run("Skipped 90 days", () => contract.advanceTime(90))}><CalendarPlus className="size-4" aria-hidden />90 days (simulation only)</Button>
        <Button variant="secondary" disabled={busy} title="Re-read everything from the cloud"
          onClick={() => { noteVersion(getVersion() + 0.001); toast.success("Refreshed from the cloud"); }}><RefreshCw className="size-4" aria-hidden />Refresh</Button>
        <Button variant="secondary" disabled={busy}
          onClick={() => window.confirm("Reset all data for everyone and load the demo (4 issuers, 5 credentials, 2 loan requests)?") && run("Demo loaded: 4 issuers, 5 credentials and 2 loan requests", () => demo.loadDemo())}>
          <Database className="size-4" aria-hidden />Load demo
        </Button>
        <Button variant="danger" disabled={busy} title="Wipes all data in the cloud and starts again from empty"
          onClick={() => window.confirm("Reset all data for everyone?\n\nEvery issuer, application, credential, loan, dispute and log is deleted and the app starts again from empty. This cannot be undone.") && run("Everything was reset. Starting again from empty.", () => demo.resetDemo())}>
          <RotateCcw className="size-4" aria-hidden />Reset all data
        </Button>
      </div>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-quiet">
        Moving the date shows credentials expiring and stakes being released. Reset and Load demo change the shared cloud data for everyone.
      </p>
      <div className="mt-6">
        <h3 className="mb-1 text-sm font-medium">Test USDC balances</h3>
        <Balances />
      </div>
    </Section>
  );
}
