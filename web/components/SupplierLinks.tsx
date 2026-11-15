"use client";
// SHOPKEEPER: "Is this business your supplier?" A supplier asks, and only the shop can say yes. This is the strongest single
// proof that a supplier really supplies the shop. Backend used: getSupplierLinks, confirmSupplierLink, rejectSupplierLink.
import { useState } from "react";
import { backend } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Badge, Button, Rows, Section, Skeleton, inputClass } from "@/components/ui";
import { errorToast } from "@/components/toast";
import { toast } from "sonner";

export function SupplierLinks({ shopId }: { shopId: string }) {
  const links = useQuery(() => backend.getSupplierLinks({ shopId }), [shopId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const list = links.data ?? [];
  const pending = list.filter((l) => l.status === "pending");

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key);
    try { await f(); toast.success(done); setAsking(null); setReason(""); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  if (!links.loading && list.length === 0) return null;
  return (
    <Section title={`Is this business your supplier? (${pending.length} waiting)`} aside="Only you can say who supplies your shop">
      {links.loading && <Skeleton className="block h-16 w-full" />}
      <Rows>
        {list.map((l) => (
          <div key={l.issuer} className="space-y-3 py-4" data-supplier={l.issuerName}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-medium">{l.issuerName}</span>
              <Badge state={l.status === "confirmed" ? "pass" : l.status === "rejected" ? "fail" : "open"}>{l.status === "confirmed" ? "You said yes" : l.status === "rejected" ? "You said no" : "Waiting for you"}</Badge>
              <span className="text-xs text-quiet">asked {formatDate(l.requestedAt)}</span>
            </div>
            {l.reason && <p className="text-sm text-quiet">Your reason: &ldquo;{l.reason}&rdquo;</p>}
            {l.status === "pending" && (asking === l.issuer ? (
              <div className="space-y-3 rounded-(--radius-control) bg-wash p-4">
                <label className="block text-sm font-medium">Why not?
                  <textarea className={`${inputClass} mt-2`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example, we have never bought from them." />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy !== null || reason.trim().length < 3} loading={busy === `n-${l.issuer}`} onClick={() => run(`n-${l.issuer}`, () => backend.rejectSupplierLink(shopId, l.issuer, reason), "Recorded. Lenders will see it.")}>Not my supplier</Button>
                  <Button variant="ghost" onClick={() => { setAsking(null); setReason(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy !== null} loading={busy === `y-${l.issuer}`} onClick={() => run(`y-${l.issuer}`, () => backend.confirmSupplierLink(shopId, l.issuer), `Confirmed: ${l.issuerName} is your supplier.`)}>Yes, they supply us</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setAsking(l.issuer); setReason(""); }}>No</Button>
              </div>
            ))}
          </div>
        ))}
      </Rows>
    </Section>
  );
}
