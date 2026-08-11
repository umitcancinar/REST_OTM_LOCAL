const LINKS = [
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#nasil-calisir", label: "Nasıl Çalışır" },
  { href: "#paketler", label: "Paketler" },
  { href: "#guvenlik", label: "Güvenlik" },
  { href: "#sss", label: "SSS" },
];

export function Footer() {
  return (
    <footer className="bg-night text-white/50">
      <div className="container-shell flex flex-col gap-8 py-14 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-white">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-white/25 font-display text-[13px]">
              R
            </span>
            <strong className="font-display text-[15px] tracking-wide">REST_OTM</strong>
          </div>
          <p className="mt-3 max-w-[38ch] text-[12.5px] leading-relaxed">
            Yerel-öncelikli restoran otomasyonu. Operasyon sizde, biz yalnızca
            lisansınızı ve ortak menünüzü yönetiriz.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="border-t border-white/10 py-6">
        <p className="container-shell text-[11.5px]">
          © {new Date().getFullYear()} REST_OTM. Tüm hakları saklıdır.
        </p>
      </div>
    </footer>
  );
}
