// BUILT ON STELLAR: the one LIGHT chapter on a dark page. The contract, what it does, and real testnet transactions.
// Testnet is marked everywhere: nothing here is production.
import { ExternalLink } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { CONTRACT_ID, contractUrl, short, txUrl } from "@/lib/format";

// Real transactions on the testnet contract (the same ones listed in the README, "Verified on testnet").
const PROOF = [
  { label: "Lender fee split: 0.70 USDC to the supplier, 0.30 to the platform", fn: "verify", hash: "17474d8c6f43f14a9b32611f470ae0c74f48047036fcc181a3d132753a57013f" },
  { label: "An issuer's claim, locking a 30 USDC stake", fn: "issue_credential", hash: "84db28679b74d21e95c7b06db93d416c660a447fb00bcda6c9c39334023e2c80" },
  { label: "A lender reports that the shop defaulted", fn: "report_default", hash: "aabaefb04b070db61195c19ab31909adcf5579810ef23bf5dd4321f530ee7ca7" },
  { label: "A dispute is opened against a credential", fn: "open_dispute", hash: "c298e2b0840cacbdd6c70b480d7cd25ca647d4eaa8e331beffc44b6379ffa257" },
  { label: "Dispute upheld: the 30 USDC stake paid to the lender", fn: "resolve_dispute", hash: "14b81f35c177eb1e2c6f2d1cc751e24cdc04a8de97d42940ac3cc1fd2aaba3c6" },
];

const FACTS = [
  ["Issuer registry", "Only issuers the admin approved can sign a claim."],
  ["Stake locking", "30 USDC is locked per claim and returned after it expires."],
  ["Lender fee split", "1 USDC per check: 70% to the issuers whose claims passed, 30% to the platform."],
  ["Dispute settlement", "After a default, an upheld dispute pays the stake to the lender. Two strikes suspend an issuer."],
];

export function StellarChapter() {
  return (
    <section aria-labelledby="stellar-h" className="rounded-(--radius-panel) bg-bone p-6 text-bone-text sm:p-10 lg:p-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="t-label !text-bone-quiet">Chapter 02 · On-chain</p>
        <span className="stamp text-bone-quiet">Stellar testnet · not production</span>
      </div>
      <Reveal as="h2" id="stellar-h" className="t-headline mt-8 max-w-[14ch]">Built on <span className="t-serif">Stellar</span></Reveal>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-quiet">
        A Soroban smart contract on Stellar testnet holds the issuer registry, the stakes, the lender fee split and the disputes. These are real testnet transactions you can open:
      </p>
      <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="t-label !text-bone-quiet">Contract</span>
        <a href={contractUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-mono underline underline-offset-4">{short(CONTRACT_ID, 8)}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">on Stellar Expert (testnet)</span></a>
      </p>

      <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {FACTS.map(([t, b], i) => (
          <div key={t} data-rise className="border-t border-bone-line pt-4">
            <p className="t-label !text-bone-quiet">0{i + 1}</p>
            <p className="t-title mt-3">{t}</p>
            <p className="mt-2 text-bone-quiet">{b}</p>
            {i === 2 && <div className="mt-4 flex h-2 overflow-hidden"><div data-grow className="flex-[7] bg-bone-text" /><div data-grow="0.2" className="flex-[3] bg-bone-text/30" /></div>}
            {i === 1 && <div className="mt-4 h-2 bg-bone-line"><div data-grow className="h-full w-full bg-bone-text" /></div>}
          </div>
        ))}
      </div>

      <ul className="mt-12 divide-y divide-bone-line border-y border-bone-line text-sm">
        {PROOF.map((p) => (
          <li key={p.hash} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
            <span><span className="mr-3 font-mono text-xs text-bone-quiet">{p.fn}</span>{p.label}</span>
            <a href={txUrl(p.hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-4">{p.hash.slice(0, 10)}…<ExternalLink className="size-3" aria-hidden /><span className="sr-only">View on Stellar Expert</span></a>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-bone-quiet">Testnet only: test USDC with no value. There is no mainnet deployment yet.</p>
    </section>
  );
}
