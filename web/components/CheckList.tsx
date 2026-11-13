import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { Result } from "@/lib/mock";

/** Anything with a label, a result and a reason can be shown here: fraud checks, onboarding checks, shop checks. */
export interface RowLike {
  check?: number; // the fraud-check number (1 to 6), when it has one
  label: string;
  result: Result;
  reason: string;
  source?: string; // whose data the answer came from, shown quietly
  numbers?: string; // the figures the verdict used
}

const ICON = {
  pass: { Icon: CircleCheck, cls: "text-pine", word: "Passed" },
  fail: { Icon: CircleX, cls: "text-clay", word: "Failed" },
  unknown: { Icon: CircleDashed, cls: "text-faint", word: "Unknown" },
} as const;

/** One line per check: the result as an icon, what was checked, and why, with the numbers. */
export function CheckList({ rows }: { rows: RowLike[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((r) => {
        const { Icon, cls, word } = ICON[r.result];
        return (
          <li key={r.label} className="flex gap-4 py-4">
            <Icon className={`mt-1 size-[18px] shrink-0 ${cls}`} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium"><span className="sr-only">{word}: </span>{r.label}</span>
                {r.source && <span className="text-xs text-faint">{r.source}</span>}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-quiet">{r.reason}</p>
              {r.numbers && <p className="mt-1 text-xs leading-relaxed text-faint">Numbers: {r.numbers}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
