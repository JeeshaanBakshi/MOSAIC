import "server-only";
// Sends the verification email through Resend (https://resend.com).
// Needs RESEND_API_KEY. EMAIL_FROM is optional. Until you verify your own domain at Resend, its test sender
// (onboarding@resend.dev) can only deliver to the email address of your Resend account.
// The code is sent from the SERVER only. It is never put in an API response.

import { log, maskEmail } from "./log";

export type Delivery =
  | { status: "sent"; id?: string }
  | { status: "not_configured" }
  | { status: "failed"; error: string };

export const emailConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "not_configured" };
  const url = process.env.RESEND_API_URL ?? "https://api.resend.com/emails"; // overridable, so tests never email anyone
  const from = process.env.EMAIL_FROM ?? "MOSAIC <onboarding@resend.dev>";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      log("warn", "email_failed", { to: maskEmail(msg.to), httpStatus: res.status, reason: body.message });
      return { status: "failed", error: body.message ?? `The email service answered ${res.status}.` };
    }
    log("info", "email_sent", { to: maskEmail(msg.to), id: body.id });
    return { status: "sent", id: body.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log("error", "email_error", { to: maskEmail(msg.to), error });
    return { status: "failed", error };
  }
}

export function codeEmail(code: string) {
  return {
    subject: "Your MOSAIC verification code",
    text: `Your MOSAIC verification code is ${code}.\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px">
      <h2 style="margin:0 0 8px">MOSAIC</h2>
      <p>Your verification code is</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>
      <p style="color:#78716c">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
  };
}
