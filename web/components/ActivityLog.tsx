"use client";
// "What the contract did": every successful transaction, newest first, with the money it moved.
// Do something, then read what it caused.
// CONNECT: fill this from the contract's events (Soroban RPC `getEvents`) or from Horizon's transaction list.
import { ChevronDown } from "lucide-react";
import { contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Hash } from "@/components/Hash";

export function ActivityLog({ caller, title = "What the contract did" }: { caller?: string; title?: string }) {
  const { data } = useQuery(() => contract.listActivity());
  const items = (data ?? []).filter((a) => !caller || a.caller === caller); // a caller = show only that account's transactions
  return (
    <details id="logs" className="group scroll-mt-24">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
        {title} ({items.length} transaction{items.length === 1 ? "" : "s"})
      </summary>
      {items.length === 0 && <p className="mt-2 text-sm text-quiet">Nothing yet. Transactions appear here as soon as you sign one.</p>}
      <ol className="mt-2 divide-y divide-line border-y border-line">
        {items.map((a) => (
          <li key={a.n} className="py-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-sm font-medium">{a.fn}</span>
              <span className="text-sm text-quiet">signed by {a.caller}</span>
              <span className="ml-auto text-xs text-faint">{formatDate(a.time)}</span>
            </div>
            <p className="mt-1 text-sm">{a.summary}</p>
            {a.effects.map((e, i) => <p key={i} className="text-sm text-pine">{e}</p>)}
            <p className="mt-1 text-xs text-quiet">Transaction {a.n}, hash <Hash value={a.hash} label="transaction hash" /> (simulated)</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
