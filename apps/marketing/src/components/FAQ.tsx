import { Plus } from "lucide-react";
import { SectionHeading } from "./FeatureGrid";

const QA = [
  { q: "İnternet kesilirse sistem çalışmaya devam eder mi?", a: "Evet. Sipariş alma, mutfağa yazdırma ve kasa kapatma tamamen yerel ağınızda çalışır. Lisansınız her saat başı buluta yoklama gönderir; bağlantı kesilse bile 7 gün boyunca sorunsuz çalışmaya devam edersiniz." },
  { q: "Verilerim nerede tutuluyor, kim erişebilir?", a: "Sipariş, müşteri, stok ve fatura verileriniz yalnızca kendi bilgisayarınızda tutulur. Bulut tarafı bu verilere hiçbir zaman erişmez — yalnızca lisans durumunuzu ve ortak menünüzü yönetir." },
  { q: "Mevcut termal yazıcılarımla çalışır mı?", a: "Ağa bağlanabilen (IP/Ethernet) standart ESC/POS termal yazıcılarla çalışır. Kurulum sırasında yazıcı IP adreslerinizi panelden tanımlarsınız." },
  { q: "Kurulum için teknik bilgi gerekiyor mu?", a: "Hayır. Tek bir kurulum dosyası çalıştırılır, lisans anahtarınızı girersiniz ve sistem kendiliğinden başlar. Sunucu, veritabanı gibi kavramlarla uğraşmanız gerekmez." },
  { q: "Lisansımı başka bir bilgisayara taşıyabilir miyim?", a: "Evet, ancak bunun için bizimle iletişime geçmeniz gerekir. Bu, çalıntı veya kopyalanmış bir kurulumun izinsiz kullanılmasını engellemek için bilinçli bir güvenlik adımıdır." },
  { q: "Birden fazla şubem varsa nasıl çalışır?", a: "Her şube kendi bilgisayarında, kendi lisansıyla bağımsız olarak çalışır. Şubeler arası merkezi raporlama yol haritamızda yer alıyor; mevcut durumu görüşmek için demo talebinde belirtebilirsiniz." },
];

export function FAQ() {
  return <section id="sss" className="bg-surface-2 py-24 sm:py-32"><div className="container-shell"><SectionHeading eyebrow="Sık Sorulan Sorular" title="Merak edilenler" /><div className="mt-12 border-t border-line">{QA.map((item) => <FaqRow key={item.q} {...item} />)}</div></div></section>;
}

function FaqRow({ q, a }: { q: string; a: string }) {
  return <details className="group border-b border-line"><summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left marker:content-none"><span className="text-[15px] font-semibold text-ink">{q}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-muted transition-transform duration-200 group-open:rotate-45"><Plus size={14} /></span></summary><p className="max-w-prose pb-6 text-[14px] leading-relaxed text-muted">{a}</p></details>;
}
