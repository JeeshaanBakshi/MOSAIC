import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true, // Next 16 default: usePathname/useSearchParams must sit inside <Suspense>
  partialPrefetching: true,
  turbopack: {
    root: __dirname, // this folder is the app root (a parent folder has its own lockfile)
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
