"use client";
// "What the contract did": every successful transaction, newest first, with the money it moved.
// Do something, then read what it caused.
// CONNECT: fill this from the contract's events (Soroban RPC `getEvents`) or from Horizon's transaction list.
import { ChevronDown } from "lucide-react";
import { contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";

export function ActivityLog() {
  const { data } = useQuery(() => contract.listActivity());
  const items = data ?? [];
  return (
    <details id="logs" className="group scroll-mt-24">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
        What the contract did ({items.length} transaction{items.length === 1 ? "" : "s"})
      </summary>
      <ol className="mt-3 divide-y divide-line border-y border-line">
        {items.map((a) => (
          <li key={a.n} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">{a.fn}</span>
              <span className="text-sm text-quiet">signed by {a.caller}</span>
              <span className="ml-auto text-xs text-faint">{formatDate(a.time)}</span>
            </div>
            <p className="mt-0.5 text-sm">{a.summary}</p>
            {a.effects.map((e, i) => <p key={i} className="text-sm text-pine">{e}</p>)}
            <p className="mt-0.5 truncate text-xs text-faint">Transaction {a.n}, hash {a.hash.slice(0, 20)}… (simulated)</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
