// ==========================================
// Kalibrasyon Fisi — kendi kendini teshis eden cikti
// ==========================================
// Amaci: "ekranda gordugum kagitta cikmiyor" sikayetinde tahmin yurutmeyi
// bitirmek. Bu fis kagida KENDI beklenen olculerini basar; kullanici bir
// cetvelle olcup rakamlari karsilastirinca sorunun kaynagi dogrudan
// okunur hale gelir:
//
//   • Cetvel isaretleri gercek cetvelle TUTUYORSA  -> satir araligi dogru,
//     sorun satir araliginda degil (ust/alt bosluk ayarlarina bakilir).
//   • Isaretler ORANTILI olarak kayiyorsa (orn. "30 mm" yazan yer 42 mm'de)
//     -> yazici ESC 3 satir aralik komutunu yok sayiyor. Kayma orani
//     (42/30 = 1.41) dogrudan yaziciya ozel duzeltme katsayisini verir.
//   • En alttaki "SON SATIR" gorunmuyorsa -> kesim payi yetersiz, icerik
//     yazicinin icinde kaliyor (alt bosluk artirilmali).
//
// Fisin uzerindeki her sayi hesaplanmis degerdir; sabit metin degildir.

import {
  DOTS_PER_MM,
  LINE_HEIGHT_DOTS,
  PAPER_COLUMNS,
  RENDER_ENGINE_VERSION,
  type DocLine,
  type ReceiptDoc,
  type ReceiptInput,
  type ReceiptLayout,
} from './types';
import { cutClearanceMm } from './build';

/** Cetvelin kac satirda bir isaretlenecegi. 10 satir = 30 mm. */
const MARK_EVERY = 10;
/** Cetvelin toplam satir sayisi. */
const RULER_LINES = 40;

const MM_PER_LINE = LINE_HEIGHT_DOTS / DOTS_PER_MM; // 24 nokta = 3 mm

function line(text: string, extra: Partial<DocLine> = {}): DocLine {
  return { text, align: 'left', bold: false, scale: 1, source: 'spacer', ...extra };
}

/**
 * Kalibrasyon dokumanini uretir. Gercek fislerle ayni renderEscPos akisindan
 * gecer; yani burada dogru cikan bir olcu, gercek fiste de dogru cikar.
 */
export function buildCalibrationDoc(
  layout: ReceiptLayout,
  kind: ReceiptInput['kind'] = 'BILL',
): ReceiptDoc {
  const columns = PAPER_COLUMNS[layout.paperWidth];
  // Gercek fislerle AYNI kesim payi. Teshis araci, teshis ettigi seyden
  // farkli davranirsa yanlis sonuca goturur.
  const bottomMarginMm = cutClearanceMm(kind, layout.bottomMarginMm);
  const lines: DocLine[] = [];

  lines.push(line('KALIBRASYON FISI', { bold: true, align: 'center' }));
  lines.push(line('-'.repeat(columns)));
  lines.push(line(`Motor surumu : v${RENDER_ENGINE_VERSION}`));
  lines.push(line(`Kagit        : ${layout.paperWidth} mm / ${columns} sutun`));
  lines.push(line(`Satir yuks.  : ${MM_PER_LINE.toFixed(2)} mm (${LINE_HEIGHT_DOTS} nokta)`));
  lines.push(line('-'.repeat(columns)));
  lines.push(line('Asagidaki cetveli GERCEK bir cetvelle'));
  lines.push(line('olcun. Sifir isareti cetvelin basidir.'));
  lines.push(line('-'.repeat(columns)));

  // Cetvel buradan baslar; mm degerleri cetvelin ilk satirindan sayilir.
  for (let index = 0; index <= RULER_LINES; index += 1) {
    if (index % MARK_EVERY === 0) {
      const millimeters = Math.round(index * MM_PER_LINE);
      lines.push(line(`+---- ${millimeters} mm`, { bold: true }));
    } else {
      lines.push(line('|'));
    }
  }

  const rulerSpanMm = RULER_LINES * MM_PER_LINE;

  lines.push(line('-'.repeat(columns)));
  lines.push(line(`Cetvel boyu  : ${rulerSpanMm.toFixed(1)} mm`));
  lines.push(line(`Ust bosluk   : ${layout.topMarginMm} mm`));
  lines.push(line(`Alt bosluk   : ${layout.bottomMarginMm} mm`));
  lines.push(line(`Kesim payi   : ${bottomMarginMm} mm (${kind})`));
  lines.push(line('-'.repeat(columns)));
  lines.push(line('Cetvel tutuyorsa satir araligi DOGRU.'));
  lines.push(line('Orantili kayma varsa yazici ESC 3'));
  lines.push(line('komutunu yok sayiyor demektir.'));
  lines.push(line('-'.repeat(columns)));
  lines.push(line('SON SATIR — BUNU GORUYORSANIZ', { bold: true, align: 'center' }));
  lines.push(line('KESIM PAYI YETERLI', { bold: true, align: 'center' }));

  // Logo kasten basilmaz (`logo` alani bos birakilir): logo yuksekligi
  // cetvel olcumunu bozardi.
  return {
    columns,
    paperWidth: layout.paperWidth,
    topMarginMm: Math.max(0, layout.topMarginMm - layout.deviceTopTrimMm),
    bottomMarginMm,
    lines,
    strongBeep: false,
  };
}

/** Kalibrasyon fisinin cetvel araligi — testler ve loglar icin. */
export const CALIBRATION_INFO = {
  mmPerLine: MM_PER_LINE,
  markEvery: MARK_EVERY,
  rulerLines: RULER_LINES,
  rulerSpanMm: RULER_LINES * MM_PER_LINE,
};
