"use client";
// ISSUER: the evidence behind a credential.
//  - A SUPPLIER submits invoices for the shop to confirm, and can add credit notes or cancel one.
//  - A PAYMENT APP records payments (the evidence invoices are matched against) and can mark one reversed.
// Backend used: submitInvoice, addCreditNote, cancelInvoice, getInvoices / submitPaymentRecord, reversePayment, getPaymentRecords.
import { useState } from "react";
import { backend, contract, rs, type CredentialView, type InvoiceView } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Button, Field, Notice, Panel, Rows, Section, inputClass } from "@/components/ui";
import { SupplierProof } from "@/components/SupplierProof";
import { ClaimBadge, MatchBadge, OFFCHAIN_NOTE, ReliabilityBadge, TrustBadge, moneyLine } from "@/components/EvidenceBits";
import { errorToast } from "@/components/toast";
import { toast } from "sonner";

const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
const isoDate = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);

export function IssuerEvidence({ me, kind, credentials }: { me: string; kind: "Supplier" | "PaymentProvider" | undefined; credentials: CredentialView[] }) {
  if (!me || !kind) return null;
  return kind === "Supplier" ? <><SupplierProof me={me} credentials={credentials} /><SupplierInvoices me={me} credentials={credentials} /></> : <PaymentRecords me={me} />;
}

function Reliability({ me }: { me: string }) {
  const rel = useQuery(() => backend.getIssuerReliability(me), [me]);
  const warn = useQuery(() => backend.getIssuerWarnings(me), [me]);
  if (!rel.data) return null;
  const m = rel.data.metrics;
  return (
    <div className="space-y-2 rounded-(--radius-control) bg-wash p-4 text-sm">
      <div className="flex flex-wrap items-center gap-3"><span className="font-medium">Your track record</span><ReliabilityBadge category={rel.data.category} /></div>
      <p className="text-quiet">{m.credentialsIssued} credentials issued · {m.confirmed} confirmed · {m.rejected} rejected · {m.disputed} disputed · {m.pending} pending · {m.upheldOnChain + m.upheldInvoice} disputes upheld · {m.duplicates} duplicates · {m.revoked} revoked.</p>
      <p className="text-quiet">{rel.data.reasons.join(" ")}</p>
      {warn.data && (
        <p className={warn.data.removed ? "font-medium text-clay" : warn.data.warnings ? "font-medium text-ink" : "text-quiet"}>
          Warnings: {warn.data.warnings} of {warn.data.limit}. {warn.data.removed ? "You were removed from the system after 3 warnings." : warn.data.warnings ? `A warning comes from a rejection the admin approved. The ${warn.data.limit}rd removes you from the system.` : "A warning comes from a rejection the admin approves. The 3rd removes a supplier from the system."}
        </p>
      )}
    </div>
  );
}

