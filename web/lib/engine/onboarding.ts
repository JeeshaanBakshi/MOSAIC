import "server-only";
// The BACKEND's onboarding endpoints: how a business applies to become an issuer, and how the admin reviews it.
// Applications live here (off-chain). Only a hash of each application goes on-chain.
//
//   applicant: submitApplication -> (emailed code) -> verifyEmail -> [contract.requestIssuer] -> markRequested
//   admin:     getReview (automatic checks) -> optional saveManualReview -> [contract.addIssuer or rejectIssuerRequest]
//
// The code is emailed by lib/server/email.ts (Resend). If no email service is configured (local development only),
// the message lands in a fake inbox on screen so you can still test. We store a HASH of the code, never the code.
// CONNECT: GST / RBI / sales lookups (lib/engine/data.ts) become real API calls.

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { ACCOUNTS } from "./accounts";
import { BLACKLIST, GST_FORMAT, GST_REGISTRY, RBI_LICENCES, SHOPS, TRADING_RECORDS } from "./data";
import { EXAMPLES, exampleApplication } from "./examples";
import type { Result } from "./rules";
import { mutateDb, pushAudit, read, type Application, type AuditEntry, type Email, type ManualReview } from "./store";
import { ApiError, type ApplicationForm } from "./types";
import { claimHash } from "./util";
import { codeEmail, sendEmail, emailConfigured } from "../server/email";
import { maskEmail } from "../server/log";
import type { RoleId } from "./accounts";

export { exampleApplication };

const OTP_TTL_SECS = 10 * 60; // a code works for 10 minutes (on the app's clock)
const OTP_MAX_ATTEMPTS = 3; // then you must ask for a new code
const NAME_MATCH_MIN = 0.6; // bank holder name vs registered name
const MIN_MONTHS = 6;
const MIN_COUNTERPARTIES = 3;
const MAX_CODES_PER_HOUR = () => Number(process.env.MAX_CODES_PER_HOUR ?? 5); // per email address, so nobody can spam an inbox
const HOUR_MS = 60 * 60 * 1000;

/** What the browser is allowed to see: never the code (not even its hash). */
export type PublicApplication = Omit<Application, "otp">;

export interface ReviewCheck {
  id: string;
  label: string;
  result: Result;
  reason: string;
  ignored?: boolean; // a failure that only concerns claims that are not counted anyway: it is shown, but does not block the verdict
}

export type Verdict = "recommend_approve" | "needs_review" | "recommend_reject";

export interface Review {
  application: PublicApplication;
  checks: ReviewCheck[];
  verdict: Verdict;
  manualReview: ManualReview | null;
  /** May the admin approve right now? The UI follows this. */
  approval: { allowed: boolean; reason: string };
}

const publicOf = ({ otp: _otp, ...rest }: Application): PublicApplication => {
  void _otp;
  return rest;
};

// ---------- applying + the emailed code ----------

