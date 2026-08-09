import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://restoranyonetim.com"),
  title: {
    default: "REST_OTM — Restoranınız internet gitse de çalışır",
    template: "%s — REST_OTM",
  },
  description:
    "Siparişten mutfağa, yazıcıdan faturaya restoranınızın tüm operasyonu kendi bilgisayarınızda çalışır. İnternet kesilse bile durmaz. İmzalı lisans ile uzaktan yönetilir.",
  keywords: [
    "restoran otomasyon",
    "adisyon programı",
    "restoran POS",
    "yerel restoran yazılımı",
    "restoran yönetim sistemi",
  ],
  openGraph: {
    title: "REST_OTM — Restoranınız internet gitse de çalışır",
    description:
      "Yerel-öncelikli restoran otomasyonu: sipariş, mutfak, yazıcı, stok, fatura — kendi bilgisayarınızda, imzalı lisansla güvence altında.",
    url: "https://restoranyonetim.com",
    siteName: "REST_OTM",
    locale: "tr_TR",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#171310",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className="font-sans">{children}</body>
    </html>
  );
}
