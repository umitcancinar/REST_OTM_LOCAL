"use client";

import { motion, useReducedMotion } from "motion/react";
import { KeyRound, Fingerprint, ShieldAlert, Lock } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";
import { EASE_OUT } from "@/lib/motion";

const ITEMS = [
  {
    icon: KeyRound,
    title: "Ed25519 imzalı lisans",
    body: "Lisanslar özel bir anahtarla imzalanır; bu anahtar yalnızca bizim sunucumuzda bulunur. Bitiş tarihi elle değiştirilse dahi imza tutmaz ve sistem reddeder.",
  },
  {
    icon: Fingerprint,
    title: "Cihaza bağlı çalışma",
    body: "Bir lisans yalnızca aktive edildiği bilgisayarda geçerlidir. Kopyalanan bir kurulum dosyası başka bir cihazda çalışmaz.",
  },
  {
    icon: Lock,
    title: "Şifreli yedekleme",
    body: "Otomatik yedekler şifrelenerek alınır, ayrı bir konuma kopyalanır ve düzenli olarak geri yükleme testinden geçirilir.",
  },
  {
    icon: ShieldAlert,
    title: "Kurcalama tespiti",
    body: "Saat geri alma, çalıntı oturum tekrar kullanımı ve sahte lisans denemeleri otomatik olarak tespit edilip kayıt altına alınır.",
  },
];

export function SecuritySection() {
  const reduced = useReducedMotion();

  return (
    <section id="guvenlik" className="bg-bg py-24 sm:py-32">
      <div className="container-shell">
        <SectionHeading
          eyebrow="Güvenlik"
          title="Güvenlik bir eklenti değil, mimarinin kendisi"
        />

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item.title}
              initial={reduced ? undefined : { opacity: 0, y: 16 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: i * 0.06 }}
              className="bg-surface p-6"
            >
              <item.icon size={19} strokeWidth={1.8} className="text-accent" />
              <h3 className="mt-4 text-[14.5px] font-bold text-ink">{item.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{item.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
