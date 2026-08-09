"use client";

import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";

export function ProblemBand() {
  const reduced = useReducedMotion();

  return (
    <section className="border-b border-line bg-surface py-20 sm:py-28">
      <div className="container-shell">
        <motion.p
          initial={false}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="text-balance-pretty mx-auto max-w-[26ch] text-center font-display text-[26px] font-semibold leading-[1.25] tracking-[-0.01em] text-ink sm:text-[32px]"
        >
          Bulut tabanlı bir POS&apos;un interneti giderse{" "}
          <span className="text-accent">kasanız da durur.</span>
        </motion.p>
        <motion.p
          initial={false}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.1 }}
          className="mx-auto mt-5 max-w-[52ch] text-center text-[15px] leading-relaxed text-muted"
        >
          REST_OTM&apos;de sipariş almak, mutfağa yazdırmak ve kasayı kapatmak hiçbir
          zaman internete muhtaç değildir — çünkü bu işlemlerin hiçbiri buluta
          gitmez. Bulut yalnızca lisansınızı doğrular ve ortak menünüzü günceller.
        </motion.p>
      </div>
    </section>
  );
}
