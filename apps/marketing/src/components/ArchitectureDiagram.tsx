"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  Monitor,
  Smartphone,
  Printer,
  Cloud,
  KeyRound,
  UtensilsCrossed,
  ArrowRight,
} from "lucide-react";
import { SectionHeading } from "./FeatureGrid";
import { EASE_OUT } from "@/lib/motion";

function Node({
  icon: Icon,
  label,
  emphasis,
}: {
  icon: typeof Monitor;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-[12.5px] font-semibold ${
        emphasis
          ? "border-accent/40 bg-accent/10 text-white"
          : "border-white/10 bg-white/[0.04] text-white/75"
      }`}
    >
      <Icon size={15} strokeWidth={1.9} />
      {label}
    </div>
  );
}

export function ArchitectureDiagram() {
  const reduced = useReducedMotion();
  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-60px" },
          transition: { duration: 0.5, ease: EASE_OUT, delay },
        };

  return (
    <section id="mimari" className="bg-night py-24 text-white sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Mimari"
          light
          title="Verileriniz sizde kalır. Bulutun görevi yalnızca doğrulamak."
          lede="Bir apartman yerine müstakil ev düşünün: her restoran kendi evinde çalışır, bulut yalnızca kapının tapusunu (lisansı) ve ortak tabelayı (menüyü) tutar."
        />

        <div className="mt-16 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
          <motion.div
            {...enter(0)}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-6"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                Sizin Restoranınız — Yerel Ağ
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </div>
            <div className="space-y-2.5">
              <Node icon={Monitor} label="Kasa · Yerel Sunucu + Veritabanı" emphasis />
              <Node icon={Smartphone} label="Garson Telefonları" />
              <Node icon={Printer} label="Mutfak / Kasa Yazıcıları" />
              <Node icon={UtensilsCrossed} label="Müşteri Masası — QR Menü" />
            </div>
          </motion.div>

          <motion.div
            {...enter(0.15)}
            className="flex flex-row items-center justify-center gap-2 py-2 lg:flex-col lg:gap-3"
          >
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.1em] text-white/35 lg:block">
              saatlik
            </span>
            <motion.div
              animate={reduced ? undefined : { x: [0, 5, 0], opacity: [0.3, 0.85, 0.3] }}
              transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
            >
              <ArrowRight size={18} className="rotate-90 text-white/25 lg:rotate-0" />
            </motion.div>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
              yoklama
            </span>
          </motion.div>

          <motion.div
            {...enter(0.3)}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-6"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">
                Bulut — Yalnız İki Görev
              </span>
              <Cloud size={14} className="text-white/45" />
            </div>
            <div className="space-y-2.5">
              <Node icon={KeyRound} label="İmzalı Lisans Doğrulama" emphasis />
              <Node icon={UtensilsCrossed} label="Ortak / Genel Menü Yayını" />
            </div>
            <p className="mt-5 text-[12px] leading-relaxed text-white/45">
              Sipariş, ödeme, stok ve müşteri verisi bu kutuya hiç girmez —
              yalnızca restoranınızda kalır.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
