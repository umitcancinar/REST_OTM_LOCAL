import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "REST_OTM — Yerel-öncelikli Restoran Otomasyonu",
    short_name: "REST_OTM",
    description:
      "Restoranınızın operasyonu kendi bilgisayarınızda çalışır; internet gitse de durmaz.",
    start_url: "/",
    display: "standalone",
    background_color: "#171310",
    theme_color: "#171310",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
