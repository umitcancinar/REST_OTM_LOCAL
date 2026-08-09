"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

export function FinalCta() {
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden bg-night py-24 text-white sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-30 blur-3xl"
        style={{
          background: "radial-gradient(circle, hsl(var(--accent) / 0.4), transparent 70%)",
        }}
      />
      <div className="container-shell flex flex-col items-center text-center">
        <motion.h2
          initial={false}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="text-balance-pretty max-w-[20ch] font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.015em] sm:text-[42px]"
        >
          Restoranınızı internetten <span className="text-accent">bağımsızlaştırın.</span>
        </motion.h2>
        <motion.p
          initial={false}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.08 }}
          className="mt-4 max-w-[44ch] text-[15px] text-white/60"
        >
          Kısa bir görüşmede sisteminizi birlikte inceleyelim.
        </motion.p>
        <motion.a
          initial={false}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.16 }}
          href="#demo"
          className="group mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[13.5px] font-bold text-night transition hover:bg-accent hover:text-white"
        >
          Demo Talep Et
          <ArrowUpRight
            size={16}
            strokeWidth={2.5}
            className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </motion.a>
      </div>
    </section>
  );
}
