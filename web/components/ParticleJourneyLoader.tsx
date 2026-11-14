"use client";
// next/dynamic with ssr:false ("never render this on the server": a canvas only exists in the browser)
// can only be used inside a client component, so this tiny wrapper does it.
import dynamic from "next/dynamic";

export const ParticleJourney = dynamic(() => import("./ParticleJourney"), { ssr: false });
