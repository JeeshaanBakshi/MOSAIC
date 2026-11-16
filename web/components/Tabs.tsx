"use client";
// A row of tabs: one area of a long page is shown at a time. Keyboard: left and right arrows move between tabs.
import type { KeyboardEvent } from "react";

export interface TabDef<T extends string> { id: T; label: string; count?: number }

export function Tabs<T extends string>({ tabs, active, onChange, label }: { tabs: TabDef<T>[]; active: T; onChange: (id: T) => void; label: string }) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="-mx-6 flex gap-1 overflow-x-auto border-b border-line px-6 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
      {tabs.map((t) => (
        <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={t.id === active} aria-controls={`panel-${t.id}`} tabIndex={t.id === active ? 0 : -1} onClick={() => onChange(t.id)}
          className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-4 text-sm font-medium transition-colors ${t.id === active ? "border-pine text-ink" : "border-transparent text-quiet hover:border-line hover:text-ink"}`}>
          {t.label}
          {!!t.count && <span className="grid min-w-5 place-items-center rounded-full bg-pine px-1.5 text-[11px] font-semibold leading-5 text-paper">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The panel that belongs to a tab. Only the active one is on the page. */
export function TabPanel({ id, active, children }: { id: string; active: string; children: React.ReactNode }) {
  if (id !== active) return null;
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="space-y-8">{children}</div>;
}
