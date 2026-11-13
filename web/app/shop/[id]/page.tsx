import { PageSkeleton } from "@/components/ui";
import { Suspense } from "react";
import { ShopView } from "./ShopView";

// Next 16: `params` is a Promise. We read it inside <Suspense> so the page shell renders instantly.
export default function ShopPage({ params }: PageProps<"/shop/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ShopFromParams params={params} />
    </Suspense>
  );
}

async function ShopFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShopView id={id} />;
}
