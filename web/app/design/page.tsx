// /design: the MOSAIC style sheet. Not linked from the app. Shows every token and shared piece in one place,
// so the look can be reviewed (and judged) before it is applied to the pages.
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { Magnetic } from "@/components/motion/Magnetic";
import { Reveal } from "@/components/motion/Reveal";
import { LogoMark, Wordmark } from "@/components/Logo";

export const metadata = { title: "MOSAIC style sheet" };

const SWATCHES = [
  ["paper", "--paper", "Page background"], ["surface", "--color-surface", "Cards, forms"], ["wash", "--color-wash", "Subtle fills"], ["line", "--color-line", "Hairlines"],
  ["ink", "--color-ink", "Text"], ["quiet", "--color-quiet", "Secondary text"], ["pine", "--color-pine", "Primary, the one accent"], ["pine-soft", "--color-pine-soft", "Selected, verified fill"],
  ["clay", "--color-clay", "Failed only"], ["bone", "--color-bone", "The one light chapter"], ["bone-text", "--color-bone-text", "Text on the light chapter"], ["bone-quiet", "--color-bone-quiet", "Secondary text there"],
];

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-line pt-8 lg:grid-cols-[14rem_1fr]">
      <p className="t-label">{label}</p>
      <div className="min-w-0 space-y-8">{children}</div>
    </section>
  );
}

export default function DesignPage() {
  return (
    <div className="space-y-16 pb-24">
      <header className="space-y-6">
        <p className="t-label">Style sheet · Paper &amp; Dust (dark)</p>
        <h1 className="t-display max-w-[16ch]">A calm page, <span className="t-serif">loud</span> type.</h1>
        <p className="t-lead">Near-black green paper, light sage ink and one light-sage accent (the logo artwork&apos;s palette). Huge light headlines with a single italic accent, tiny uppercase labels, hairlines instead of boxes, and one light chapter for contrast.</p>
      </header>

      <Section label="Logo">
        <div className="flex flex-wrap items-center gap-10"><Wordmark /><LogoMark className="h-20 w-auto" /></div>
        <p className="text-sm text-quiet">An &ldquo;M&rdquo; of rounded diamond tiles in three sage tones, and a thin, wide-tracked wordmark whose A has no crossbar.</p>
      </Section>

      <Section label="Colour">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map(([name, v, use]) => (
            <div key={name}>
              <div className="h-20 rounded-(--radius-control) border border-line" style={{ background: `var(${v})` }} />
              <p className="mt-2 text-sm font-medium">{name}</p>
              <p className="text-xs text-quiet">{use}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Type scale">
        <div className="space-y-8">
          <div><p className="t-label mb-3">Display · Space Grotesk Light</p><p className="t-display max-w-[18ch]">Make business history <span className="t-serif">count.</span></p></div>
          <div><p className="t-label mb-3">Headline</p><p className="t-headline max-w-[22ch]">Suppliers and payment apps vouch with money behind their word.</p></div>
          <div><p className="t-label mb-3">Title</p><p className="t-title">The lender pays 1 USDC to check</p></div>
          <div><p className="t-label mb-3">Lead · Inter</p><p className="t-lead">Lenders check that proof on Stellar and give those stores a loan. Missing evidence means unknown, never bad.</p></div>
          <div><p className="t-label mb-3">Label</p><p className="t-label !text-ink">Verification infrastructure for the next billion customers</p></div>
          <div><p className="t-label mb-3">Numbers are tabular</p><p className="t-title t-num">₹22,500 · 0.70 USDC · 30 USDC · 6 of 6</p></div>
        </div>
      </Section>

      <Section label="Text reveal">
        <Reveal as="p" className="t-headline max-w-[20ch]">Scroll this into view and each line <span className="t-serif">rises</span> out of its mask.</Reveal>
      </Section>

      <Section label="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Magnetic><button className="btn btn-primary">Explore the demo<ArrowUpRight className="size-5" aria-hidden /></button></Magnetic>
          <button className="btn btn-ghost">Learn more</button>
          <span className="text-sm text-quiet">The primary button leans toward the pointer.</span>
        </div>
      </Section>

      <Section label="Status stamps">
        <div className="flex flex-wrap gap-3">
          <span className="stamp stamp-ok"><CircleCheck className="size-3.5" aria-hidden />Verified</span>
          <span className="stamp stamp-unknown"><CircleDashed className="size-3.5" aria-hidden />Unknown</span>
          <span className="stamp stamp-bad"><CircleX className="size-3.5" aria-hidden />Did not pass</span>
        </div>
        <p className="text-sm text-quiet">Always a word and an icon with the colour. Colour is never the only signal.</p>
      </Section>

      <Section label="Data table">
        <div className="overflow-x-auto">
          <table className="dtable min-w-[34rem]">
            <thead><tr><th>Issuer</th><th>Kind</th><th className="text-right">Claimed / month</th><th className="text-right">Net</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td className="font-medium">Gupta Wholesale</td><td>Supplier</td><td className="text-right">₹45,000</td><td className="text-right">₹45,167</td><td><span className="stamp stamp-ok">Verified</span></td></tr>
              <tr><td className="font-medium">QuickSupply</td><td>Supplier</td><td className="text-right">₹1,50,000</td><td className="text-right">₹10,000</td><td><span className="stamp stamp-bad">Net flow failed</span></td></tr>
              <tr><td className="font-medium">Sunrise Mart</td><td>Shop</td><td className="text-right">–</td><td className="text-right">–</td><td><span className="stamp stamp-unknown">Unknown</span></td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section label="Form">
        <div className="grid max-w-xl gap-6 sm:grid-cols-2">
          <label className="block"><span className="t-label">Amount (₹)</span><input className="mt-2 block w-full border-0 border-b border-ink bg-transparent px-0 py-2 text-xl focus:border-pine focus:outline-none" defaultValue="20,000" /></label>
          <label className="block"><span className="t-label">Pay back over</span><select className="mt-2 block w-full border-0 border-b border-ink bg-transparent px-0 py-2 text-xl focus:border-pine focus:outline-none"><option>6 months</option></select></label>
        </div>
      </Section>

      <Section label="The light chapter">
        <div className="rounded-(--radius-panel) bg-bone p-8 text-bone-text">
          <p className="t-label !text-bone-quiet">Built on Stellar · Testnet</p>
          <p className="t-headline mt-6 max-w-[18ch]">A contract that <span className="t-serif">cannot</span> be edited quietly.</p>
          <p className="mt-6 font-mono text-xs text-bone-quiet">CBEGE446…C575CYDG</p>
        </div>
      </Section>
    </div>
  );
}
