"use client";
// Scroll effects for the landing chapters, wired by data attributes so the markup stays plain:
//   data-grow  : a bar that grows from the left when it scrolls into view (the 70% match, the 70/30 fee split)
//   data-rise  : an element that fades up when it scrolls into view
// Reduced motion: everything is simply shown.
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function ChapterFx() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-grow]").forEach((el) => {
        gsap.from(el, { scaleX: 0, transformOrigin: "left center", duration: 1.4, ease: "expo.out", delay: Number(el.dataset.grow) || 0, scrollTrigger: { trigger: el, start: "top 90%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-rise]").forEach((el, i) => {
        gsap.from(el, { y: 28, opacity: 0, duration: 1, ease: "expo.out", delay: (i % 4) * 0.06, scrollTrigger: { trigger: el, start: "top 90%", once: true } });
      });
    });
    return () => ctx.revert();
  }, []);
  return null;
}
