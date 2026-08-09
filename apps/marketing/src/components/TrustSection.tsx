"use client";

import { motion, useReducedMotion } from "motion/react";
import { UtensilsCrossed, Handshake, MessageCircle } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

const POINTS = [
  {
    icon: UtensilsCrossed,
    title: "Sahada geliştiriyoruz",
    body: "Sistemi seçili restoranların gerçek servis temposunda test ediyor, geri bildirimlerine göre haftalık güncelliyoruz.",
  },
  {
    icon: Handshake,
    title: "Kurulumda yanınızdayız",
    body: "İlk kurulum ve gösterim ekibimizle birlikte yapılır; yazıcı ve donanım uyumluluğunu önceden kontrol ederiz.",
  },
  {
    icon: MessageCircle,
    title: "Doğrudan iletişim",
    body: "Destek talebiniz aracı bir çağrı merkezine değil, sistemi geliştiren ekibe ulaşır.",
  },
];

export function TrustSection() {
  const reduced = useReducedMotion();

  return (
    <section id="referanslar" className="border-y border-line bg-bg py-20 sm:py-24">
      <div className="container-shell">
        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 16 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="max-w-[54ch]"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
            Neden REST_OTM
          </span>
          <h2 className="text-balance-pretty mt-3 font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink sm:text-[30px]">
            Erken aşamadayız — ve bunu bilerek söylüyoruz
          </h2>
          <p className="mt-4 text-[14.5px] leading-relaxed text-muted">
            Elimizde yüzlerce müşteri yorumu yok; bunun yerine gerçek bir restoranla,
            gerçek servis saatlerinde birlikte çalışıyoruz. Bu size ne fayda sağlar:
            sorununuz sıraya girmez, doğrudan geliştiren ekibe ulaşır.
          </p>
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {POINTS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={reduced ? undefined : { opacity: 0, y: 16 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: i * 0.07 }}
              className="rounded-lg border border-line bg-surface p-6"
            >
              <p.icon size={18} strokeWidth={1.8} className="text-accent" />
              <h3 className="mt-3.5 text-[14px] font-bold text-ink">{p.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
