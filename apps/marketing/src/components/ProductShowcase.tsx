import { ClipboardList, ChefHat, Receipt, Wifi } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";

const TABLE_STATUS: Record<number, "bos" | "dolu" | "hazir"> = {
  1: "dolu", 2: "bos", 3: "dolu", 4: "bos", 5: "hazir", 6: "bos",
  7: "dolu", 8: "bos", 9: "bos", 10: "dolu", 11: "bos", 12: "hazir",
};

const statusColor: Record<string, string> = {
  bos: "bg-white/[0.05] text-white/35 border-white/10",
  dolu: "bg-accent/20 text-accent border-accent/40",
  hazir: "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
};

function OrderPanel() {
  return (
    <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[1fr_1.3fr] sm:p-7">
      <div>
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">Masalar</p>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(TABLE_STATUS).map(([n, s]) => (
            <div key={n} className={`grid aspect-square place-items-center rounded-md border text-[12px] font-bold ${statusColor[s]}`}>
              {n}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">Masa 5 — Sipariş</p>
        <div className="space-y-2">
          {[["2x Adana Kebap", "PENDING"], ["1x Ayran", "READY"], ["3x Lavaş", "PENDING"]].map(([item, status], i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
              <span className="text-[12.5px] font-semibold text-white/85">{item}</span>
              <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase ${status === "READY" ? "bg-emerald-400/20 text-emerald-300" : "bg-accent/20 text-accent"}`}>
                {status === "READY" ? "hazır" : "hazırlanıyor"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KitchenPanel() {
  const cols = [
    { title: "Yeni", tickets: ["Masa 3 · 2x Izgara Köfte", "Masa 7 · 1x Karışık Izgara"] },
    { title: "Hazırlanıyor", tickets: ["Masa 5 · 3x Lavaş", "Masa 1 · 2x Adana Kebap"] },
    { title: "Hazır", tickets: ["Masa 5 · 1x Ayran"] },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3 sm:p-7">
      {cols.map((c) => (
        <div key={c.title}>
          <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">{c.title} · {c.tickets.length}</p>
          <div className="space-y-2">{c.tickets.map((t, i) => <div key={i} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] font-semibold text-white/80">{t}</div>)}</div>
        </div>
      ))}
    </div>
  );
}

function BillPanel() {
  const items = [["2x Adana Kebap", "740₺"], ["1x Ayran", "45₺"], ["3x Lavaş", "90₺"]];
  return (
    <div className="mx-auto max-w-[360px] p-5 sm:p-7">
      <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/40">Masa 5 — Adisyon</p>
      <div className="divide-y divide-white/10 rounded-md border border-white/10 bg-white/[0.04]">
        {items.map(([n, p], i) => <div key={i} className="flex items-center justify-between px-4 py-2.5 text-[12.5px]"><span className="text-white/80">{n}</span><span className="font-semibold text-white/60">{p}</span></div>)}
        <div className="flex items-center justify-between px-4 py-3"><span className="text-[13px] font-bold text-white">Toplam</span><span className="font-display text-[17px] font-semibold text-accent">875₺</span></div>
      </div>
      <div className="mt-4 w-full rounded-md bg-accent py-2.5 text-center text-[12.5px] font-bold text-white">Ödemeyi Al ve Fiş Yazdır</div>
    </div>
  );
}

export function ProductShowcase() {
  return (
    <section className="bg-night py-24 text-white sm:py-32">
      <div className="container-shell">
        <SectionHeading eyebrow="Ürün" light title="Arayüzden bir kesit" lede="Aşağıdaki paneller sistemin gerçek ekran akışını basitleştirilmiş biçimde gösterir." />
        {/* Native radios make this preview work even when client-side JavaScript is unavailable. */}
        <div className="showcase-tabs mt-12">
          <input defaultChecked className="showcase-tab-input" id="showcase-order" name="product-showcase" type="radio" />
          <input className="showcase-tab-input" id="showcase-kitchen" name="product-showcase" type="radio" />
          <input className="showcase-tab-input" id="showcase-bill" name="product-showcase" type="radio" />
          <div className="showcase-tab-list flex flex-wrap gap-2" role="tablist" aria-label="Ürün ekranları">
            <label className="showcase-tab-label showcase-tab-label--order" htmlFor="showcase-order" role="tab"><ClipboardList size={14} strokeWidth={2} /> Sipariş Ekranı</label>
            <label className="showcase-tab-label showcase-tab-label--kitchen" htmlFor="showcase-kitchen" role="tab"><ChefHat size={14} strokeWidth={2} /> Mutfak Ekranı</label>
            <label className="showcase-tab-label showcase-tab-label--bill" htmlFor="showcase-bill" role="tab"><Receipt size={14} strokeWidth={2} /> Adisyon & Kasa</label>
          </div>
          <div className="panel-shimmer showcase-shell mt-6 overflow-hidden rounded-lg border border-white/12 bg-night-2 shadow-[0_50px_100px_-50px_rgba(0,0,0,0.8)]">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3"><span className="h-2 w-2 rounded-full bg-white/20" /><span className="h-2 w-2 rounded-full bg-white/20" /><span className="h-2 w-2 rounded-full bg-white/20" /><span className="ml-2 text-[10px] font-semibold text-white/40">yerel sunucu · panel.restoranyonetim.com</span><span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300"><Wifi size={10} /> canlı</span></div>
            <div className="scroll-x-contain min-h-[280px]">
              <div className="showcase-panel showcase-panel--order"><OrderPanel /></div>
              <div className="showcase-panel showcase-panel--kitchen"><KitchenPanel /></div>
              <div className="showcase-panel showcase-panel--bill"><BillPanel /></div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[11.5px] text-white/35">Yukarıdaki veriler örnek amaçlıdır; gerçek arayüz kurulumunuzda kendi menü ve masa düzeninizle çalışır.</p>
      </div>
    </section>
  );
}
