import { PageSkeleton } from "@/components/ui";
import { Suspense } from "react";
import { LenderView } from "./LenderView";

// LenderView reads ?shop=... from the URL, which Next 16 requires inside <Suspense>.
export default function LenderPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LenderView />
    </Suspense>
  );
}
