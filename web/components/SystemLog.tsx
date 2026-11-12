"use client";
// The backend's own log, newest first: applications, emails sent or failed, wrong codes, manual reviews,
// loan decisions, refused calls, resets. (The contract log shows blockchain transactions.)
// The same lines are also printed to the server log (Vercel > Logs).
// CONNECT: with a real backend this becomes your server's logs. Keep the events, drop this panel.
import { ChevronDown } from "lucide-react";
import { backend } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";

const COLOR = { info: "text-quiet", warn: "text-ink", error: "text-clay" } as const;

export function SystemLog() {
  const { data, error } = useQuery(() => backend.listAuditLog());
  const items = data ?? [];
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <ChevronDown className="size-4 text-quiet transition-transform group-open:rotate-180" aria-hidden />
        System log ({items.length} line{items.length === 1 ? "" : "s"})
      </summary>
      {error && <p className="mt-2 text-sm text-clay">Could not load the log: {error.message}</p>}
      <ul className="mt-4 max-h-80 divide-y divide-line overflow-auto border-y border-line">
        {items.length === 0 && <li className="py-4 text-sm text-quiet">Nothing logged yet.</li>}
        {items.map((l) => (
          <li key={l.id} className={`flex gap-4 py-2 text-sm ${COLOR[l.level]}`}>
            <span className="shrink-0 tabular-nums text-faint">{l.at.slice(11, 19)}</span>
            <span><span className="font-medium">{l.event}</span> {l.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
