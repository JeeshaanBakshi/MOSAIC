import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Shell } from "@/components/Shell";
import { ResetOnLoad } from "@/components/ResetOnLoad";
import { CloudSync } from "@/components/CloudSync";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mosaic: trading history as credit history",
  description: "Suppliers and payment apps vouch for small shops. Lenders check the evidence and decide. Prototype, blockchain simulated.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${space.variable} h-full antialiased`}>
      <body>
        <Suspense fallback={null}><ResetOnLoad /></Suspense>
        <CloudSync />
        <Shell>{children}</Shell>
        <Toaster position="bottom-right" icons={{
          success: <CircleCheck className="size-4 text-pine" />, error: <CircleAlert className="size-4 text-clay" />,
          info: <Info className="size-4 text-quiet" />, warning: <TriangleAlert className="size-4 text-ink" />, loading: <LoaderCircle className="size-4 animate-spin" />,
        }} toastOptions={{ classNames: { toast: "!rounded-(--radius-control) !border !border-line !bg-surface !text-ink !shadow-none !font-sans", description: "!text-quiet" } }} />
      </body>
    </html>
  );
}
