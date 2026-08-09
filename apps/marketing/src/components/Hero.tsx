"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, PlayCircle, Wifi, WifiOff } from "lucide-react";
import { DeviceCluster } from "./DeviceCluster";

const easeOut = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const reduced = useReducedMotion();

  // Hero sayfa acilir acilmaz zaten ekrandadir — whileInView (scroll
  // tetiklemesi) burada yanlis arac: gozlemci gec kurulursa veya ilk
  // kesisim kontrolu kacirilirsa icerik opacity:0'da tikanip kalabilir.
  // animate, mount aninda kosulsuz calisir.
  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, ease: easeOut, delay },
        };

  return (
    <section
      id="top"
      className="relative isolate overflow-hidden bg-night pb-24 pt-[150px] text-white sm:pb-32"
    >
      <div
        aria-hidden
        className="hero-grid pointer-events-none absolute inset-0 -z-20 opacity-[0.62]"
        style={{ maskImage: "linear-gradient(180deg, black, transparent 78%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-20 -z-10 h-[620px] w-[620px] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--accent) / 0.35), hsl(var(--accent) / 0.08) 45%, transparent 72%)",
        }}
      />
      {!reduced && (
        <>
          <div
            aria-hidden
            className="hero-orbit pointer-events-none absolute -right-24 top-1/2 -z-10 h-[520px] w-[520px] -translate-y-1/2 rounded-full border border-white/[0.075]"
          >
            <span className="absolute -left-1 top-1/2 h-2 w-2 rounded-full bg-accent shadow-[0_0_18px_hsl(var(--accent)/0.8)]" />
          </div>
          <div
            aria-hidden
            className="hero-orbit-reverse pointer-events-none absolute -right-8 top-1/2 -z-10 h-[360px] w-[360px] -translate-y-1/2 rounded-full border border-white/[0.055]"
          >
            <span className="absolute left-1/2 top-0 h-1.5 w-1.5 rounded-full bg-white/70" />
          </div>
        </>
      )}

      <div className="container-shell grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <div>
          <motion.div
            {...enter(0)}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70"
          >
            <span className="signal-dot h-1.5 w-1.5 rounded-full bg-accent" />
            Yerel-öncelikli restoran otomasyonu
          </motion.div>

          <motion.h1
            {...enter(0.08)}
            className="text-balance-pretty mt-6 max-w-[15ch] font-display text-[44px] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-[58px] lg:text-[64px]"
          >
            İnternet gitse de <em className="text-accent not-italic">restoranınız</em> durmaz.
          </motion.h1>

          <motion.p
            {...enter(0.16)}
            className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-white/65 sm:text-[17.5px]"
          >
            Sipariş, mutfak ekranı, yazıcı, stok ve kasa — hepsi kendi bilgisayarınızda
            çalışır. Bulut yalnızca lisansınızı ve ortak menünüzü yönetir. Bağlantı
            kesilse bile operasyon 7 gün boyunca kesintisiz sürer.
          </motion.p>

          <motion.div {...enter(0.24)} className="mt-9 flex flex-wrap items-center gap-4">
            <a
              href="#demo"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[13.5px] font-bold text-night transition hover:bg-accent hover:text-white"
            >
              Demo Talep Et
              <ArrowUpRight
                size={16}
                strokeWidth={2.5}
                className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
            <a
              href="#nasil-calisir"
              className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-white/80 transition hover:text-white"
            >
              <PlayCircle size={18} strokeWidth={2} />
              Nasıl çalıştığını gör
            </a>
          </motion.div>

          <motion.div
            {...enter(0.32)}
            className="panel-shimmer mt-11 flex flex-wrap items-center gap-x-8 gap-y-3 overflow-hidden rounded-md border border-white/10 bg-white/[0.025] px-4 py-3.5 text-[12px] font-semibold text-white/50"
          >
            <span className="inline-flex items-center gap-1.5">
              <WifiOff size={14} /> 7 gün çevrimdışı çalışma toleransı
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Wifi size={14} /> Ed25519 imzalı lisans denetimi
            </span>
          </motion.div>
        </div>

        <motion.div
          initial={false}
          animate={reduced ? undefined : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: easeOut, delay: 0.1 }}
        >
          <DeviceCluster />
        </motion.div>
      </div>
    </section>
  );
}
