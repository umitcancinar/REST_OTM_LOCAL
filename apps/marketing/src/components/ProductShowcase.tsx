"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ClipboardList, ChefHat, Receipt, Wifi } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";
import { EASE_OUT } from "@/lib/motion";

type TabKey = "siparis" | "mutfak" | "adisyon";

const TABS: { key: TabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "siparis", label: "Sipariş Ekranı", icon: ClipboardList },
  { key: "mutfak", label: "Mutfak Ekranı", icon: ChefHat },
  { key: "adisyon", label: "Adisyon & Kasa", icon: Receipt },
];

const TABLE_STATUS: Record<number, "bos" | "dolu" | "hazir"> = {
  1: "dolu", 2: "bos", 3: "dolu", 4: "bos", 5: "hazir", 6: "bos",
  7: "dolu", 8: "bos", 9: "bos", 10: "dolu", 11: "bos", 12: "hazir",
};

const statusColor: Record<string, string> = {
  bos: "bg-white/[0.05] text-white/35 border-white/10",
  dolu: "bg-accent/20 text-accent border-accent/40",
  hazir: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
};

function OrderPanel() {
  return (
    <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[1fr_1.3fr] sm:p-7">
      <div>
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">
          Masalar
        </p>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(TABLE_STATUS).map(([n, s]) => (
            <div
              key={n}
              className={`grid aspect-square place-items-center rounded-md border text-[12px] font-bold ${statusColor[s]}`}
            >
              {n}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">
          Masa 5 — Sipariş
        </p>
        <div className="space-y-2">
          {[
            ["2x Adana Kebap", "PENDING"],
            ["1x Ayran", "READY"],
            ["3x Lavaş", "PENDING"],
          ].map(([item, status], i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5"
            >
              <span className="text-[12.5px] font-semibold text-white/85">{item}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase ${
                  status === "READY"
                    ? "bg-emerald-400/20 text-emerald-300"
                    : "bg-accent/20 text-accent"
                }`}
              >
                {status === "READY" ? "hazır" : "hazırlanıyor"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KitchenPanel() {
  const cols = [
    { title: "Yeni", tickets: ["Masa 3 · 2x Izgara Köfte", "Masa 7 · 1x Karışık Izgara"] },
    { title: "Hazırlanıyor", tickets: ["Masa 5 · 3x Lavaş", "Masa 1 · 2x Adana Kebap"] },
    { title: "Hazır", tickets: ["Masa 5 · 1x Ayran"] },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3 sm:p-7">
      {cols.map((c) => (
        <div key={c.title}>
          <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">
            {c.title} · {c.tickets.length}
          </p>
          <div className="space-y-2">
            {c.tickets.map((t, i) => (
              <div
                key={i}
                className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] font-semibold text-white/80"
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BillPanel() {
  const items = [
    ["2x Adana Kebap", "740₺"],
    ["1x Ayran", "45₺"],
    ["3x Lavaş", "90₺"],
  ];
  return (
    <div className="mx-auto max-w-[360px] p-5 sm:p-7">
      <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">
        Masa 5 — Adisyon
      </p>
      <div className="divide-y divide-white/10 rounded-md border border-white/10 bg-white/[0.04]">
        {items.map(([n, p], i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 text-[12.5px]">
            <span className="text-white/80">{n}</span>
            <span className="font-semibold text-white/60">{p}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[13px] font-bold text-white">Toplam</span>
          <span className="font-display text-[17px] font-semibold text-accent">875₺</span>
        </div>
      </div>
      <button className="mt-4 w-full rounded-md bg-accent py-2.5 text-[12.5px] font-bold text-white">
        Ödemeyi Al ve Fiş Yazdır
      </button>
    </div>
  );
}

const PANELS: Record<TabKey, () => React.ReactElement> = {
  siparis: OrderPanel,
  mutfak: KitchenPanel,
  adisyon: BillPanel,
};

export function ProductShowcase() {
  const [active, setActive] = useState<TabKey>("siparis");
  const reduced = useReducedMotion();
  const Panel = PANELS[active];

  return (
    <section className="bg-night py-24 text-white sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Ürün"
          light
          title="Arayüzden bir kesit"
          lede="Aşağıdaki paneller sistemin gerçek ekran akışını basitleştirilmiş biçimde gösterir."
        />

        <div className="mt-12 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={active === t.key}
              className={`relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-4 py-2.5 text-[12.5px] font-bold transition ${
                active === t.key
                  ? "border-accent bg-accent/15 text-white"
                  : "border-white/12 bg-white/[0.03] text-white/55 hover:text-white/80"
              }`}
            >
              {active === t.key && !reduced && (
                <motion.span
                  layoutId="product-showcase-active-tab"
                  className="absolute inset-0 bg-accent/10"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-2">
                <t.icon size={14} strokeWidth={2} />
                {t.label}
              </span>
            </button>
          ))}
        </div>

        <motion.div
          whileHover={reduced ? undefined : { y: -3 }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="panel-shimmer mt-6 overflow-hidden rounded-lg border border-white/12 bg-night-2 shadow-[0_50px_100px_-50px_rgba(0,0,0,0.8)]"
        >
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="ml-2 text-[10px] font-semibold text-white/40">
              yerel sunucu · panel.restoranyonetim.com
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
              <Wifi size={10} /> canlı
            </span>
          </div>
          <div className="scroll-x-contain min-h-[280px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={false}
                animate={reduced ? undefined : { opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
              >
                <Panel />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
        <p className="mt-4 text-[11.5px] text-white/35">
          Yukarıdaki veriler örnek amaçlıdır; gerçek arayüz kurulumunuzda kendi menü ve masa
          düzeninizle çalışır.
        </p>
      </div>
    </section>
  );
}
