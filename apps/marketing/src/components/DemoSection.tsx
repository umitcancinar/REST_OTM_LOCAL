import { CheckCircle2, MailCheck, MapPin, Phone, ShieldCheck, Store, User } from "lucide-react";
import { VerificationCodeForm } from "./VerificationCodeForm";

type DemoStage = "form" | "verify" | "success" | "error";

export function DemoSection({ stage = "form", message }: { stage?: DemoStage; message?: string }) {
  return (
    <section id="demo" className="border-t border-line bg-bg py-24 sm:py-32">
      <div className="container-shell grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Demo Talep Et</span>
          <h2 className="text-balance-pretty mt-3 max-w-[18ch] font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink sm:text-[36px]">Restoranınız için birlikte bakalım</h2>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted">Formu doldurun, e-posta adresinizi doğrulayın; size restoranınızın ihtiyacına göre kısa bir gösterim planlayalım.</p>
          <ul className="mt-8 space-y-3 text-[13.5px] text-ink">
            {["Kurulum ve ilk gösterim ekibimizle birlikte", "Mevcut yazıcı ve donanımınıza uygunluk kontrolü", "Sorularınıza doğrudan yanıt — aracı yok"].map((t) => <li key={t} className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent" />{t}</li>)}
          </ul>
        </div>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-[0_30px_70px_-40px_rgba(20,15,10,0.25)] sm:p-8">
          {stage === "verify" ? <VerifyForm error={message} /> : stage === "success" ? <Success /> : <RequestForm error={stage === "error" ? message : undefined} />}
        </div>
      </div>
    </section>
  );
}

function RequestForm({ error }: { error?: string }) {
  return <form action="/api/demo-request" method="post" className="space-y-4">
    <Field icon={User} label="Ad Soyad" name="name" autoComplete="name" required />
    <Field icon={Store} label="Restoran Adı" name="restaurant" autoComplete="organization" required />
    <Field icon={MailCheck} label="İş E-postası" name="email" type="email" autoComplete="email" required />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field icon={Phone} label="Telefon" name="phone" type="tel" autoComplete="tel" required /><Field icon={MapPin} label="Şehir" name="city" autoComplete="address-level2" /></div>
    <div><label htmlFor="message" className="mb-1.5 block text-[12.5px] font-semibold text-ink">Not <span className="font-normal text-muted">(opsiyonel)</span></label><textarea id="message" name="message" rows={3} className="w-full rounded-md border border-line bg-bg px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition placeholder:text-muted/70 focus:border-accent" placeholder="Şube sayısı, kullandığınız mevcut sistem vb." /></div>
    {error && <p className="text-[13px] font-medium text-red-600">{error}</p>}
    <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-full bg-night px-5 py-3.5 text-[13.5px] font-bold text-white transition hover:bg-accent">E-postama doğrulama kodu gönder</button>
    <p className="text-center text-[11.5px] text-muted">Talep, yalnızca e-posta doğrulamasından sonra açılır.</p>
  </form>;
}

function VerifyForm({ error }: { error?: string }) {
  return <div className="verification-card"><div className="verification-orbit" aria-hidden /><div className="relative z-10"><span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent"><MailCheck size={22} /></span><p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Bir adım kaldı</p><h3 className="mt-2 font-display text-[28px] font-semibold leading-tight text-ink">E-postanı doğrula</h3><p className="mt-3 max-w-[37ch] text-[14px] leading-relaxed text-muted">Adresine 6 haneli güvenli bir kod gönderdik. Kod 10 dakika geçerlidir.</p><VerificationCodeForm error={error} /><form action="/api/demo-request" method="get" className="mt-4 text-center"><button className="text-[12px] font-semibold text-muted underline decoration-muted/40 underline-offset-4 hover:text-ink">Farklı bir e-posta adresi kullan</button></form><p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted"><ShieldCheck size={13} className="text-accent" /> Tek kullanımlık kod · şifre saklanmaz</p></div></div>;
}

function Success() {
  return <div className="flex flex-col items-center py-10 text-center"><CheckCircle2 size={42} className="text-accent" /><h3 className="mt-4 text-[18px] font-bold text-ink">Talebiniz alındı</h3><p className="mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-muted">E-posta adresiniz doğrulandı. Ekibimiz talebinizdeki bilgilerle birlikte haberdar edildi; en kısa sürede size dönüş yapacağız.</p></div>;
}

function Field({ icon: Icon, label, name, type = "text", required, autoComplete }: { icon: typeof User; label: string; name: string; type?: string; required?: boolean; autoComplete?: string }) {
  return <div><label htmlFor={name} className="mb-1.5 block text-[12.5px] font-semibold text-ink">{label} {required && <span className="text-accent">*</span>}</label><div className="relative"><Icon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" /><input id={name} name={name} type={type} required={required} autoComplete={autoComplete} className="w-full rounded-md border border-line bg-bg py-2.5 pl-10 pr-3.5 text-[13.5px] text-ink outline-none transition placeholder:text-muted/70 focus:border-accent" /></div></div>;
}
