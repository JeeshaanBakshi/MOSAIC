import { ArrowUpRight } from "lucide-react";
import { RoleLink } from "@/components/RoleLink";
import { Magnetic } from "@/components/motion/Magnetic";
import { Reveal } from "@/components/motion/Reveal";
import { ParticleJourney } from "@/components/ParticleJourneyLoader";
import { ChapterFx } from "@/components/landing/ChapterFx";
import { DemoScenarios } from "@/components/landing/DemoScenarios";
import { FinalCta } from "@/components/landing/FinalCta";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Roles } from "@/components/landing/Roles";
import { StellarChapter } from "@/components/landing/StellarChapter";

export default function Home() {
  return (
    <>
      <ParticleJourney />
    {/* The particle canvas is fixed behind the page; everything here sits above it. data-shape-index marks where each shape belongs. */}
    <div className="relative z-10 space-y-24 lg:space-y-36">
      {/* HERO. The particle logo (fixed canvas behind the page) forms in the whitespace on the right; the text column's
          max width is worked out from where that logo sits, so the two never overlap. */}
      <section data-shape-index="0" data-shape-side="right" data-shape-scale="1.15"
        className="relative flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-14 pb-6 md:max-w-[58%] lg:max-w-[min(44rem,calc(256px+(100vw-256px)*0.78-min(56svh,(100vw-256px)*0.3)*0.575-376px))]">
        <div>
          <p className="t-label flex items-center gap-3"><span aria-hidden className="h-px w-10 bg-pine" />Verification infrastructure for the next billion customers</p>
          <Reveal as="h1" className="t-display mt-8">
            A business shouldn&apos;t need a <span className="t-serif">credit history</span> to prove it has a <span className="t-serif">real economic history.</span>
          </Reveal>
        </div>
        <div className="space-y-8">
          <p className="t-lead">
            Distributors and payment apps vouch for the neighbourhood stores they already work with, with money behind their word. Lenders check that proof on Stellar and give those stores a loan. Missing evidence means unknown, never bad.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Magnetic>
              <RoleLink role="asha" href="/lender?shop=shop-1" className="btn btn-primary">Explore the demo<ArrowUpRight className="size-5" aria-hidden /></RoleLink>
            </Magnetic>
            <a href="#how" className="btn btn-ghost">Learn more</a>
          </div>
          <p className="text-sm text-quiet">Opens the lender view with the example data loaded. Nothing to sign up for, no wallet needed.</p>
          <div className="flex items-center gap-3" aria-hidden><span className="scroll-line" /><span className="t-label">Scroll</span></div>
        </div>
      </section>

      <HowItWorks />
      <StellarChapter />
      <DemoScenarios />
      <Roles />
      <FinalCta />
      <ChapterFx />
    </div>
    </>
  );
}
