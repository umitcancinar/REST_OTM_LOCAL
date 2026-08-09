"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, ArrowUpRight } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";
import { EASE_OUT } from "@/lib/motion";

interface Tier {
  name: string;
  tagline: string;
  featured?: boolean;
  features: string[];
}

const TIERS: Tier[] = [
  {
    name: "Başlangıç",
    tagline: "Tek şube, temel operasyon",
    features: [
      "Sipariş & mutfak ekranı",
      "Masa yönetimi",
      "Temel yazıcı entegrasyonu",
      "İmzalı lisans & 7 gün çevrimdışı çalışma",
    ],
  },
  {
    name: "Profesyonel",
    tagline: "Büyüyen restoranlar için",
    featured: true,
    features: [
      "Başlangıç paketindeki her şey",
      "Stok & reçete yönetimi",
      "Rezervasyon & müşteri kaydı",
      "QR menü & garson ağı",
      "Şifreli otomatik yedekleme",
    ],
  },
  {
    name: "Kurumsal",
    tagline: "Çoklu şube ve özel entegrasyon",
    features: [
      "Profesyonel paketteki her şey",
      "e-Fatura & POS terminal entegrasyonu",
      "Öncelikli kurulum desteği",
      "Çoklu şube danışmanlığı",
    ],
  },
];

export function PackagesSection() {
  const reduced = useReducedMotion();

  return (
    <section id="paketler" className="bg-surface-2 py-24 sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Paketler"
          title="İşletmenizin büyüklüğüne göre ölçeklenir"
          lede="Fiyatlandırma, şube sayısı ve ihtiyaç duyduğunuz entegrasyonlara göre değişir — demo görüşmesinde netleştiririz."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial={false}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, ease: EASE_OUT, delay: i * 0.08 }}
              className={`relative flex flex-col rounded-lg border p-7 ${
                tier.featured
                  ? "border-accent bg-night text-white shadow-[0_40px_90px_-40px_rgba(20,15,10,0.4)]"
                  : "border-line bg-surface"
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                  Önerilen
                </span>
              )}

              <h3
                className={`font-display text-[21px] font-semibold ${
                  tier.featured ? "text-white" : "text-ink"
                }`}
              >
                {tier.name}
              </h3>
              <p className={`mt-1 text-[13px] ${tier.featured ? "text-white/55" : "text-muted"}`}>
                {tier.tagline}
              </p>

              <ul className="mt-6 flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                    <Check
                      size={16}
                      strokeWidth={2.5}
                      className={`mt-0.5 shrink-0 ${tier.featured ? "text-accent" : "text-accent"}`}
                    />
                    <span className={tier.featured ? "text-white/80" : "text-ink"}>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href="#demo"
                className={`mt-7 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[13px] font-bold transition ${
                  tier.featured
                    ? "bg-white text-night hover:bg-accent hover:text-white"
                    : "bg-night text-white hover:bg-accent"
                }`}
              >
                Fiyat Teklifi Alın
                <ArrowUpRight size={14} strokeWidth={2.5} />
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
