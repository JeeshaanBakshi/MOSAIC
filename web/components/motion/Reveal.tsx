"use client";
// Reveal: splits a block of text into lines and slides each line up out of a mask, one after another, when it
// scrolls into view. GSAP SplitText does the splitting; ScrollTrigger decides when. Reduced motion: just shows the text.
import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

export function Reveal({ as: Tag = "div", className, children, delay = 0, start = "top 88%", id }: { as?: ElementType; className?: string; children: ReactNode; delay?: number; start?: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.style.visibility = "visible"; return; }
    gsap.registerPlugin(ScrollTrigger, SplitText);
    const ctx = gsap.context(() => {
      SplitText.create(el, {
        type: "lines", mask: "lines", autoSplit: true, // autoSplit re-splits when the width (and so the line breaks) changes
        onSplit: (self) => {
          el.style.visibility = "visible";
          return gsap.from(self.lines, { yPercent: 115, duration: 1.1, ease: "expo.out", stagger: 0.09, delay, scrollTrigger: { trigger: el, start, once: true } });
        },
      });
    }, el);
    return () => ctx.revert();
  }, [delay, start]);
  // Hidden until the split is ready, so you never see the text flash before it animates in.
  return <Tag ref={ref} id={id} className={className} style={{ visibility: "hidden" }}>{children}</Tag>;
}
