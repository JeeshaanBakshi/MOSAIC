import { Suspense } from "react";
import { LenderView } from "./LenderView";

// LenderView reads ?shop=... from the URL, which Next 16 requires inside <Suspense>.
export default function LenderPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading…</p>}>
      <LenderView />
    </Suspense>
  );
}
