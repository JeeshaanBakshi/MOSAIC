"use client";
// SUPPLIER: "Prove you supply this shop". Ask the shop to confirm, then upload one bill PDF for each of the last 6 months
// (with the total, the number of bills and the name printed on them). MOSAIC compares each month with what the payment app
// saw the shop pay you. The text inside the PDF is not read yet: the PDF is stored for a person to open, and fingerprinted.
// Backend used: getSupplierProof, requestSupplierLink; the upload goes to POST /api/statement.
import { useState } from "react";
import { backend, EVIDENCE_MONTHS, MONTH_LABEL, noteVersion, type CredentialView } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { Badge, Button, Field, Notice, Panel, Section, Skeleton, inputClass } from "@/components/ui";
import { ProofBadge, ProofLines, ProofMonths } from "@/components/ProofBits";
import { errorToast } from "@/components/toast";
import { toast } from "sonner";

const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
const MAX_KB = 400;

export function SupplierProof({ me, credentials }: { me: string; credentials: CredentialView[] }) {
  const shops = useQuery(() => backend.getShops());
  const shopIds = [...new Set(credentials.map((v) => v.credential.shopId))];
  const [picked, setPicked] = useState<string | null>(null);
  const shopId = picked && shopIds.includes(picked) ? picked : shopIds[0] ?? "";
  const shopName = (id: string) => (shops.data ?? []).find((s) => s.id === id)?.name ?? id;
  const proof = useQuery(() => (shopId ? backend.getSupplierProof(me, shopId) : Promise.resolve(null)), [me, shopId]);

  const [month, setMonth] = useState<string>(EVIDENCE_MONTHS[0]);
  const [billed, setBilled] = useState("");
  const [count, setCount] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0); // changing this clears the file picker

  if (shopIds.length === 0) return null; // nothing to prove until the supplier has vouched for a shop
  const tooBig = !!file && file.size > MAX_KB * 1000;

  async function ask() {
    setBusy("ask");
    try { await backend.requestSupplierLink(me, shopId); toast.success(`Asked ${shopName(shopId)} to confirm you are its supplier.`); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  async function upload() {
    if (!file) return;
    setBusy("upload");
    try {
      const body = new FormData();
      body.set("file", file); body.set("issuer", me); body.set("shopId", shopId); body.set("month", month);
      body.set("billedInr", billed); body.set("billCount", count); body.set("nameOnBill", name ?? shopName(shopId));
      const res = await fetch("/api/statement", { method: "POST", body });
      const json = await res.json();
      if (typeof json.version === "number") noteVersion(json.version);
      if (!json.ok) throw new Error(json.error?.message ?? "Could not upload the bill.");
      toast.success(`${MONTH_LABEL[month]} bill uploaded. It is now checked against the payments.`);
      setFile(null); setBilled(""); setCount(""); setFileKey((k) => k + 1);
    } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const p = proof.data;
  return (
    <Section title="Prove you supply this shop" aside="Monthly bills, checked against real payments">
      <div className="space-y-8">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Shop"><select className={inputClass} value={shopId} onChange={(e) => setPicked(e.target.value)}>{shopIds.map((id) => <option key={id} value={id}>{shopName(id)}</option>)}</select></Field>
          {p && <div className="pb-2"><ProofBadge status={p.status} /></div>}
        </div>

        {!p ? <Skeleton className="block h-24 w-full" /> : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="font-medium">Does the shop say you are its supplier?</span>
              {p.link?.status === "confirmed" && <Badge state="pass">Confirmed by the shop</Badge>}
              {p.link?.status === "pending" && <Badge state="open">Waiting for the shop</Badge>}
              {p.link?.status === "rejected" && <Badge state="fail">The shop said no{p.link.reason ? `: ${p.link.reason}` : ""}</Badge>}
              {(!p.link || p.link.status === "rejected") && <Button variant="secondary" onClick={ask} loading={busy === "ask"} disabled={busy !== null}>Ask {shopName(shopId)} to confirm</Button>}
            </div>

            <Panel className="space-y-6">
              <p className="text-sm text-quiet">Upload one PDF per month: that month&apos;s bills to this shop (a statement or the bills combined). Enter the total they add up to and the customer name printed on them. A corrected upload replaces the old one for that month. PDFs up to {MAX_KB} KB.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Month"><select className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)}>{EVIDENCE_MONTHS.map((m) => <option key={m} value={m}>{MONTH_LABEL[m]}{p.statements.some((s) => s.month === m && s.current) ? " (uploaded)" : ""}</option>)}</select></Field>
                <Field label="Total billed that month (₹)"><input className={inputClass} inputMode="numeric" value={billed} onChange={(e) => setBilled(digits(e.target.value))} placeholder="45500" /></Field>
                <Field label="How many bills"><input className={inputClass} inputMode="numeric" value={count} onChange={(e) => setCount(digits(e.target.value))} placeholder="4" /></Field>
                <Field label="Customer name on the bills"><input className={inputClass} value={name ?? shopName(shopId)} onChange={(e) => setName(e.target.value)} /></Field>
              </div>
              <Field label="The bill (PDF)" hint={tooBig ? `That file is ${Math.round(file!.size / 1000)} KB. The limit is ${MAX_KB} KB: send a text PDF, not a photo.` : "Your own file stays as you made it. MOSAIC stores it and a fingerprint of it, so a reused file is caught."}>
                <input key={fileKey} type="file" accept="application/pdf,.pdf" className={inputClass} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
              <Button onClick={upload} loading={busy === "upload"} disabled={busy !== null || !file || tooBig || !Number(billed) || !Number(count) || !(name ?? shopName(shopId)).trim()} className="w-full">Upload the {MONTH_LABEL[month]} bill</Button>
            </Panel>

            <div className="space-y-3">
              <h3 className="text-sm font-medium">Your bills, month by month</h3>
              <ProofMonths months={p.months} statements={p.statements} />
            </div>

            <details className="group" open={p.status === "flagged"}>
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-medium">The seven checks on your proof</summary>
              <div className="mt-2"><ProofLines lines={p.lines} /></div>
            </details>
            <Notice>MOSAIC does not read the text inside your PDF yet (that needs document parsing). It stores the file, fingerprints it, and checks the numbers you enter against the payment records. The PDFs and these checks are kept off-chain.</Notice>
          </>
        )}
      </div>
    </Section>
  );
}
