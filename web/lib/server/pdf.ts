import "server-only";
// A tiny PDF writer, so the admin can download a case file without adding a library. It writes plain text pages
// (Helvetica, A4) and nothing else: headings, paragraphs, label/value lines, bullets and rules.
// Standard PDF fonts only know basic Latin, so ₹ is written "Rs" and other special characters become plain ones.
//
// A PDF is a list of numbered objects (a catalog, the pages, the fonts, one content stream per page), then a table that
// says where each object starts (the "xref"), then a trailer that points at the catalog.

import { formatDate, usdc } from "../format";
import type { CaseReport } from "../engine/cases";
import { MATCH_LABEL, PROOF_LABEL, RELIABILITY_LABEL } from "../engine/evidence";

type Block =
  | { t: "h1" | "h2" | "p" | "li" | "small"; text: string }
  | { t: "kv"; k: string; v: string }
  | { t: "gap" }
  | { t: "rule" };

const W = 595, H = 842, M = 50; // A4 in points, margin

const ascii = (s: string) => String(s)
  .replace(/₹/g, "Rs ").replace(/[→]/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—−]/g, "-").replace(/[·•]/g, "-").replace(/…/g, "...")
  .replace(/[^\x20-\x7E\n]/g, "?");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

interface Line { text: string; size: number; bold: boolean; x: number; gapBefore: number; rule?: boolean }

function wrap(text: string, size: number, x: number): string[] {
  const max = Math.floor((W - M - x) / (size * 0.52)); // Helvetica averages about half the font size per character
  const out: string[] = [];
  for (const para of ascii(text).split("\n")) {
    let cur = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > max) { if (cur) { out.push(cur); cur = ""; } out.push(word.slice(0, max)); word = word.slice(max); } // a very long word (a hash)
      if (!cur) cur = word; else if ((cur + " " + word).length <= max) cur += " " + word; else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  return out;
}

function layout(blocks: Block[]): Line[][] {
  const lines: Line[] = [];
  for (const b of blocks) {
    if (b.t === "gap") { lines.push({ text: "", size: 6, bold: false, x: M, gapBefore: 0 }); continue; }
    if (b.t === "rule") { lines.push({ text: "", size: 4, bold: false, x: M, gapBefore: 0, rule: true }); continue; }
    if (b.t === "kv") {
      const label = ascii(b.k);
      const rows = wrap(b.v, 10, M + 130);
      rows.forEach((r, i) => { if (i === 0) lines.push({ text: label, size: 10, bold: true, x: M, gapBefore: 2 }); lines.push({ text: r, size: 10, bold: false, x: M + 130, gapBefore: i === 0 ? -13.5 : 0 }); });
      continue;
    }
    const size = b.t === "h1" ? 17 : b.t === "h2" ? 12 : b.t === "small" ? 8.5 : 10;
    const x = b.t === "li" ? M + 14 : M;
    const rows = wrap(b.t === "li" ? b.text : b.text, size, x);
    rows.forEach((r, i) => lines.push({ text: b.t === "li" && i === 0 ? `- ${r}` : r, size, bold: b.t === "h1" || b.t === "h2", x: b.t === "li" && i === 0 ? M + 2 : x, gapBefore: i === 0 && (b.t === "h2" || b.t === "h1") ? 8 : 1 }));
  }
  // split into pages
  const pages: Line[][] = [[]];
  let y = H - M;
  for (const l of lines) {
    const h = l.size * 1.35 + l.gapBefore;
    if (y - h < M + 20) { pages.push([]); y = H - M; }
    pages[pages.length - 1].push(l);
    y -= h;
  }
  return pages;
}

