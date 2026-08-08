import type { Metadata } from 'next';
import { ThemeProvider } from '../context/ThemeContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'REST_OTM — Yönetim Paneli',
  description: 'Multi-Tenant Restaurant SaaS Platform — Restoran Yönetim Paneli',
  keywords: ['restoran', 'pos', 'sipariş yönetimi', 'stok takibi', 'SaaS'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
