"use client";

import { motion, useReducedMotion } from "motion/react";
import { Printer, Smartphone, Cloud, Wifi, Clock3, UtensilsCrossed } from "lucide-react";

/**
 * Hero'daki mimari gorseli. Gercek bir ekran goruntusu DEGIL — bilerek
 * semantik/soyut bir "cihaz agi" olarak tasarlandi. Amac: "operasyon
 * yerelde, bulut yalniz lisans/menu icin" mesajini tek bakista vermek.
 */
export function DeviceCluster() {
  const reduced = useReducedMotion();

  const float = (offset: number) =>
    reduced
      ? {}
      : {
          animate: { y: [0, -8, 0] },
          transition: {
            duration: 5,
            repeat: Infinity,
            ease: "easeInOut" as const,
            delay: offset,
          },
        };

  return (
    <div className="relative mx-auto aspect-[4/3.1] w-full max-w-[480px]">
      {/* Bulut düğümü — ince, kesikli bağlantı: yalnızca lisans/menü */}
      <motion.div
        {...float(0.2)}
        className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2"
      >
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 backdrop-blur-md">
          <Cloud size={14} className="text-white/70" />
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/70">
            Bulut · Lisans &amp; Menü
          </span>
        </div>
      </motion.div>

      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 320"
        fill="none"
      >
        <motion.line
          x1="200" y1="18" x2="200" y2="96"
          stroke="hsl(var(--accent) / 0.45)" strokeWidth="1.5" strokeDasharray="3 5"
          initial={false}
          animate={reduced ? undefined : { strokeDashoffset: [0, -32] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
        />
        <motion.line
          x1="200" y1="180" x2="330" y2="120"
          stroke="white" strokeOpacity="0.14" strokeWidth="1.5" strokeDasharray="3 5"
          initial={false}
          animate={reduced ? undefined : { strokeDashoffset: [0, -32] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear", delay: 0.35 }}
        />
        <motion.line
          x1="200" y1="200" x2="90" y2="250"
          stroke="white" strokeOpacity="0.14" strokeWidth="1.5" strokeDasharray="3 5"
          initial={false}
          animate={reduced ? undefined : { strokeDashoffset: [0, -32] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear", delay: 0.9 }}
        />
      </svg>

      {/* Ana panel — kasa/patron ekranı, soyut şema */}
      <motion.div
        {...float(0)}
        className="panel-shimmer absolute left-1/2 top-[92px] z-10 w-[76%] -translate-x-1/2 overflow-hidden rounded-lg border border-white/12 bg-night-2 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="ml-2 text-[10px] font-semibold text-white/40">
            kasa · yerel sunucu
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-bold text-accent">
            <span className="signal-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <Wifi size={10} /> çevrimiçi
          </span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 border-b border-white/10 pb-3">
            <div className="rounded-md bg-white/[0.055] px-2.5 py-2"><span className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/35">Açık masa</span><span className="mt-1 block text-[15px] font-bold text-white">07 <span className="text-[9px] font-medium text-white/35">/ 12</span></span></div>
            <div className="rounded-md bg-accent/10 px-2.5 py-2"><span className="block text-[8.5px] font-bold uppercase tracking-[0.1em] text-accent/75">Mutfakta</span><span className="mt-1 block text-[15px] font-bold text-white">04 <span className="text-[9px] font-medium text-white/45">sipariş</span></span></div>
          </div>
          <div className="mt-3 grid grid-cols-[1.35fr_1fr] gap-2">
            <div className="space-y-1.5">
              {["Masa 5 · Adana Kebap", "Masa 3 · Izgara Köfte", "Masa 7 · Ayran"].map((order, index) => <div key={order} className="flex items-center gap-1.5 rounded bg-white/[0.045] px-2 py-1.5"><span className={`h-1.5 w-1.5 rounded-full ${index === 2 ? "bg-emerald-300" : "bg-accent"}`} /><span className="truncate text-[8.5px] font-semibold text-white/70">{order}</span></div>)}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((table) => <div key={table} className={`grid aspect-square place-items-center rounded text-[9px] font-bold ${table === 1 || table === 4 ? "bg-accent/30 text-accent" : table === 5 ? "bg-emerald-400/20 text-emerald-300" : "bg-white/[0.06] text-white/45"}`}>{table}</div>)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[8.5px] font-semibold text-white/45"><span className="inline-flex items-center gap-1"><Clock3 size={10} /> Son sipariş 18 sn önce</span><span className="inline-flex items-center gap-1 text-emerald-300"><UtensilsCrossed size={10} /> 1 hazır</span></div>
        </div>
      </motion.div>

      {/* Yazıcı düğümü */}
      <motion.div
        {...float(0.6)}
        className="absolute left-[10%] top-[74%] z-20 flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 backdrop-blur-md"
      >
        <Printer size={14} className="text-white/70" />
        <span className="text-[10.5px] font-bold text-white/70">Mutfak yazıcısı</span>
      </motion.div>

      {/* Garson telefonu düğümü */}
      <motion.div
        {...float(0.9)}
        className="absolute right-[6%] top-[36%] z-20 flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 backdrop-blur-md"
      >
        <Smartphone size={14} className="text-white/70" />
        <span className="text-[10.5px] font-bold text-white/70">Garson · LAN</span>
      </motion.div>
    </div>
  );
}
