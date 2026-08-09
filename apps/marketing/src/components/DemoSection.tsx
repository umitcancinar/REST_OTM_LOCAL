"use client";

import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Loader2, Phone, Store, MapPin, User } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

type Status = "idle" | "loading" | "success" | "error";

export function DemoSection() {
  const reduced = useReducedMotion();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message ?? "Gönderilemedi. Lütfen tekrar deneyin.");
      }
      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Beklenmeyen bir hata oluştu.");
    }
  }

  return (
    <section id="demo" className="border-t border-line bg-bg py-24 sm:py-32">
      <div className="container-shell grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 18 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
            Demo Talep Et
          </span>
          <h2 className="text-balance-pretty mt-3 max-w-[18ch] font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink sm:text-[36px]">
            Restoranınız için birlikte bakalım
          </h2>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted">
            Formu doldurun, sizi arayıp restoranınızın ihtiyacına göre kısa bir
            gösterim planlayalım. Fiyatlandırma işletme büyüklüğüne göre değişir —
            görüşmede netleştiririz.
          </p>

          <ul className="mt-8 space-y-3 text-[13.5px] text-ink">
            {[
              "Kurulum ve ilk gösterim ekibimizle birlikte",
              "Mevcut yazıcı ve donanımınıza uygunluk kontrolü",
              "Sorularınıza doğrudan yanıt — aracı yok",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent" />
                {t}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 18 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}
          className="rounded-lg border border-line bg-surface p-6 shadow-[0_30px_70px_-40px_rgba(20,15,10,0.25)] sm:p-8"
        >
          {status === "success" ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 size={38} className="text-accent" />
              <h3 className="mt-4 text-[17px] font-bold text-ink">Talebiniz alındı</h3>
              <p className="mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-muted">
                En kısa sürede size dönüş yapacağız. Bu sırada aşağıdaki sık
                sorulan soruları inceleyebilirsiniz.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Field
                icon={User}
                label="Ad Soyad"
                name="name"
                autoComplete="name"
                required
              />
              <Field
                icon={Store}
                label="Restoran Adı"
                name="restaurant"
                autoComplete="organization"
                required
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  icon={Phone}
                  label="Telefon"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                />
                <Field icon={MapPin} label="Şehir" name="city" autoComplete="address-level2" />
              </div>

              <div>
                <label
                  htmlFor="message"
                  className="mb-1.5 block text-[12.5px] font-semibold text-ink"
                >
                  Not <span className="font-normal text-muted">(opsiyonel)</span>
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  className="w-full rounded-md border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-muted/70 focus:border-accent"
                  placeholder="Şube sayısı, kullandığınız mevcut sistem vb."
                />
              </div>

              {status === "error" && (
                <p className="text-[13px] font-medium text-red-600">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-night px-5 py-3.5 text-[13.5px] font-bold text-white transition hover:bg-accent disabled:cursor-wait disabled:opacity-70"
              >
                {status === "loading" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Gönderiliyor…
                  </>
                ) : (
                  "Demo Talep Et"
                )}
              </button>
              <p className="text-center text-[11.5px] text-muted">
                Bilgileriniz yalnızca sizinle iletişime geçmek için kullanılır.
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function Field({
  icon: Icon,
  label,
  name,
  type = "text",
  required,
  autoComplete,
}: {
  icon: typeof User;
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-[12.5px] font-semibold text-ink">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <div className="relative">
        <Icon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={name}
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          className="w-full rounded-md border border-line bg-bg py-2.5 pl-10 pr-3.5 text-[13.5px] text-ink outline-none transition placeholder:text-muted/70 focus:border-accent"
        />
      </div>
    </div>
  );
}