const newCode = () => String(randomInt(100000, 1000000)); // 6 digits, from a secure random source
const hashCode = (address: string, code: string) => createHash("sha256").update(`${address}:${code}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function validate(f: ApplicationForm) {
  const missing = (Object.values(f) as string[]).some((v) => !String(v).trim());
  if (missing) throw new ApiError("InvalidInput", "Please fill in every field.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) throw new ApiError("InvalidInput", "That email address doesn't look right.");
  if (f.phone.replace(/\D/g, "").length < 10) throw new ApiError("InvalidInput", "The phone number needs at least 10 digits.");
}

/** Count this send against the email's hourly limit. Returns false (and counts nothing) if the limit is reached. */
function takeSend(email: string): boolean {
  return mutateDb((db) => {
    const now = Date.now();
    const recent = (db.sends[email] ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= MAX_CODES_PER_HOUR()) {
      db.sends[email] = recent;
      pushAudit(db, "warn", "rate_limited", `Too many codes requested for ${maskEmail(email)}. Blocked until the hour is up.`);
      return false;
    }
    recent.push(now);
    db.sends[email] = recent;
    return true;
  });
}

const tooMany = () => new ApiError("RateLimited", `Too many codes for this email address. Wait up to an hour, or use a different address.`);

/** Send the code, then record what happened (sent / failed / not configured) so the screen can tell the truth. */
async function deliverCode(address: string, email: string, code: string): Promise<void> {
  const msg = codeEmail(code);
  const delivery = await sendEmail({ to: email, ...msg });
  mutateDb((db, now) => {
    const app = db.applications[address];
    if (!app) return;
    app.emailDelivery = delivery.status;
    app.emailError = delivery.status === "failed" ? delivery.error : undefined;
    if (delivery.status === "not_configured") {
      // Local development only: show the message on screen instead.
      db.outbox.unshift({ id: db.nextId++, to: email, time: now, subject: msg.subject, body: `Your code is ${code}. It works for 10 minutes.` });
      pushAudit(db, "warn", "email_not_configured", `No email service is set up, so the code for ${maskEmail(email)} was shown in the on-screen inbox instead.`);
    } else if (delivery.status === "sent") {
      pushAudit(db, "info", "email_sent", `Verification code emailed to ${maskEmail(email)}.`);
    } else {
      pushAudit(db, "error", "email_failed", `Could not email ${maskEmail(email)}: ${delivery.error}`);
    }
  });
}

/** Step 1: the applicant sends their details. We email a 6-digit code to the address they gave. */
export async function submitApplication(address: string, form: ApplicationForm): Promise<PublicApplication> {
  validate(form);
  const clean: ApplicationForm = {
    ...form,
    registrationNumber: form.registrationNumber.trim().toUpperCase(),
    email: form.email.trim().toLowerCase(),
  };
  if (!takeSend(clean.email)) throw tooMany();
  // The fingerprint of everything they told us. This is what goes on-chain, not the details themselves.
  const evidenceHash = await claimHash({ ...clean });
  const code = newCode();
  mutateDb((db, now) => {
    db.applications[address] = {
      address, ...clean, evidenceHash, emailVerified: false,
      otp: { codeHash: hashCode(address, code), expiresAt: now + OTP_TTL_SECS, attempts: 0 },
      emailDelivery: "sent", requested: false, createdAt: now,
    }; // a new application replaces an older one
    delete db.manualReviews[address];
    pushAudit(db, "info", "application_submitted", `${clean.businessName} (${clean.kind}) applied from ${maskEmail(clean.email)}.`);
  });
  await deliverCode(address, clean.email, code);
  return publicOf(read().db.applications[address]);
}

/** "Send me a new code": the old one stops working. */
export async function resendOtp(address: string): Promise<PublicApplication> {
  const app = read().db.applications[address];
  if (!app) throw new ApiError("NoApplication", "There is no application to send a code for.");
  if (!takeSend(app.email)) throw tooMany();
  const code = newCode();
  mutateDb((db, now) => {
    db.applications[address].otp = { codeHash: hashCode(address, code), expiresAt: now + OTP_TTL_SECS, attempts: 0 };
    pushAudit(db, "info", "otp_resent", `A new code was requested for ${maskEmail(app.email)}. The old one no longer works.`);
  });
  await deliverCode(address, app.email, code);
  return publicOf(read().db.applications[address]);
}

/** Step 2: the applicant types the code from their email. 3 wrong tries, or 10 minutes, and they need a new code. */
export async function verifyEmail(address: string, code: string): Promise<PublicApplication> {
  // The backend KEEPS the attempt count even when it then tells the user "wrong code", so we decide inside, throw outside.
  const outcome = mutateDb((db, now): { app?: PublicApplication; error?: ApiError } => {
    const app = db.applications[address];
    if (!app) return { error: new ApiError("NoApplication", "There is no application for this account.") };
    if (app.emailVerified) return { app: publicOf(app) };
    const mask = maskEmail(app.email);
    if (!app.otp) return { error: new ApiError("InvalidOtp", "Ask for a new code first.") };
    if (now > app.otp.expiresAt) {
      pushAudit(db, "warn", "otp_expired", `The code for ${mask} expired.`);
      return { error: new ApiError("OtpExpired", "That code expired. Ask for a new one.") };
    }
    if (app.otp.attempts >= OTP_MAX_ATTEMPTS) {
      pushAudit(db, "warn", "otp_locked", `Too many wrong tries for ${mask}.`);
      return { error: new ApiError("TooManyAttempts", "Too many wrong tries. Ask for a new code.") };
    }
    if (!sameHash(hashCode(address, code.trim()), app.otp.codeHash)) {
      app.otp.attempts += 1;
      const left = OTP_MAX_ATTEMPTS - app.otp.attempts;
      pushAudit(db, "warn", "otp_wrong", `Wrong code for ${mask} (${left} ${left === 1 ? "try" : "tries"} left).`);
      return { error: new ApiError("InvalidOtp", left > 0 ? `That code is wrong. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code is wrong. Ask for a new one.") };
    }
    app.emailVerified = true;
    app.otp = null;
    pushAudit(db, "info", "otp_verified", `Email ${mask} verified.`);
    return { app: publicOf(app) };
  });
  if (outcome.error) throw outcome.error;
  return outcome.app!;
}

