"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

/** Sayfanın uzunluğunu görünür ama dikkat dağıtmayan bir ilerleme çizgisiyle anlatır. */
export function ScrollProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 150,
    damping: 28,
    restDelta: 0.001,
  });

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-accent shadow-[0_0_18px_hsl(var(--accent)/0.7)]"
      style={{ scaleX }}
    />
  );
}
