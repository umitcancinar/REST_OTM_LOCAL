import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Garson bundle'i tek LAN gateway altinda /garson prefix'iyle servis edilir.
  // basePath build-time'da client bundle'a yazildigi icin saha artifact'i bu
  // sabit contract ile uretilir.
  basePath: '/garson',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // Windows payload'i kaynak haritasi tasiyan dosya kabul etmez.
  productionBrowserSourceMaps: false,
  experimental: {
    serverSourceMaps: false,
  },
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
