// The small set of pieces every page is built from. Plain Tailwind, Lucide icons, no component library.
// Structure comes from hairlines and spacing. Boxes (Panel) are kept for the one primary action on a page.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Clock3, Info, TriangleAlert, type LucideIcon } from "lucide-react";

export function Panel({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-(--radius-panel) border border-line bg-surface p-5 sm:p-6 ${className}`} {...rest}>{children}</div>;
}
/** Older name, same thing. */
export const Card = Panel;

export function Button({
  variant = "primary", className = "", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-pine text-white hover:bg-pine-deep",
    secondary: "border border-line bg-surface text-ink hover:bg-wash",
    danger: "border border-clay/40 bg-surface text-clay hover:bg-clay-soft",
    ghost: "text-quiet hover:bg-wash hover:text-ink",
  }[variant];
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-(--radius-control) px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
      {...props}
    />
  );
}

type Tone = "ok" | "bad" | "quiet" | "open";
const TONES: Record<Tone, { cls: string; Icon: LucideIcon }> = {
  ok: { cls: "bg-pine-soft text-pine", Icon: CircleCheck },
  bad: { cls: "bg-clay-soft text-clay", Icon: CircleX },
  quiet: { cls: "bg-wash text-quiet", Icon: CircleDashed },
  open: { cls: "border border-ink/25 bg-surface text-ink", Icon: Clock3 },
};
const STATE_TONE: Record<string, Tone> = {
  verified: "ok", pass: "ok", Valid: "ok", active: "ok",
  failed: "bad", fail: "bad", Revoked: "bad", Suspended: "bad", suspended: "bad",
  unknown: "quiet", Expired: "quiet",
  open: "open",
};

/** A status. The icon says it too, so colour is never the only signal. */
export function Badge({ state, children }: { state: string; children?: ReactNode }) {
  const { cls, Icon } = TONES[STATE_TONE[state] ?? "quiet"];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden strokeWidth={2} />
      {children ?? state}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-quiet">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block min-h-10 w-full rounded-(--radius-control) border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine/20";

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="max-w-2xl">
      <h1 className="text-3xl font-light leading-tight tracking-tight text-ink sm:text-4xl">{title}</h1>
      {children && <p className="mt-3 text-base leading-relaxed text-quiet">{children}</p>}
    </header>
  );
}

/** A titled part of a page, set off by a hairline. */
export function Section({ title, aside, children, id, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-24 border-t border-line pt-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-medium tracking-tight">{title}</h2>
        {aside && <div className="text-sm text-quiet">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Items separated by hairlines, no boxes. */
export function Rows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-line border-y border-line ${className}`}>{children}</div>;
}

const NOTICE: Record<"info" | "warn" | "error", { cls: string; Icon: LucideIcon }> = {
  info: { cls: "bg-wash text-ink", Icon: Info },
  warn: { cls: "border border-ink/20 bg-surface text-ink", Icon: TriangleAlert },
  error: { cls: "bg-clay-soft text-clay", Icon: CircleAlert },
};

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const { cls, Icon } = NOTICE[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`flex gap-3 rounded-(--radius-control) px-4 py-3 text-sm leading-relaxed ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A figure with a plain label. No box. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-sm text-quiet">{label}</div>
      <div className="mt-1 text-3xl font-light tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-quiet">{hint}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-quiet">{children}</p>;
}
