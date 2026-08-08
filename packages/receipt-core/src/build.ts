// ==========================================
// Fis Dokuman Ureteci (TEK KAYNAK)
// ==========================================
// Hem admin onizlemesi hem print-agent bu fonksiyonu cagirir.
// Ciktisi, satir satir hazirlanmis (sarilmis + hizalanmis) bir ReceiptDoc'tur.
// Bu yuzden ekranda gorulen ile kagida basilan BIREBIR aynidir.

import {
  PAPER_COLUMNS,
  PRINTABLE_MM,
  type Align,
  type DocLine,
  type ElementKey,
  type ElementStyle,
  type ReceiptDoc,
  type ReceiptInput,
  type ReceiptItemInput,
  type ReceiptLayout,
} from './types';
import { fitText, hardWrap, itemColumns, padForAlign, scaledColumns, twoColumnLine, wrapText } from './text';

/** Yan bosluk ne kadar buyurse buyusun, en az bu kadar icerik sutunu kalmali. */
const MIN_CONTENT_COLUMNS = 16;

/**
 * TP850 tarzi termik yazicilarin GS V kesme komutu, NATIVE modda kendi
 * icine gomulu besleme mesafesini yok sayar. Kesimden once yeterli bosluk
 * beslenmezse son satirlar yazicinin icinde kalir/kesilir (fiziksel veri
 * kaybi). Bu yuzden "Kagit Alt Bosluk" ayari ne olursa olsun (kullanici
 * yanlislikla dusuk bir deger girse bile), kesimden once beslenen mesafe
 * bu donanimsal asgari degerin altina hicbir zaman dusurulmez.
 *
 * Bu ayni zamanda bir sonraki fisin basinda gorunen bosluga da katkida
 * bulunur (kagit tek parca aktigi icin bu fisin kesim payi, siradaki fisin
 * onunde sarkan bos kagit olarak cikar). Bu yuzden deger, GUVENLI OLAN EN
 * KUCUK sayidir — fazladan pay eklemek sadece bir sonraki fisin basinda
 * gereksiz bosluk yaratir. Degerler eski (v1, kanitlanmis calisan)
 * escpos.ts'teki TP850_CUT_FEED_DOTS (180 nokta = 22.5 mm, BILL icin) ve
 * TP850_CUT_FEED_DOTS + STATION_CUT_EXTRA_DOTS + feed(4) toplaminin (~47.5 mm,
 * STATION icin — bicagi baski kafasindan daha uzak istasyon yazicilari)
 * birebir aynisidir; layout.ts'teki SEEDS.bottomMarginMm ile de tutarlidir.
 *
 * Bu deger yalnizca bir GUVENLIK TABANIDIR: kullanicinin tasarimda verdigi
 * alt bosluk bunun altina duserse icerik kesilmesin diye vardir, tasarimi
 * ezmek icin degil. Fisin kagitta beklenenden uzun cikmasi bu sabitlerle
 * telafi EDILMEZ — o sorunun kaynagi satir araligidir ve escpos.ts icinde
 * `ESC 3` ile cozulur (bkz. o dosyanin basindaki 1. kural).
 *
 * SAHA OLCUMU (kalibrasyon fisi, 4 mm alt bosluk ile): son 5 satir (15 mm)
 * yazicinin icinde kaldi, 4 mm beslenmisti -> kafa-bicak mesafesi ~19 mm.
 * 22.5 mm bu mesafeyi ~3.5 mm payla asiyor.
 */
const MIN_CUT_CLEARANCE_MM: Record<ReceiptInput['kind'], number> = {
  BILL: 22.5,
  STATION: 47.5,
};

/**
 * Kullanicinin verdigi alt boslugu donanimsal guvenlik tabaniyla birlestirir.
 * Kalibrasyon fisi de bunu kullanir: teshis araci, teshis ettigi seyden farkli
 * davranirsa yaniltir.
 */
export function cutClearanceMm(kind: ReceiptInput['kind'], bottomMarginMm: number): number {
  return Math.max(bottomMarginMm, MIN_CUT_CLEARANCE_MM[kind]);
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'NAKİT',
  CARD: 'KREDİ KARTI',
  IBAN: 'HAVALE/IBAN',
  YEMEK_SEPETI: 'YEMEK SEPETİ',
  TRENDYOL_GO: 'TRENDYOL GO',
  GETIR: 'GETİR',
};

