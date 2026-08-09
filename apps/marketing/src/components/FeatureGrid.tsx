"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  WifiOff,
  ShieldCheck,
  Printer,
  DatabaseBackup,
  QrCode,
  Users,
  Boxes,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  big?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: WifiOff,
    title: "Yerel-öncelikli çalışma",
    body: "Sipariş, masa, mutfak ekranı ve kasa kendi bilgisayarınızdaki veritabanında çalışır. İnternet kesilse bile operasyon 7 gün boyunca durmadan sürer.",
    big: true,
  },
  {
    icon: ShieldCheck,
    title: "İmzalı lisans denetimi",
    body: "Her kurulum Ed25519 ile imzalanmış, tek bir cihaza bağlı bir lisansla çalışır. Kopyalanamaz, saati geri alınarak atlatılamaz.",
    big: true,
  },
  {
    icon: Printer,
    title: "Yazıcı & POS entegrasyonu",
    body: "Mutfak, ızgara, kasa ve paket fişleri; iptal/ikram etiketleri; Z-raporu — hepsi aynı yerel ağdaki fiziksel yazıcılara gider.",
  },
  {
    icon: DatabaseBackup,
    title: "Şifreli otomatik yedekleme",
    body: "Düzenli, şifreli yedekler ayrı bir konuma otomatik kopyalanır ve periyodik olarak geri yükleme testinden geçer.",
  },
  {
    icon: QrCode,
    title: "QR menü & garson ağı",
    body: "Garsonlar aynı Wi-Fi üzerinden telefonlarıyla bağlanır. Müşteri masasındaki QR, güvenli ve masaya özel bir bağlantı üretir.",
  },
  {
    icon: Boxes,
    title: "Stok & sipariş yönetimi",
    body: "Reçeteler, stok düşümü, fire takibi ve sipariş akışı tek panelden; personel yetkileri role göre ayrılır.",
  },
  {
    icon: Users,
    title: "Rezervasyon & müşteri kaydı",
    body: "Masa planı, rezervasyon takvimi ve müşteri geçmişi aynı yerel sistemde, ayrı bir araca ihtiyaç duymadan yönetilir.",
  },
  {
    icon: Gauge,
    title: "Süper-admin merkezi kontrol",
    body: "Bulut panelinden restoranların lisans süresini uzatır, durumunu izler; ekip uzaktan yönetim yükü taşımaz.",
  },
];

export function FeatureGrid() {
  const reduced = useReducedMotion();

  return (
    <section id="ozellikler" className="bg-bg py-24 sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Özellikler"
          title="Bir restoranın ihtiyaç duyduğu her şey, tek çatı altında"
          lede="Ayrı ayrı satın alınan beş aracın yerini tek, birbirine bağlı bir sistem alır."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={false}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.45,
                ease: EASE_OUT,
                delay: (i % 4) * 0.06,
              }}
              className={`surface-lift group rounded-lg border border-line bg-surface p-6 transition-colors hover:border-accent/40 ${
                f.big ? "sm:col-span-1 lg:col-span-2" : ""
              }`}
            >
              <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                <f.icon size={19} strokeWidth={1.8} />
              </div>
              <h3 className="mt-4 text-[15.5px] font-bold text-ink">{f.title}</h3>
              <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-muted">
                {f.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  light,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  light?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={false}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="max-w-[52ch]"
    >
      <span
        className={`text-[11px] font-bold uppercase tracking-[0.16em] ${
          light ? "text-white/55" : "text-accent"
        }`}
      >
        {eyebrow}
      </span>
      <h2
        className={`text-balance-pretty mt-3 font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] sm:text-[38px] ${
          light ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {lede && (
        <p
          className={`mt-4 max-w-[48ch] text-[15px] leading-relaxed ${
            light ? "text-white/60" : "text-muted"
          }`}
        >
          {lede}
        </p>
      )}
    </motion.div>
  );
}