/** Step 3 happens on-chain (contract.requestIssuer). Afterwards the page tells the backend, so it stops showing the form. */
export async function markRequested(address: string): Promise<void> {
  mutateDb((db) => {
    const app = db.applications[address];
    if (!app) return;
    app.requested = true;
    pushAudit(db, "info", "request_signed", `${app.businessName} signed its request to join (hash ${app.evidenceHash.slice(0, 8)}…).`);
  });
}

export async function getApplication(address: string): Promise<PublicApplication | null> {
  const app = read().db.applications[address];
  return app ? structuredClone(publicOf(app)) : null;
}

// ---------- the automatic checks ----------

const STOPWORDS = new Set(["pvt", "ltd", "private", "limited", "llp", "and", "the", "co"]);
const words = (name: string) =>
  new Set(name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOPWORDS.has(w)));

/** How alike two names are, from 0 to 1: shared words divided by all words. */
export function nameSimilarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / new Set([...x, ...y]).size;
}

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function runChecks(app: PublicApplication): ReviewCheck[] {
  const isSupplier = app.kind === "Supplier";
  const reg = app.registrationNumber;
  const gst = GST_REGISTRY[reg];
  const licence = RBI_LICENCES[reg];
  const record = isSupplier ? gst : licence; // who is on record for this registration (if found)
  const registeredName = record?.legalName;
  const out: ReviewCheck[] = [];

  // 1. Is it a real, registered business? (suppliers: GST number; payment providers: RBI licence)
  if (isSupplier) {
    out.push(!GST_FORMAT.test(reg)
      ? { id: "registration", label: "Registered business (GSTIN)", result: "fail", reason: `"${reg}" is not a valid GSTIN, India's 15-character business tax number (like 23AABCG4521K1Z7).` }
      : !gst ? { id: "registration", label: "Registered business (GSTIN)", result: "fail", reason: `GSTIN ${reg} was not found in the registry.` }
      : gst.status !== "Active" ? { id: "registration", label: "Registered business (GSTIN)", result: "fail", reason: `GST registration for "${gst.legalName}" is ${gst.status}, not Active.` }
      : { id: "registration", label: "Registered business (GSTIN)", result: "pass", reason: `Active GST registration for "${gst.legalName}".` });
  } else {
    out.push(!licence
      ? { id: "registration", label: "Licensed payment company (RBI)", result: "fail", reason: `Licence ${reg} was not found on the RBI list of authorized payment companies.` }
      : licence.status !== "Authorized" ? { id: "registration", label: "Licensed payment company (RBI)", result: "fail", reason: `Licence for "${licence.legalName}" is ${licence.status}.` }
      : { id: "registration", label: "Licensed payment company (RBI)", result: "pass", reason: `"${licence.legalName}" is an authorized payment company.` });
  }

  // 2. Is the applicant the person on record? (Stops someone using another business's GST number.)
  if (!record) {
    out.push({ id: "owner", label: "Applicant is the registered owner", result: "unknown", reason: "No registration found, so there is no owner on record to compare with." });
  } else {
    const sim = nameSimilarity(app.ownerName, record.owner);
    out.push({
      id: "owner", label: "Applicant is the registered owner", result: sim >= NAME_MATCH_MIN ? "pass" : "fail",
      reason: sim >= NAME_MATCH_MIN
        ? `"${app.ownerName}" matches the owner on record "${record.owner}".`
        : `"${app.ownerName}" is not the owner on record "${record.owner}" (${Math.round(sim * 100)}% match).`,
    });
  }

  // 3. Do the contact details match the registry? The code proves they control AN inbox; this checks it's the BUSINESS's.
  if (!record) {
    out.push({ id: "contact", label: "Contact matches the registry", result: "unknown", reason: "No registration found, so there are no contact details on record." });
  } else {
    const emailMatch = app.email === record.email.toLowerCase() || app.email.split("@")[1] === record.email.toLowerCase().split("@")[1];
    const phoneMatch = digits(app.phone) === digits(record.phone);
    const onRecord = `${maskEmail(record.email)}, phone ending ${digits(record.phone).slice(-4)}`;
    out.push(emailMatch || phoneMatch
      ? { id: "contact", label: "Contact matches the registry", result: "pass", reason: `${emailMatch ? "Email" : "Phone"} matches the contact on record (${onRecord}).` }
      : { id: "contact", label: "Contact matches the registry", result: "fail", reason: `Neither the email nor the phone matches the contact on record (${onRecord}).` });
  }

  // 4. Does the applicant control the email address?
  out.push(app.emailVerified
    ? { id: "email", label: "Email verified", result: "pass", reason: `They entered the code we emailed to ${app.email}.` }
    : { id: "email", label: "Email verified", result: "unknown", reason: "Waiting for the applicant to enter the emailed code." });

  // 5. Is the bank account in the business's own name?
  if (!registeredName) {
    out.push({ id: "bank", label: "Bank account name matches", result: "unknown", reason: "No registered name to compare with, because the registration was not found." });
  } else {
    const sim = nameSimilarity(app.bankAccountHolder, registeredName);
    out.push({
      id: "bank", label: "Bank account name matches", result: sim >= NAME_MATCH_MIN ? "pass" : "fail",
      reason: `Account holder "${app.bankAccountHolder}" vs registered "${registeredName}": ${Math.round(sim * 100)}% match (needs ${Math.round(NAME_MATCH_MIN * 100)}%).`,
    });
  }

  // 6. Does it really trade? Missing records mean "unknown", never "bad".
  const rec = TRADING_RECORDS[reg];
  const noun = isSupplier ? "shop" : "merchant";
  const plural = (n: number) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
  out.push(!rec
    ? { id: "trading", label: "Real trading history", result: "unknown", reason: "No sales or payment records were shared." }
    : { id: "trading", label: "Real trading history", result: rec.months >= MIN_MONTHS && rec.counterparties >= MIN_COUNTERPARTIES ? "pass" : "fail",
        reason: `${isSupplier ? "Sold to" : "Serves"} ${plural(rec.counterparties)} over ${rec.months} months (needs at least ${plural(MIN_COUNTERPARTIES)} and ${MIN_MONTHS} months).` });

  // 7. Independent of the shops it will vouch for? (same rule as fraud check 3)
  const clash = Object.values(SHOPS).find((s) => digits(s.phone) === digits(app.phone) || norm(s.owner) === norm(app.ownerName));
  out.push(clash
    ? { id: "independence", label: "Independent of the shops", result: "fail",
        reason: digits(clash.phone) === digits(app.phone) ? `Phone ${app.phone} is also the phone of ${clash.name}.` : `Owner "${app.ownerName}" is also the owner of ${clash.name}.` }
    : { id: "independence", label: "Independent of the shops", result: "pass", reason: "No shared phone number or owner with any shop on MOSAIC." });

  // 8. Not on our blacklist
  out.push(BLACKLIST.has(reg)
    ? { id: "blacklist", label: "Not blacklisted", result: "fail", reason: "This registration was suspended before." }
    : { id: "blacklist", label: "Not blacklisted", result: "pass", reason: "Not on the blacklist." });

  return out;
}

