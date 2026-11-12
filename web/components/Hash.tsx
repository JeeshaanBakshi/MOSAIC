"use client";
// A long fingerprint, shortened, with a button that copies the whole thing.
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function Hash({ value, label = "hash", head = 8, tail = 4 }: { value: string; label?: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the full value is in the title */ }
  }
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <code className="font-mono text-xs text-quiet" title={value}>{short}</code>
      <button type="button" onClick={copy} aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        className="grid size-8 place-items-center rounded-(--radius-control) text-quiet transition-colors hover:bg-wash hover:text-ink active:bg-pine-soft">
        {copied ? <Check className="size-4 text-pine" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </span>
  );
}