function SupplierInvoices({ me, credentials }: { me: string; credentials: CredentialView[] }) {
  const shops = useQuery(() => backend.getShops());
  const now = useQuery(() => contract.getNow());
  const invoices = useQuery(() => backend.getInvoices({ issuer: me }), [me]);
  const usable = credentials.filter((v) => v.status === "Valid");
  const [credId, setCredId] = useState<number | null>(null);
  const cred = usable.find((v) => v.credential.id === (credId ?? usable[0]?.credential.id)) ?? null;
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [category, setCategory] = useState("Groceries and staples");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState("");
  const [validDays, setValidDays] = useState(90);
  const [busy, setBusy] = useState<string | null>(null);
  const [noting, setNoting] = useState<{ id: number; amount: string } | null>(null);
  const shopName = (id: string) => (shops.data ?? []).find((s) => s.id === id)?.name ?? id;
  const today = now.data ? isoDate(now.data) : "";

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key);
    try { await f(); toast.success(done); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  const submit = () => run("submit", async () => {
    if (!cred) return;
    await backend.submitInvoice(me, cred.credential.shopId, cred.credential.id, { ref, amountInr: Number(amount), date: date ?? today, category, description, evidenceRef: evidence, validDays });
    setRef(""); setAmount(""); setDescription(""); setEvidence("");
  }, `Sent to ${cred ? shopName(cred.credential.shopId) : "the shop"} to confirm.`);

  return (
    <Section title="Invoices for the shop to confirm" aside="The second signature on your claim">
      <div className="space-y-8">
        <Reliability me={me} />
        <Panel className="space-y-6">
          <p className="text-sm text-quiet">Attach an invoice to one of your credentials. The shop is asked to confirm it. A signed credential only proves <i>you</i> said it; the shop&apos;s confirmation and matching payments show it happened.</p>
          {usable.length === 0 ? <p className="text-sm text-quiet">Issue a credential first, then attach invoices to it.</p> : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Credential (and shop)">
                  <select className={inputClass} value={cred?.credential.id ?? ""} onChange={(e) => setCredId(Number(e.target.value))}>
                    {usable.map((v) => <option key={v.credential.id} value={v.credential.id}>#{v.credential.id}: {shopName(v.credential.shopId)}</option>)}
                  </select>
                </Field>
                <Field label="Invoice reference"><input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="INV-GW-1060" /></Field>
                <Field label="Invoice amount (₹)"><input className={inputClass} inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="45000" /></Field>
                <Field label="Invoice date"><input className={inputClass} type="date" value={date ?? today} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Goods or service category"><input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
                <Field label="Claim stays open for"><select className={inputClass} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))}>{[30, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select></Field>
              </div>
              <Field label="Description"><input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was sold" /></Field>
              <Field label="Supporting evidence reference" hint="Where the document lives, for example a GST e-invoice number. Never paste personal or bank details."><input className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
              <Button onClick={submit} disabled={busy !== null || !cred || !ref.trim() || !Number(amount) || !category.trim()} loading={busy === "submit"} className="w-full">Send to the shop to confirm</Button>
            </>
          )}
        </Panel>

        <Rows>
          {(invoices.data ?? []).length === 0 && <p className="py-4 text-sm text-quiet">No invoices yet.</p>}
          {(invoices.data ?? []).map((v) => <InvoiceRow key={v.claim.id} v={v}
            actions={!v.claim.cancelled && (
              <div className="flex flex-wrap items-center gap-2">
                {noting?.id === v.claim.id ? (
                  <>
                    <input className={`${inputClass} !w-36`} inputMode="numeric" placeholder="Credit ₹" value={noting.amount} onChange={(e) => setNoting({ id: v.claim.id, amount: digits(e.target.value) })} />
                    <Button variant="secondary" disabled={busy !== null || !Number(noting.amount)} loading={busy === `cn-${v.claim.id}`} onClick={() => run(`cn-${v.claim.id}`, async () => { await backend.addCreditNote(me, v.claim.id, Number(noting.amount), "credit note"); setNoting(null); }, "Credit note added.")}>Add credit note</Button>
                    <Button variant="ghost" onClick={() => setNoting(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => setNoting({ id: v.claim.id, amount: "" })}>Credit note</Button>
                    <Button variant="danger" disabled={busy !== null} loading={busy === `x-${v.claim.id}`} onClick={() => run(`x-${v.claim.id}`, () => backend.cancelInvoice(me, v.claim.id), "Invoice cancelled.")}>Cancel invoice</Button>
                  </>
                )}
              </div>
            )} />)}
        </Rows>
        <Notice>{OFFCHAIN_NOTE}</Notice>
      </div>
    </Section>
  );

}


function InvoiceRow({ v, actions }: { v: InvoiceView; actions: React.ReactNode }) {
  return (
    <div className="space-y-3 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">{v.claim.ref}: {rs(v.claim.amountInr)} to {v.shopName}</span>
        <ClaimBadge state={v.state} /><MatchBadge status={v.match.status} /><TrustBadge trust={v.trust} />
      </div>
      <p className="text-sm text-quiet">Invoice dated {formatDate(v.claim.invoiceDate)}, credential #{v.claim.credentialId}. {moneyLine(v.match, rs)}.</p>
      {v.claim.reason && <p className="text-sm text-quiet">The shop said: &ldquo;{v.claim.reason}&rdquo;</p>}
      {v.trustReasons.length > 0 && <p className="text-sm text-quiet">{v.trustReasons.join(" ")}</p>}
      <details className="text-sm"><summary className="cursor-pointer text-quiet underline underline-offset-4">History ({v.claim.history.length})</summary>
        <ul className="mt-2 space-y-1 text-quiet">{v.claim.history.map((h, i) => <li key={i}>{formatDate(h.at)}: {h.by} {h.action.replace(/_/g, " ")}{h.note ? ` (${h.note})` : ""}</li>)}</ul>
      </details>
      {actions}
    </div>
  );
}

function PaymentRecords({ me }: { me: string }) {
  const shops = useQuery(() => backend.getShops());
  const now = useQuery(() => contract.getNow());
  const records = useQuery(() => backend.getPaymentRecords({ provider: me }), [me]);
  const [shopId, setShopId] = useState("shop-1");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState<"settled" | "pending">("settled");
  const [busy, setBusy] = useState<string | null>(null);
  const today = now.data ? isoDate(now.data) : "";

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key);
    try { await f(); toast.success(done); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  return (
    <Section title="Payment records (the evidence invoices are matched against)">
      <div className="space-y-8">
        <Panel className="space-y-6">
          <p className="text-sm text-quiet">Record one payment you saw. If its reference quotes a supplier&apos;s invoice number, MOSAIC matches it to that invoice. In a real product this is a consented feed from your payment system, not a form.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who paid"><select className={inputClass} value={shopId} onChange={(e) => setShopId(e.target.value)}>{(shops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Account that was paid" hint="The supplier's verified account."><input className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="ICIC-0009012-11122233" /></Field>
            <Field label="Amount (₹)"><input className={inputClass} inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="45000" /></Field>
            <Field label="Payment date"><input className={inputClass} type="date" value={date ?? today} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Payment reference" hint="Quote the invoice number, e.g. UPI/INV-GW-1060."><input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Status"><select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as "settled" | "pending")}><option value="settled">Settled</option><option value="pending">Pending</option></select></Field>
          </div>
          <Button disabled={busy !== null || !account.trim() || !Number(amount) || reference.trim().length < 3} loading={busy === "pay"} className="w-full"
            onClick={() => run("pay", async () => { await backend.submitPaymentRecord(me, shopId, { payeeAccount: account, amountInr: Number(amount), date: date ?? today, reference, status }); setAmount(""); setReference(""); }, "Payment recorded. Invoices are matched again.")}>
            Record payment
          </Button>
        </Panel>
        <Rows>
          {(records.data ?? []).length === 0 && <p className="py-4 text-sm text-quiet">No payments recorded yet.</p>}
          {(records.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
              <span><b className="font-medium">{rs(p.amountInr)}</b> from {(shops.data ?? []).find((s) => s.id === p.shopId)?.name ?? p.shopId} to {p.payeeAccount}, {formatDate(p.date)}, <span className="text-quiet">{p.reference}</span> <span className="stamp stamp-unknown ml-1">{p.status}</span></span>
              {p.status !== "reversed" && <Button variant="secondary" disabled={busy !== null} loading={busy === `r-${p.id}`} onClick={() => run(`r-${p.id}`, () => backend.reversePayment(me, p.id), "Marked as reversed. It no longer counts.")}>Mark reversed</Button>}
            </div>
          ))}
        </Rows>
        <Notice>{OFFCHAIN_NOTE}</Notice>
      </div>
    </Section>
  );
}