function verdictOf(checks: ReviewCheck[]): Verdict {
  if (checks.some((c) => c.result === "fail")) return "recommend_reject";
  if (checks.some((c) => c.result === "unknown")) return "needs_review";
  return "recommend_approve";
}

/**
 * The approval rule:
 *  - every automatic check passed: the admin can approve straight away (a manual review is optional);
 *  - otherwise the admin must do a manual review: tick each check that did not pass (= "I checked it myself") and write a note.
 */
function approvalOf(checks: ReviewCheck[], manual: ManualReview | null): Review["approval"] {
  const notPassed = checks.filter((c) => c.result !== "pass");
  if (!notPassed.length) return { allowed: true, reason: "All automatic checks passed." };
  if (!manual || !manual.note.trim()) {
    return { allowed: false, reason: `${notPassed.length} check${notPassed.length === 1 ? "" : "s"} did not pass. Do a manual review and write a note first.` };
  }
  const missing = notPassed.filter((c) => !manual.checked[c.id]);
  if (missing.length) return { allowed: false, reason: `Tick what you verified by hand: ${missing.map((c) => c.label).join(", ")}.` };
  return { allowed: true, reason: "Approved on the strength of the admin's manual review." };
}

/** What the admin sees for one application: the automatic checks, the verdict, and any manual review. */
export async function getReview(address: string): Promise<Review | null> {
  const db = read().db;
  const app = db.applications[address];
  if (!app) return null;
  const pub = structuredClone(publicOf(app));
  const checks = runChecks(pub);
  const manual = db.manualReviews[address] ?? null;
  return { application: pub, checks, verdict: verdictOf(checks), manualReview: structuredClone(manual), approval: approvalOf(checks, manual) };
}

