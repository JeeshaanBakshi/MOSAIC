"use client";
// Magnetic: the wrapped button leans a few pixels toward the pointer when it gets close, then eases back.
// gsap.quickTo makes the follow cheap (one tween reused). Off for touch screens and reduced motion.
import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";

export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce), (hover: none)").matches) return;
    const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * strength); y((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => { x(0); y(0); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); gsap.killTweensOf(el); };
  }, [strength]);
  return <span ref={ref} className="inline-block">{children}</span>;
}
