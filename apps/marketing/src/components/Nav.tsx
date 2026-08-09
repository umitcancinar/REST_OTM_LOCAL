"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/lib/motion";

const LINKS = [
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#nasil-calisir", label: "Nasıl Çalışır" },
  { href: "#paketler", label: "Paketler" },
  { href: "#guvenlik", label: "Güvenlik" },
  { href: "#sss", label: "SSS" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          "transition-colors duration-300",
          scrolled || open
            ? "bg-night/90 backdrop-blur-md border-b border-white/10"
            : "bg-transparent border-b border-transparent"
        )}
      >
        <nav className="container-shell flex h-[76px] items-center justify-between text-white">
          <a href="#top" className="flex items-center gap-2.5" aria-label="REST_OTM anasayfa">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-white/30 font-display text-[15px]">
              R
            </span>
            <span className="flex flex-col leading-none">
              <strong className="font-display text-[16px] tracking-wide">REST_OTM</strong>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55">
                Yerel-öncelikli otomasyon
              </span>
            </span>
          </a>

          <div className="hidden items-center gap-9 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-[12.5px] font-semibold text-white/75 transition hover:text-white"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-5 md:flex">
            <a
              href="https://panel.restoranyonetim.com"
              className="text-[12.5px] font-semibold text-white/75 transition hover:text-white"
            >
              Giriş
            </a>
            <a
              href="#demo"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[12.5px] font-bold text-night transition hover:bg-accent hover:text-white"
            >
              Demo Talep Et
              <ArrowUpRight size={14} strokeWidth={2.5} />
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white md:hidden"
            aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
            aria-expanded={open}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8 }}
            transition={{ duration: reduced ? 0.01 : 0.22, ease: EASE_OUT }}
            className="border-b border-white/10 bg-night px-6 pb-8 pt-2 text-white md:hidden"
          >
            <div className="flex flex-col gap-1 pt-4">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="border-b border-white/10 py-3.5 text-[15px] font-semibold text-white/85"
                >
                  {l.label}
                </a>
              ))}
              <a
                href="https://panel.restoranyonetim.com"
                className="py-3.5 text-[15px] font-semibold text-white/85"
              >
                Giriş
              </a>
              <a
                href="#demo"
                onClick={() => setOpen(false)}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-4 py-3 text-[13px] font-bold text-night"
              >
                Demo Talep Et
                <ArrowUpRight size={14} strokeWidth={2.5} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
