import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // Workspace paketi CJS dist olarak gelir; Next'in derlemesine dahil edilir.
  transpilePackages: ['@rest-otm/receipt-core'],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
