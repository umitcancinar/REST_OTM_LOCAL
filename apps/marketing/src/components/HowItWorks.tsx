"use client";

import { motion, useReducedMotion } from "motion/react";
import { Download, KeyRound, Power, Smartphone } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";
import { EASE_OUT } from "@/lib/motion";

const STEPS = [
  {
    icon: Download,
    title: "Kurulum dosyasını çalıştırın",
    body: "Tek bir installer; Node, Git veya başka bir teknik kurulum gerekmez.",
  },
  {
    icon: KeyRound,
    title: "Lisans anahtarınızı girin",
    body: "Size verilen anahtar bilgisayarınıza bağlanır ve bir daha sorulmaz.",
  },
  {
    icon: Power,
    title: "Sistem kendiliğinden başlar",
    body: "Yerel sunucu ve yazıcı ajanı arka planda çalışır; pencere kapansa da durmaz.",
  },
  {
    icon: Smartphone,
    title: "Ekip aynı ağdan bağlanır",
    body: "Garson telefonları ve mutfak ekranı QR ile saniyeler içinde bağlanır.",
  },
];

export function HowItWorks() {
  const reduced = useReducedMotion();

  return (
    <section id="nasil-calisir" className="bg-surface-2 py-24 sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Nasıl Çalışır"
          title="Kuruluma başladıktan 10 dakika sonra sipariş alıyorsunuz"
          lede="Karmaşık bir sunucu yönetimi yok — kurulum sihirbazı geri kalanını halleder."
        />

        <div className="relative mt-16 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px bg-line lg:block"
          />
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={reduced ? undefined : { opacity: 0, y: 20 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45, ease: EASE_OUT, delay: i * 0.08 }}
              className="relative"
            >
              <div className="relative z-10 grid h-12 w-12 place-items-center rounded-full border border-accent bg-bg font-display text-[16px] font-semibold text-accent">
                {i + 1}
              </div>
              <div className="mt-5 flex items-center gap-2 text-ink">
                <s.icon size={17} strokeWidth={1.9} className="text-accent" />
                <h3 className="text-[14.5px] font-bold">{s.title}</h3>
              </div>
              <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-muted">
                {s.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
