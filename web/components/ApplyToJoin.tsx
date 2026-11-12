"use client";
// How a business asks to become an issuer. Three steps, one panel at a time:
//   1. fill in the form          -> backend.submitApplication   (the backend emails a 6-digit code)
//   2. type the emailed code     -> backend.verifyEmail
//   3. sign the request          -> contract.requestIssuer      (only a HASH of the details goes on-chain)
// Then the admin reviews it. The details (tax number, phone, ...) never go on-chain. Only their fingerprint does.
import { useState } from "react";
import { CircleCheck, Mail, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { ACCOUNTS, backend, contract, type ApplicationForm, type PublicApplication, type RoleId } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { Badge, Button, Field, Notice, Panel, inputClass } from "./ui";
import { errorToast, txToast } from "./toast";

const EMPTY: ApplicationForm = { businessName: "", kind: "Supplier", registrationNumber: "", ownerName: "", phone: "", email: "", bankAccountHolder: "" };

export function ApplyToJoin({ role }: { role: RoleId }) {
  const me = ACCOUNTS[role].address;
  const request = useQuery(() => contract.getIssuerRequest(me), [me]);
  const app = useQuery(() => backend.getApplication(me), [me]);
  const inbox = useQuery(() => (app.data ? backend.getInbox(app.data.email) : Promise.resolve([])), [app.data?.email]);

  const [form, setForm] = useState<ApplicationForm>(EMPTY);
  const [code, setCode] = useState("");
  const [showForm, setShowForm] = useState(false); // "Apply again" after a rejection
  const [busy, setBusy] = useState<string | null>(null);

  const set = <K extends keyof ApplicationForm>(k: K, v: ApplicationForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const example = backend.exampleApplication(role);

  async function run(key: string, f: () => Promise<void>) {
    setBusy(key);
    try { await f(); } catch (e) { errorToast(e); } finally { setBusy(null); }
  }

  // Tell the truth about the email: sent, failed, or (development only) not configured.
  const announce = (a: PublicApplication, again = false) => {
    if (a.emailDelivery === "sent") {
      toast.success(again ? `A new code was emailed to ${a.email}. The old one no longer works.` : `We emailed a code to ${a.email}.`);
    } else if (a.emailDelivery === "failed") {
      toast.error("We could not send the email", { description: a.emailError, duration: 12000 });
    } else {
      toast.info("No email service is set up here, so the code is in the prototype inbox below.");
    }
  };

  const submit = () => run("submit", async () => {
    const a = await backend.submitApplication(me, form);
    setShowForm(false);
    setCode("");
    announce(a);
  });
  const verify = () => run("verify", async () => {
    await backend.verifyEmail(me, code);
    toast.success("Email verified");
  });
  const resend = () => run("resend", async () => {
    announce(await backend.resendOtp(me), true);
  });
  const sign = () => run("sign", async () => {
    const a = app.data!;
    const { hash } = await contract.requestIssuer(me, a.businessName, a.kind, a.evidenceHash);
    await backend.markRequested(me);
    txToast("Request sent. Now the admin reviews it.", hash);
  });

  if (request.loading || app.loading) return null;

  // ---- waiting for the admin ----
  if (request.data?.status === "Pending") {
    return (
      <Panel className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium tracking-tight">Request sent</h2>
          <Badge state="open">Waiting for the admin</Badge>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-quiet">
          {request.data.name} asked to join on {formatDate(request.data.requestedAt)}. The admin runs the automatic checks and may also review you by hand.
          Switch to the Mosaic admin to see what they see.
        </p>
        <p className="truncate text-xs text-faint">On-chain fingerprint: {request.data.evidenceHash.slice(0, 16)}…</p>
      </Panel>
    );
  }

  // ---- enter the emailed code ----
  if (app.data && !app.data.emailVerified) {
    const latest = inbox.data?.[0];
    return (
      <Panel className="space-y-5">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Step 2 of 3: verify your email</h2>
          {app.data.emailDelivery === "sent" && <p className="mt-1 max-w-xl text-sm leading-relaxed text-quiet">Code sent to {app.data.email}. Valid 10 minutes, 3 tries.</p>}
          {app.data.emailDelivery === "not_configured" && <p className="mt-1 max-w-xl text-sm leading-relaxed text-quiet">Code made for {app.data.email}. Valid 10 minutes, 3 tries.</p>}
        </div>
        {app.data.emailDelivery === "failed" && (
          <Notice tone="error">
            <div className="font-medium">The email could not be sent.</div>
            <p className="mt-1">{app.data.emailError}</p>
            <p className="mt-1">Check the email address, then choose &ldquo;Send a new code&rdquo;.</p>
          </Notice>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="6-digit code">
              <input className={inputClass} inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="123456" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <Button onClick={verify} disabled={busy !== null || code.length !== 6}><CircleCheck className="size-4" aria-hidden />{busy === "verify" ? "Checking…" : "Verify email"}</Button>
          <Button variant="secondary" onClick={resend} disabled={busy !== null}><RotateCw className="size-4" aria-hidden />{busy === "resend" ? "…" : "Send a new code"}</Button>
        </div>
        {app.data.emailDelivery === "not_configured" && latest && (
          <div className="flex gap-3 rounded-(--radius-control) border border-dashed border-line bg-wash p-4 text-sm">
            <Mail className="mt-0.5 size-4 shrink-0 text-quiet" aria-hidden />
            <div>
              <div className="font-medium">Prototype inbox: no email service is set up on this server</div>
              <div className="mt-1">{latest.subject}</div>
              <div className="text-quiet">{latest.body}</div>
              <div className="mt-1 text-xs text-faint">To: {latest.to}</div>
            </div>
          </div>
        )}
      </Panel>
    );
  }

  // ---- sign the request on-chain ----
  if (app.data && app.data.emailVerified && !app.data.requested) {
    const tax = app.data.kind === "Supplier" ? "GSTIN" : "RBI licence";
    return (
      <Panel className="space-y-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Step 3 of 3: sign your request</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-quiet">Email verified. Sign to send your request to the admin.</p>
        </div>
        <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
          {[["Business", app.data.businessName], ["Type", app.data.kind === "Supplier" ? "Supplier" : "Payment app"], [tax, app.data.registrationNumber], ["Owner", app.data.ownerName], ["Phone", app.data.phone], ["Bank account holder", app.data.bankAccountHolder]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-2"><dt className="text-quiet">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <Button onClick={sign} disabled={busy !== null} className="w-full">{busy === "sign" ? "Signing…" : "Sign and send request"}</Button>
      </Panel>
    );
  }

  // ---- rejected: offer to apply again ----
  if (request.data?.status === "Rejected" && !showForm) {
    return (
      <Notice tone="error">
        <div className="font-medium">The admin rejected your request.</div>
        <p className="mt-1">You can fix what was wrong and apply again.</p>
        <Button variant="secondary" className="mt-3" onClick={() => setShowForm(true)}>Apply again</Button>
      </Notice>
    );
  }

  // ---- the form ----
  const isSupplier = form.kind === "Supplier";
  return (
    <Panel className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-lg font-medium tracking-tight">Join the issuer registry</h2>
          <p className="mt-1 text-sm leading-relaxed text-quiet">The admin reviews your details.</p>
        </div>
        {example && <Button variant="secondary" onClick={() => setForm(example)}>Fill in an example</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name"><input className={inputClass} value={form.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
        <Field label="Type">
          <select className={inputClass} value={form.kind} onChange={(e) => set("kind", e.target.value as ApplicationForm["kind"])}>
            <option value="Supplier">Supplier, sells goods to shops</option>
            <option value="PaymentProvider">Payment app, processes shop payments</option>
          </select>
        </Field>
        <Field label={isSupplier ? "GSTIN" : "RBI licence number"}
          hint={isSupplier ? "15-character Indian tax number." : "Like PA-RBI-2023-0457."}>
          <input className={inputClass} value={form.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} />
        </Field>
        <Field label="Owner or authorized person"><input className={inputClass} value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
        <Field label="Phone"><input className={inputClass} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email" hint="We email a code."><input className={inputClass} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Bank account holder name" hint="Must match the business name."><input className={inputClass} value={form.bankAccountHolder} onChange={(e) => set("bankAccountHolder", e.target.value)} /></Field>
      </div>
      <Button onClick={submit} disabled={busy !== null} className="w-full">{busy === "submit" ? "Sending code…" : "Submit and email me a code"}</Button>
    </Panel>
  );
}
