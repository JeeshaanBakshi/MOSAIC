import { contract as c, backend as b, ACCOUNTS as A, ApiError, withState, resetEverything } from "./engine";
import { getStorage, storageKind } from "../lib/server/storage";
let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, x = "") => { cond ? pass++ : fail++; console.log(cond ? "  ✔" : "  ✘ FAIL", n, x); };
const H = { Authorization: "Bearer testtoken" };
const dump = async () => (await fetch("http://127.0.0.1:4401/_dump", { headers: H })).json() as Promise<Record<string, string>>;
const stats = async () => (await fetch("http://127.0.0.1:4401/_stats", { headers: H })).json() as Promise<{ total: number; sets: number }>;
const sent = async () => (await fetch("http://127.0.0.1:4402/sent")).json() as Promise<any[]>;
const mode = (fail: boolean) => fetch("http://127.0.0.1:4402/mode", { method: "POST", body: JSON.stringify({ fail }) });
const codeIn = (m: any) => m.text.match(/\d{6}/)[0] as string;
const gupta = A.gupta.address, form = b.exampleApplication("gupta")!;

(async () => {
  console.log("-- cloud storage (Upstash Redis REST)");
  ok("storage is Redis", storageKind() === "redis" && getStorage().kind === "redis");
  await resetEverything();
  let d = await dump();
  ok("state + version are saved in Redis", !!d["mosaic:state"] && d["mosaic:version"] !== undefined);
  ok("saved state is valid JSON with the current schema", JSON.parse(d["mosaic:state"]).schema === 5);
  ok("reset left an audit line", JSON.parse(d["mosaic:state"]).db.auditLog[0].event === "reset");
  ok("no lock left behind", d["mosaic:lock"] === undefined);

  console.log("-- two visitors at once never overwrite each other");
  const start = (await withState(() => c.getNow(), { readOnly: true })).result;
  await Promise.all(Array.from({ length: 25 }, () => withState(() => c.advanceTime(1))));
  const after = (await withState(() => c.getNow(), { readOnly: true })).result;
  ok("25 parallel changes -> exactly +25 days (no lost updates)", after - start === 25 * 86400, String((after - start) / 86400));
  ok("lock released after all of them", (await dump())["mosaic:lock"] === undefined);

  const before = await stats();
  await withState(() => c.getConfig(), { readOnly: true });
  const afterRead = await stats();
  ok("a read does not write to the cloud", afterRead.sets === before.sets, `sets ${before.sets} -> ${afterRead.sets}`);

  try { await withState(async () => { throw new Error("boom"); }); } catch { /* expected */ }
  ok("lock is released even when a call crashes", (await dump())["mosaic:lock"] === undefined);
  ok("the next call still works after a crash", (await withState(() => c.getNow(), { readOnly: true })).result === after);

  console.log("-- a refused contract call changes nothing, but is on the record when the server logs it");
  const v0 = (await withState(async () => 0, { readOnly: true })).version;
  try { await withState(() => c.addIssuer(gupta, gupta, "X", "Supplier")); } catch { /* NotAdmin */ }
  ok("version unchanged after a failed contract call", (await withState(async () => 0, { readOnly: true })).version === v0);

  console.log("-- real email (Resend API)");
  const sub = await withState(() => b.submitApplication(gupta, form));
  const msgs = await sent();
  ok("one email was sent to the applicant", msgs.length === 1 && msgs[0].to[0] === form.email, JSON.stringify(msgs[0]?.to));
  ok("it used the secret key in the Authorization header", msgs[0].auth === "Bearer resend-test-key");
  ok("subject + 6-digit code in text and html", msgs[0].subject.includes("verification code") && /\d{6}/.test(msgs[0].text) && msgs[0].html.includes(codeIn(msgs[0])));
  ok("sender is the default Resend test sender", String(msgs[0].from).includes("onboarding@resend.dev"));
  ok("the app reports delivery 'sent'", sub.result.emailDelivery === "sent");
  ok("browser-visible application has no code or hash", !("otp" in sub.result) && !JSON.stringify(sub.result).includes(codeIn(msgs[0])));
  ok("no on-screen inbox in this mode", (await withState(() => b.getInbox(form.email), { readOnly: true })).result.length === 0);
  const code1 = codeIn(msgs[0]);
  const raw = await dump();
  ok("the plain code is NOT stored in the cloud (only a hash)", !raw["mosaic:state"].includes(code1));
  const log1 = (await withState(() => b.listAuditLog(), { readOnly: true })).result;
  ok("the system log says 'emailed' with a masked address, never the full address or the code", log1.some((l: any) => l.event === "email_sent" && l.detail.includes("a***@")) && !JSON.stringify(log1).includes(form.email) && !JSON.stringify(log1).includes(code1));
  const wrong = code1 === "000000" ? "111111" : "000000";
  try { await withState(() => b.verifyEmail(gupta, wrong)); } catch (e) { ok("wrong code refused", e instanceof ApiError && e.code === "InvalidOtp", (e as Error).message); }
  ok("the wrong attempt was counted and saved", (await withState(() => b.listAuditLog(), { readOnly: true })).result.some((l: any) => l.event === "otp_wrong"));
  const ver = await withState(() => b.verifyEmail(gupta, code1));
  ok("the emailed code verifies the email", ver.result.emailVerified === true);

  console.log("-- when the email service refuses");
  await mode(true);
  const failed = await withState(() => b.resendOtp(gupta));
  ok("delivery reported as 'failed', with the provider's reason", failed.result.emailDelivery === "failed" && String(failed.result.emailError).includes("testing emails"), failed.result.emailError);
  ok("failure is in the system log as an error", (await withState(() => b.listAuditLog(), { readOnly: true })).result.some((l: any) => l.event === "email_failed" && l.level === "error"));
  ok("no on-screen fallback when a service IS configured but fails", (await withState(() => b.getInbox(form.email), { readOnly: true })).result.length === 0);
  await mode(false);
  const app2 = await withState(() => b.submitApplication(gupta, form));
  const m2 = (await sent()).at(-1);
  ok("after the service recovers, a new application emails a new code", app2.result.emailDelivery === "sent" && (await sent()).length === 2);
  const resent = await withState(() => b.resendOtp(gupta));
  const m3 = (await sent()).at(-1);
  ok("resend sends another email", (await sent()).length === 3 && resent.result.emailDelivery === "sent");
  try { await withState(() => b.verifyEmail(gupta, codeIn(m2))); ok("old code must fail", codeIn(m2) === codeIn(m3)); } catch (e) { ok("the previous code no longer works after a resend", e instanceof ApiError && e.code === "InvalidOtp"); }
  ok("the newest code works", (await withState(() => b.verifyEmail(gupta, codeIn(m3)))).result.emailVerified);

  console.log("-- reset wipes the cloud data");
  await resetEverything();
  const s2 = JSON.parse((await dump())["mosaic:state"]);
  ok("applications, logs and credentials are gone (only the reset line remains)", Object.keys(s2.db.applications).length === 0 && s2.db.auditLog.length === 1 && s2.txCount === 1);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
