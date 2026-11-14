// FINAL: every particle spreads out over the whole window (data-shape-index="6" is the scroll position where that is complete).
import { ArrowUpRight } from "lucide-react";
import { LoadDemoButton } from "@/components/LoadDemoButton";
import { RoleLink } from "@/components/RoleLink";
import { Magnetic } from "@/components/motion/Magnetic";
import { Reveal } from "@/components/motion/Reveal";

export function FinalCta() {
  return (
    <section className="pb-8 text-center">
      <div data-shape-index="6" data-shape-side="center" aria-hidden className="h-[14svh]" />
      <Reveal as="h2" className="t-display mx-auto max-w-[14ch]">Make business history <span className="t-serif">count.</span></Reveal>
      <div className="mt-10 flex justify-center">
        <Magnetic><RoleLink role="asha" href="/lender?shop=shop-1" className="btn btn-primary">Explore MOSAIC<ArrowUpRight className="size-5" aria-hidden /></RoleLink></Magnetic>
      </div>
      <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-3">
        <LoadDemoButton />
        <p className="text-sm leading-relaxed text-quiet">The demo loads by itself on the first visit. This button wipes everything for everyone and loads it again.</p>
      </div>
    </section>
  );
}