/** Draw the blocks as a PDF. `footer` is printed on every page with "page n of N". */
export function makePdf(blocks: Block[], footer: string): Buffer {
  const pages = layout(blocks);
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; }; // returns the object number (1-based)
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // the Pages object is filled in below
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((ls, n) => {
    let y = H - M;
    const ops: string[] = [];
    for (const l of ls) {
      y -= l.size * 1.35 + l.gapBefore;
      if (l.rule) { ops.push(`0.6 w ${M} ${y + 3} m ${W - M} ${y + 3} l S`); continue; }
      if (l.text) ops.push(`BT /${l.bold ? "F2" : "F1"} ${l.size} Tf 1 0 0 1 ${l.x} ${y.toFixed(2)} Tm (${esc(l.text)}) Tj ET`);
    }
    ops.push(`BT /F1 8 Tf 1 0 0 1 ${M} 28 Tm (${esc(ascii(footer))}  -  page ${n + 1} of ${pages.length}) Tj ET`);
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const KIND: Record<string, string> = { shop_rejection: "the shop rejected or disputed an invoice", lender_rejection: "a lender reported wrong information" };
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

/** The admin's case file: everything needed to decide, then what each decision does. */
export function caseReportPdf(r: CaseReport): Buffer {
  const c = r.view.file, v = r.view;
  const B: Block[] = [];
  B.push({ t: "h1", text: `MOSAIC case file #${c.id}` });
  B.push({ t: "p", text: "A supplier's claim was rejected. The admin decides whether the rejection stands." });
  B.push({ t: "small", text: `Prepared ${formatDate(r.generatedAt)}. Testnet prototype: made-up shop data and test USDC.` });
  B.push({ t: "rule" });

  B.push({ t: "h2", text: "1. The case" });
  B.push({ t: "kv", k: "Status", v: c.status === "open" ? "OPEN - waiting for the admin" : `${c.status.toUpperCase()}${c.decision ? ` on ${formatDate(c.decision.at)}` : ""}` });
  B.push({ t: "kv", k: "Opened", v: `${formatDate(c.openedAt)}, because ${KIND[c.kind]}` });
  B.push({ t: "kv", k: "Rejected by", v: c.raisedByName });
  B.push({ t: "kv", k: "Supplier", v: v.issuerName });
  B.push({ t: "kv", k: "Shop", v: `${v.shopName} (${c.shopId})` });
  B.push({ t: "kv", k: "Credential", v: `#${r.credential.id}, ${r.credential.claimType}, on-chain status ${r.credential.status.toLowerCase()}` });
  B.push({ t: "kv", k: "Claim", v: `"${r.credential.summary}"` });
  B.push({ t: "kv", k: "Stake locked", v: usdc(r.credential.stake) });
  B.push({ t: "kv", k: "Evidence hash", v: r.credential.hash });
  B.push({ t: "gap" });

  B.push({ t: "h2", text: "2. Why it was rejected" });
  B.push({ t: "p", text: `"${c.reason}"` });
  if (c.decision) B.push({ t: "p", text: `Admin ruling (${c.status}): "${c.decision.note}"` });
  B.push({ t: "gap" });

  B.push({ t: "h2", text: "3. What the rules engine found" });
  if (!r.checks.length) B.push({ t: "p", text: "No checks have run for this credential yet." });
  for (const k of r.checks) {
    B.push({ t: "li", text: `Check ${k.check} (${k.name.replace("_", " ")}): ${k.result.toUpperCase()}. ${k.reason}` });
    B.push({ t: "small", text: `   Numbers: ${k.numbers}. Source: ${k.source}.` });
  }
  if (r.invoiceBlock) B.push({ t: "li", text: `Shop's answer: ${r.invoiceBlock}` });
  B.push({ t: "gap" });

  B.push({ t: "h2", text: "4. Invoice evidence behind this credential" });
  if (!r.invoices.length) B.push({ t: "p", text: "No invoice claims were submitted for this credential." });
  for (const iv of r.invoices) {
    const k = iv.claim, m = iv.match;
    B.push({ t: "kv", k: `Invoice ${k.ref}`, v: `${rs(k.amountInr)}, dated ${formatDate(k.invoiceDate)}. ${k.category}${k.description ? `: ${k.description}` : ""}. Evidence: ${k.evidenceRef || "none given"}.` });
    B.push({ t: "kv", k: "Shop's answer", v: `${iv.state}${k.reason ? `: "${k.reason}"` : ""}${k.cancelled ? " (cancelled by the supplier)" : ""}` });
    B.push({ t: "kv", k: "Payment match", v: `${MATCH_LABEL[m.status]}. ${rs(m.matchedAmount)} of ${rs(m.effectiveAmount)} matched (${m.matchingPercentage}%), ${rs(m.outstandingAmount)} outstanding.` });
    for (const l of m.lines) B.push({ t: "li", text: `${l.label} (${l.result}): ${l.found}${l.missing ? ` Missing: ${l.missing}` : ""}` });
    B.push({ t: "small", text: `   History: ${k.history.map((h) => `${formatDate(h.at)} ${h.by} ${h.action.replace(/_/g, " ")}${h.note ? ` (${h.note})` : ""}`).join("; ")}` });
    B.push({ t: "gap" });
  }

  if (r.proof) {
    const pr = r.proof;
    B.push({ t: "h2", text: "5. Is this really the shop's supplier?" });
    B.push({ t: "kv", k: "Supplier proof", v: PROOF_LABEL[pr.status] });
    for (const l of pr.lines) B.push({ t: "li", text: `${l.label} (${l.result}): ${l.found}${l.missing ? ` Missing: ${l.missing}` : ""}` });
    const rows = pr.months.map((m) => `${m.label}: ${m.uploaded ? `billed ${rs(m.billed)}, paid net ${rs(m.net)}${m.share !== null ? ` (${Math.round(m.share * 100)}%)` : ""}` : "no bill uploaded"}`);
    B.push({ t: "small", text: `   ${rows.join("; ")}` });
    B.push({ t: "gap" });
  }
  B.push({ t: "h2", text: `${r.proof ? "6" : "5"}. The supplier's record` });
  B.push({ t: "kv", k: "Reliability", v: `${RELIABILITY_LABEL[r.reliability.category]}. ${r.reliability.reasons.join(" ")}` });
  const mt = r.reliability.metrics;
  B.push({ t: "kv", k: "Numbers", v: `${mt.credentialsIssued} credentials issued, ${mt.confirmed} confirmed, ${mt.rejected} rejected, ${mt.disputed} disputed, ${mt.upheldOnChain + mt.upheldInvoice} disputes upheld, ${mt.duplicates} duplicates, ${mt.revoked} revoked.` });
  B.push({ t: "kv", k: "Warnings", v: `${v.warnings} of ${v.warningLimit} so far. ${v.removesIssuer ? "Another approved rejection REMOVES this supplier from the system." : ""}` });
  B.push({ t: "gap" });

  B.push({ t: "rule" });
  B.push({ t: "h2", text: `${r.proof ? "7" : "6"}. Your decision` });
  B.push({ t: "p", text: "If you APPROVE the rejection:" });
  for (const t of r.ifApproved) B.push({ t: "li", text: t });
  B.push({ t: "p", text: "If you DISMISS it:" });
  for (const t of r.ifDismissed) B.push({ t: "li", text: t });
  B.push({ t: "gap" });
  B.push({ t: "p", text: "Decision:  [ ] Approve     [ ] Dismiss        Note: ______________________________________________" });
  B.push({ t: "gap" });
  B.push({ t: "small", text: "Limits of this prototype: the stake deduction and the removal run in the website's simulation and are not sent to Stellar. The deployed contract only slashes a stake after a lender reports a default, and it has not been changed. Invoices, payment records and confirmations are kept off-chain by the MOSAIC backend." });

  return makePdf(B, `MOSAIC case file #${c.id}`);
}

/** A small SAMPLE monthly bill statement, for the demo data. Clearly labelled: it is made up. */
export function sampleBillPdf(o: { supplier: string; customer: string; monthLabel: string; total: number; bills: number }): Buffer {
  const B: Block[] = [
    { t: "h1", text: `${o.supplier}: monthly statement` },
    { t: "small", text: "SAMPLE DOCUMENT - made-up demo data for the MOSAIC testnet prototype. Not a real bill." },
    { t: "rule" },
    { t: "kv", k: "Customer", v: o.customer },
    { t: "kv", k: "Month", v: o.monthLabel },
    { t: "kv", k: "Number of bills", v: String(o.bills) },
    { t: "kv", k: "Total billed", v: rs(o.total) },
    { t: "gap" },
    { t: "p", text: "Goods: groceries and staples supplied on regular order. Payment by bank transfer." },
  ];
  return makePdf(B, `${o.supplier} - ${o.monthLabel}`);
}
