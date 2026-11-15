// Shared pieces for SUPPLIER PROOF: the status badge, the seven plain checks, and the month-by-month bills table.
import { CircleCheck, CircleDashed, CircleX, FileText } from "lucide-react";
import { MONTH_LABEL, PROOF_LABEL, rs, type ProofLine, type ProofMonth, type ProofStatus, type StatementView } from "@/lib/mock";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

const STATE: Record<ProofStatus, string> = { verified: "pass", partial: "open", unverified: "unknown", flagged: "fail" };
export const ProofBadge = ({ status }: { status: ProofStatus }) => <Badge state={STATE[status]}>{PROOF_LABEL[status]}</Badge>;

const ICON = { pass: { Icon: CircleCheck, cls: "text-pine", word: "Passed" }, fail: { Icon: CircleX, cls: "text-clay", word: "Failed" }, unknown: { Icon: CircleDashed, cls: "text-faint", word: "Missing" } } as const;

/** Each check: what was found, why it matters, what is missing, what to do. Missing is not fraud. */
export function ProofLines({ lines }: { lines: ProofLine[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {lines.map((l) => {
        const { Icon, cls, word } = ICON[l.result];
        return (
          <li key={l.id} className="flex gap-4 py-3">
            <Icon className={`mt-1 size-[18px] shrink-0 ${cls}`} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <span className="font-medium"><span className="sr-only">{word}: </span>{l.label}</span>
              <p className="text-quiet"><b className="font-medium text-ink">Found:</b> {l.found}</p>
              <p className="text-quiet"><b className="font-medium text-ink">Why it matters:</b> {l.why}</p>
              {l.missing && <p className="text-quiet"><b className="font-medium text-ink">Missing:</b> {l.missing}</p>}
              {l.action && <p className="text-quiet"><b className="font-medium text-ink">What to do:</b> {l.action}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Six months: the bill (with a link to open the PDF), what the shop really paid, and whether they agree. */
export function ProofMonths({ months, statements }: { months: ProofMonth[]; statements: StatementView[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="dtable min-w-[38rem]">
        <thead><tr><th>Month</th><th>Bill (PDF)</th><th className="text-right">Billed</th><th className="text-right">Paid by the shop, net</th><th>Result</th></tr></thead>
        <tbody>
          {months.map((m) => {
            const st = statements.find((x) => x.month === m.month && x.current);
            return (
              <tr key={m.month} data-month={m.month}>
                <td className="whitespace-nowrap">{MONTH_LABEL[m.month]}</td>
                <td>{st ? <a href={st.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-pine underline underline-offset-4"><FileText className="size-3.5" aria-hidden />{st.billCount} bill{st.billCount === 1 ? "" : "s"}</a> : <span className="text-faint">not uploaded</span>}{st && <div className="text-xs text-faint">{formatDate(st.uploadedAt)} · {Math.round(st.fileSize / 1000)} KB · {st.fileHash.slice(0, 8)}…</div>}</td>
                <td className="t-num text-right">{m.uploaded ? rs(m.billed) : "-"}</td>
                <td className="t-num text-right">{m.uploaded || m.net ? rs(m.net) : "-"}{m.share !== null && <div className="text-xs text-faint">{Math.round(m.share * 100)}% of the bill</div>}</td>
                <td><Badge state={m.result === "pass" ? "pass" : m.result === "fail" ? "fail" : "unknown"}>{m.result === "pass" ? "Matches" : m.result === "fail" ? "Not backed" : m.uploaded ? "No payments yet" : "Missing"}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