const PAYMENT_ROW_LABELS: Record<string, string> = {
  CASH: 'Nakit Ödeme',
  CARD: 'Kredi Kartı',
  IBAN: 'Havale/EFT',
  YEMEK_SEPETI: 'Yemek Sepeti',
  TRENDYOL_GO: 'Trendyol Go',
  GETIR: 'Getir',
};

function money(amount: number, currency: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${value.toFixed(2)} ${currency}`.trim();
}

class DocWriter {
  readonly lines: DocLine[] = [];

  constructor(private readonly columns: number, private readonly layout: ReceiptLayout) {}

  private styleOf(key: ElementKey): ElementStyle {
    return this.layout.elements[key];
  }

  visible(key: ElementKey): boolean {
    return this.styleOf(key).visible;
  }

  /** Ogeye ait metin override'i varsa onu, yoksa varsayilani dondurur. */
  labelFor(key: ElementKey, fallback: string): string {
    const override = this.styleOf(key).text;
    return override && override.trim() ? override : fallback;
  }

  width(key: ElementKey): number {
    return scaledColumns(this.columns, this.styleOf(key).scale);
  }

  /** Metni ogenin olcegine gore sarar ve satir satir ekler. */
  write(key: ElementKey, value: string): void {
    const style = this.styleOf(key);
    if (!style.visible) return;
    for (const line of wrapText(value, this.width(key))) {
      this.lines.push({ text: line, align: style.align, bold: style.bold, scale: style.scale, source: key });
    }
  }

  /** Bosluklari koruyarak yazar (etiketli meta satirlari icin). */
  writeLine(key: ElementKey, value: string): void {
    const style = this.styleOf(key);
    if (!style.visible) return;
    for (const line of hardWrap(value, this.width(key))) {
      this.lines.push({ text: line, align: style.align, bold: style.bold, scale: style.scale, source: key });
    }
  }

  /** Zaten sutunlanmis (padding'li) bir satiri oldugu gibi ekler. */
  writeRaw(key: ElementKey, value: string): void {
    const style = this.styleOf(key);
    if (!style.visible) return;
    this.lines.push({ text: value, align: style.align, bold: style.bold, scale: style.scale, source: key });
  }

  separator(char?: string): void {
    const symbol = (char || this.layout.separatorChar || '-').slice(0, 1);
    this.lines.push({
      text: symbol.repeat(this.columns),
      align: 'left',
      bold: false,
      scale: 1,
      source: 'separator',
    });
  }

  blank(count = 1): void {
    for (let index = 0; index < count; index += 1) {
      this.lines.push({ text: '', align: 'left', bold: false, scale: 1, source: 'spacer' });
    }
  }
}

function itemDisplayName(item: ReceiptItemInput, treatTag: string): string {
  let name = String(item.name || '').toUpperCase();
  if (item.isTreat || (item.notes && item.notes.includes('[İKRAM]'))) name += ` ${treatTag}`;
  if (item.portionOption && item.portionOption !== 'Normal') name += ` (${item.portionOption})`;
  return name.trim();
}

function writeItems(
  writer: DocWriter,
  items: ReceiptItemInput[],
  layout: ReceiptLayout,
  columns: number,
  showPrices: boolean,
): void {
  const itemStyle = layout.elements.item;
  const width = scaledColumns(columns, itemStyle.scale);

  for (const item of items) {
    const name = itemDisplayName(item, layout.labels.treatTag);
    const quantity = String(item.quantity ?? 0);
    const unit = Number(item.price ?? 0);
    const lineTotal = unit * Number(item.quantity ?? 0);
    const priceText = showPrices && item.price !== undefined && item.price !== null
      ? money(lineTotal, layout.labels.currency)
      : '';

    if (itemStyle.scale === 1) {
      writer.writeRaw('item', itemColumns(
        name,
        quantity,
        priceText,
        columns,
        layout.qtyWidth,
        showPrices ? layout.priceWidth : 0,
      ));
    } else {
      for (const line of wrapText(`${quantity}x ${name}`, width)) {
        writer.writeRaw('item', line);
      }
      if (priceText) {
        writer.lines.push({
          text: fitText(priceText, width),
          align: 'right',
          bold: itemStyle.bold,
          scale: itemStyle.scale,
          source: 'item',
        });
      }
    }

    const note = item.notes && !item.notes.includes('[İKRAM]') ? item.notes : '';
    if (note && writer.visible('itemNote')) {
      writer.write('itemNote', `${layout.labels.note} ${note}`);
    }
    if (layout.showItemSeparator) writer.separator(layout.itemSeparatorChar);
  }
}

/**
 * Fisin tamamini satir modeline cevirir.
 * `kind` yalnizca varsayilan basligi ve odeme bloklarinin gosterimini etkiler.
 */
export function buildReceiptDoc(input: ReceiptInput): ReceiptDoc {
  const layout = input.layout;
  const totalColumns = PAPER_COLUMNS[layout.paperWidth];
  const mmPerChar = PRINTABLE_MM[layout.paperWidth] / totalColumns;
  const maxMarginChars = Math.max(0, Math.floor((totalColumns - MIN_CONTENT_COLUMNS) / 2));
  const sideMarginChars = Math.max(0, Math.min(maxMarginChars, Math.round((layout.sideMarginMm || 0) / mmPerChar)));
  const columns = totalColumns - sideMarginChars * 2;
  const writer = new DocWriter(columns, layout);
  const showPrices = !layout.hidePrices;
  const isTakeaway = !input.tableNumber;

  // ---- Logo -------------------------------------------------------------
  const logo = layout.elements.logo.visible && layout.logoUrl
    ? { url: layout.logoUrl, widthMm: layout.logoWidth, align: layout.logoPosition }
    : undefined;

  // ---- Baslik blogu -----------------------------------------------------
  if (layout.headerText) writer.write('header', layout.headerText);
  if (layout.subHeaderText) writer.write('subHeader', layout.subHeaderText);
  writer.separator();

  if (input.isCancel) {
    writer.write('cancelTitle', writer.labelFor('cancelTitle', layout.labels.cancelTitle).toUpperCase());
  } else if (input.isTreat) {
    writer.write('treatTitle', writer.labelFor('treatTitle', layout.labels.treatTitle).toUpperCase());
  } else {
    writer.write('title', writer.labelFor('title', layout.receiptTitle).toUpperCase());
  }
  writer.separator();

  // ---- Musteri (paket) --------------------------------------------------
  if (input.customer && writer.visible('customer')) {
    writer.write('customer', `${layout.labels.customer} ${input.customer.name}`);
    if (input.customer.phone) writer.write('customer', `${layout.labels.phone} ${input.customer.phone}`);
    if (input.customer.address) writer.write('customer', `${layout.labels.address} ${input.customer.address}`);
    writer.separator(layout.itemSeparatorChar);
  }

  // ---- Siparis notu -----------------------------------------------------
  if (input.notes) {
    writer.write('orderNote', `${layout.labels.orderNote} ${input.notes}`);
    writer.separator(layout.itemSeparatorChar);
  }

  // ---- Tarih / Masa -----------------------------------------------------
  const date = input.timestamp.toLocaleDateString('tr-TR');
  const time = input.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const tableText = isTakeaway
    ? layout.labels.takeaway
    : `${layout.labels.tableInline} ${input.tableNumber}`;
  const tableBlockText = isTakeaway
    ? layout.labels.takeaway
    : `${layout.labels.tableBlock} ${input.tableNumber}`;
  const tableStyle = layout.elements.table;

  if (layout.inlineDateMasa && tableStyle.scale === 1 && writer.visible('dateTime') && tableStyle.visible) {
    // Ayni satirda: sol tarafta tarih+saat, sagda masa.
    writer.writeRaw('dateTime', twoColumnLine(`${date} ${time}`, tableText, columns));
  } else {
    if (writer.visible('dateTime')) {
      if (layout.inlineDateMasa) {
        writer.writeLine('dateTime', `${date} ${time}`);
      } else {
        writer.writeLine('dateTime', `${layout.labels.dateBlock} ${date}`);
        writer.writeLine('dateTime', `${layout.labels.timeBlock} ${time}`);
      }
    }
    writer.writeLine('table', layout.inlineDateMasa ? tableText : tableBlockText);
  }

  writer.writeLine('orderNo', `${layout.labels.orderNo}${input.orderNumber}`);
  if (input.waiterName) writer.writeLine('waiter', `${layout.labels.waiter} ${input.waiterName}`);
  writer.separator();

  // ---- Sutun basliklari -------------------------------------------------
  if (layout.elements.item.scale === 1 && writer.visible('columnsHeader')) {
    writer.writeRaw('columnsHeader', itemColumns(
      layout.labels.colProduct,
      layout.labels.colQty,
      layout.labels.colAmount,
      columns,
      layout.qtyWidth,
      showPrices ? layout.priceWidth : 0,
    ));
    writer.separator();
  }

  // ---- Urunler ----------------------------------------------------------
  const activeItems = layout.showPaidItems
    ? input.items.filter((item) => !item.isPaid)
    : input.items;
  writeItems(writer, activeItems, layout, columns, showPrices);

  // ---- Toplam / odeme ---------------------------------------------------
  if (showPrices) {
    const totalAmount = input.isCancel || input.isTreat
      ? 0
      : (input.total !== undefined
        ? Number(input.total)
        : input.items.reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0));

    if (writer.visible('total')) {
      writer.writeRaw('total', twoColumnLine(
        writer.labelFor('total', layout.labels.total),
        money(totalAmount, layout.labels.currency),
        writer.width('total'),
      ));
    }

    if (input.paymentMethod && writer.visible('paymentMethod')) {
      writer.separator();
      const label = PAYMENT_LABELS[input.paymentMethod] || input.paymentMethod;
      writer.write('paymentMethod', label);
    }

    if (input.payments && input.payments.length > 0 && writer.visible('payments')) {
      writer.separator();
      writer.write('payments', writer.labelFor('payments', layout.labels.payments));
      let paid = 0;
      for (const payment of input.payments) {
        const label = PAYMENT_ROW_LABELS[payment.method] || payment.method;
        writer.writeRaw('payments', twoColumnLine(
          label,
          money(Number(payment.amount), layout.labels.currency),
          writer.width('payments'),
        ));
        paid += Number(payment.amount) || 0;
      }
      if (writer.visible('remaining')) {
        writer.separator();
        writer.writeRaw('remaining', twoColumnLine(
          writer.labelFor('remaining', layout.labels.remaining),
          money(totalAmount - paid, layout.labels.currency),
          writer.width('remaining'),
        ));
      }
    }
  }

  // ---- Odenen urunler (altta) ------------------------------------------
  const paidItems = input.items.filter((item) => item.isPaid);
  if (layout.showPaidItems && paidItems.length > 0 && writer.visible('paidItems')) {
    writer.separator();
    writer.write('paidItems', writer.labelFor('paidItems', layout.labels.paidItems));
    for (const item of paidItems) {
      writer.writeRaw('paidItems', itemColumns(
        itemDisplayName(item, layout.labels.treatTag),
        String(item.quantity ?? 0),
        showPrices ? money(Number(item.price ?? 0) * Number(item.quantity ?? 0), layout.labels.currency) : '',
        writer.width('paidItems'),
        layout.qtyWidth,
        showPrices ? layout.priceWidth : 0,
      ));
    }
  }

  writer.separator();
  if (layout.footerText) writer.write('footer', layout.footerText);

  // ---- Yan bosluk -------------------------------------------------------
  // Satirlar zaten `columns` (yan bosluk dusulmus) genislige gore
  // hizalanmis/sarilmis durumda. Burada hizalamayi (align) manuel olarak
  // metne gomup satirin basina bosluk ekliyoruz; boylece hem ekran onizlemesi
  // hem yazici (artik hep 'left' gonderiliyor) BIREBIR ayni cikti uretir.
  // Yan bosluk 0 ise (varsayilan) satirlar hic dokunulmadan gecer.
  const lines = sideMarginChars > 0
    ? writer.lines.map((line): DocLine => {
      const scaledCols = scaledColumns(columns, line.scale);
      const prefixChars = Math.max(0, Math.round(sideMarginChars / line.scale));
      const justified = padForAlign(line.text, scaledCols, line.align);
      return { ...line, text: ' '.repeat(prefixChars) + justified, align: 'left' as Align };
    })
    : writer.lines;

  return {
    columns: totalColumns,
    paperWidth: layout.paperWidth,
    topMarginMm: Math.max(0, layout.topMarginMm - layout.deviceTopTrimMm),
    bottomMarginMm: cutClearanceMm(input.kind, layout.bottomMarginMm),
    logo,
    lines,
    strongBeep: Boolean(input.isCancel),
  };
}