/** The admin's own checking: which checks they verified by hand, plus a note. Optional when everything passed. */
export async function saveManualReview(address: string, checked: Record<string, boolean>, note: string): Promise<void> {
  mutateDb((db, now) => {
    const app = db.applications[address];
    if (!app) throw new ApiError("NoApplication", "There is no application to review.");
    db.manualReviews[address] = { checked, note: note.trim(), reviewedAt: now };
    pushAudit(db, "info", "manual_review_saved", `Manual review saved for ${app.businessName} (${Object.values(checked).filter(Boolean).length} check(s) ticked).`);
  });
}

// ---------- the system log + mock-only helpers ----------

/** The backend's own log, newest first. */
export async function listAuditLog(): Promise<AuditEntry[]> {
  return structuredClone(read().db.auditLog);
}

/** Is a real email service set up? The screen uses this to say "emailed" or "prototype inbox". */
export async function emailStatus(): Promise<{ configured: boolean }> {
  return { configured: emailConfigured() };
}

/** DEVELOPMENT ONLY: the on-screen inbox. It stays empty when a real email service is configured. */
export async function getInbox(email: string): Promise<Email[]> {
  return structuredClone(read().db.outbox.filter((m) => m.to === email.trim().toLowerCase()));
}

/** MOCK-ONLY (used by "Load demo"): an application whose email is already verified. */
export async function seedVerifiedApplication(role: RoleId): Promise<PublicApplication> {
  const form = EXAMPLES[role]!;
  const address = ACCOUNTS[role].address;
  const evidenceHash = await claimHash({ ...form });
  return mutateDb((db, now) => {
    const app: Application = { address, ...form, evidenceHash, emailVerified: true, otp: null, emailDelivery: "sent", requested: false, createdAt: now };
    db.applications[address] = app;
    pushAudit(db, "info", "application_seeded", `Demo application for ${form.businessName} created with its email already verified.`);
    return publicOf(app);
  });
}
