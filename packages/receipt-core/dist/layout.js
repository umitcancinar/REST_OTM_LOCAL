"use strict";
// ==========================================
// Layout varsayilanlari + normalizasyon
// ==========================================
// Kaydedilmis eski ayarlar (hideLogo, boldItems, doubleSizeItems ...) yeni
// oge tabanli semaya OTOMATIK cevrilir. Boylece mevcut isletmelerin
// tasarimlari bozulmadan calismaya devam eder.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LABELS = exports.MAX_SIDE_MARGIN_MM = exports.MAX_BOTTOM_MARGIN_MM = exports.MAX_TOP_MARGIN_MM = exports.PRINT_LAYOUT_KEYS = void 0;
exports.defaultLayout = defaultLayout;
exports.normalizeLayout = normalizeLayout;
exports.normalizeAllLayouts = normalizeAllLayouts;
const types_1 = require("./types");
exports.PRINT_LAYOUT_KEYS = ['CASHIER', 'KITCHEN', 'GRILL', 'PAKET'];
exports.MAX_TOP_MARGIN_MM = 60;
exports.MAX_BOTTOM_MARGIN_MM = 80;
exports.MAX_SIDE_MARGIN_MM = 20;
exports.DEFAULT_LABELS = {
    cancelTitle: '!!! İPTAL FİŞİ !!!',
    treatTitle: '*** İKRAM FİŞİ ***',
    takeaway: 'PAKET',
    tableInline: 'MASA:',
    tableBlock: 'Masa  :',
    dateBlock: 'Tarih :',
    timeBlock: 'Saat  :',
    orderNo: 'Fiş No: #',
    waiter: 'Garson:',
    colProduct: 'ÜRÜN',
    colQty: 'ADET',
    colAmount: 'TUTAR',
    total: 'TOPLAM',
    remaining: 'KALAN',
    payments: 'TAHSİLATLAR:',
    paidItems: 'ÖDENEN ÜRÜNLER',
    note: '!! NOT:',
    treatTag: '[İKRAM]',
    customer: 'Müşteri:',
    phone: 'Telefon:',
    address: 'Adres:',
    orderNote: 'SİPARİŞ NOTU:',
    currency: 'TL',
};
function style(visible, bold, align, scale) {
    return { visible, bold, align, scale };
}
const BASE_ELEMENTS = {
    logo: style(true, false, 'center', 1),
    header: style(true, true, 'center', 2),
    subHeader: style(true, true, 'center', 1),
    title: style(true, true, 'center', 2),
    customer: style(true, true, 'left', 1),
    orderNote: style(true, true, 'left', 1),
    dateTime: style(true, false, 'left', 1),
    table: style(true, true, 'left', 1),
    orderNo: style(true, true, 'left', 1),
    waiter: style(true, false, 'left', 1),
    columnsHeader: style(true, false, 'left', 1),
    item: style(true, false, 'left', 1),
    itemNote: style(true, true, 'left', 1),
    total: style(true, true, 'left', 2),
    paymentMethod: style(true, true, 'center', 2),
    payments: style(true, false, 'left', 1),
    remaining: style(true, true, 'left', 2),
    paidItems: style(false, false, 'left', 1),
    cancelTitle: style(true, true, 'center', 4),
    treatTitle: style(true, true, 'center', 2),
    footer: style(true, true, 'center', 1),
};
function elementsFor(key) {
    const result = {};
    for (const elementKey of types_1.ELEMENT_KEYS) {
        result[elementKey] = { ...BASE_ELEMENTS[elementKey] };
    }
    if (key === 'KITCHEN' || key === 'GRILL') {
        result.item = { ...result.item, bold: true };
        result.header = { ...result.header, visible: false };
        result.logo = { ...result.logo, visible: false };
    }
    return result;
}
const SEEDS = {
    KITCHEN: { receiptTitle: 'FIRIN FİŞİ', footerText: 'AFİYET OLSUN', headerText: '', hidePrices: true, bottomMarginMm: 47.5, deviceTopTrimMm: 0 },
    GRILL: { receiptTitle: 'IZGARA FİŞİ', footerText: 'AFİYET OLSUN', headerText: '', hidePrices: true, bottomMarginMm: 47.5, deviceTopTrimMm: 5 },
    CASHIER: { receiptTitle: 'ADİSYON', footerText: 'AFİYET OLSUN, YİNE BEKLERİZ', headerText: '', hidePrices: false, bottomMarginMm: 22.5, deviceTopTrimMm: 0 },
    PAKET: { receiptTitle: 'PAKET SİPARİŞ', footerText: 'AFİYET OLSUN, YİNE BEKLERİZ', headerText: '', hidePrices: false, bottomMarginMm: 22.5, deviceTopTrimMm: 0 },
};
function defaultLayout(key) {
    const seed = SEEDS[key];
    return {
        paperWidth: 80,
        topMarginMm: 0,
        bottomMarginMm: seed.bottomMarginMm,
        deviceTopTrimMm: seed.deviceTopTrimMm,
        sideMarginMm: 0,
        logoUrl: '',
        logoWidth: 50,
        logoPosition: 'center',
        headerText: seed.headerText,
        subHeaderText: '',
        receiptTitle: seed.receiptTitle,
        footerText: seed.footerText,
        separatorChar: '-',
        itemSeparatorChar: '.',
        showItemSeparator: true,
        qtyWidth: 5,
        priceWidth: 12,
        inlineDateMasa: false,
        hidePrices: seed.hidePrices,
        showPaidItems: false,
        elements: elementsFor(key),
        labels: { ...exports.DEFAULT_LABELS },
    };
}
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');
function text(value, fallback, maxLength) {
    if (typeof value !== 'string')
        return fallback;
    return value.replace(CONTROL_CHARS, '').slice(0, maxLength);
}
function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function num(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.min(max, Math.max(min, parsed));
}
function scaleOf(value, fallback) {
    const parsed = Math.round(Number(value));
    return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 ? parsed : fallback;
}
function alignOf(value, fallback) {
    return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
}
function normalizeElement(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = {
        visible: bool(source.visible, fallback.visible),
        bold: bool(source.bold, fallback.bold),
        align: alignOf(source.align, fallback.align),
        scale: scaleOf(source.scale, fallback.scale),
    };
    if (typeof source.text === 'string')
        result.text = text(source.text, '', 160);
    return result;
}
/**
 * Kaydedilmis (muhtemelen eski surum) bir layout nesnesini tam ve guvenli
 * bir ReceiptLayout'a cevirir. Eksik alanlar varsayilanla doldurulur.
 */
function normalizeLayout(raw, key, restaurantName = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const base = defaultLayout(key);
    const paperWidth = source.paperWidth === 58 ? 58 : 80;
    const fallbackHeader = key === 'CASHIER' || key === 'PAKET' ? restaurantName : '';
    // ---- Eski (v1) bayraklarini yeni semaya cevir --------------------------
    const legacy = {
        hideLogo: typeof source.hideLogo === 'boolean' ? source.hideLogo : undefined,
        hideHeader: typeof source.hideHeader === 'boolean' ? source.hideHeader : undefined,
        boldItems: typeof source.boldItems === 'boolean' ? source.boldItems : undefined,
        doubleSizeItems: typeof source.doubleSizeItems === 'boolean' ? source.doubleSizeItems : undefined,
        doubleSizeTable: typeof source.doubleSizeTable === 'boolean' ? source.doubleSizeTable : undefined,
    };
    const savedElements = source.elements && typeof source.elements === 'object'
        ? source.elements
        : {};
    const elements = {};
    for (const elementKey of types_1.ELEMENT_KEYS) {
        let fallback = base.elements[elementKey];
        if (elementKey === 'logo' && legacy.hideLogo !== undefined) {
            fallback = { ...fallback, visible: !legacy.hideLogo };
        }
        if (elementKey === 'header' && legacy.hideHeader !== undefined) {
            fallback = { ...fallback, visible: !legacy.hideHeader };
        }
        if (elementKey === 'item') {
            if (legacy.boldItems !== undefined)
                fallback = { ...fallback, bold: legacy.boldItems };
            if (legacy.doubleSizeItems !== undefined) {
                fallback = { ...fallback, scale: legacy.doubleSizeItems ? 2 : 1 };
            }
        }
        if (elementKey === 'table' && legacy.doubleSizeTable !== undefined) {
            fallback = { ...fallback, scale: legacy.doubleSizeTable ? 2 : 1, bold: legacy.doubleSizeTable };
        }
        elements[elementKey] = normalizeElement(savedElements[elementKey], fallback);
    }
    const savedLabels = source.labels && typeof source.labels === 'object'
        ? source.labels
        : {};
    const labels = { ...base.labels };
    for (const labelKey of Object.keys(base.labels)) {
        labels[labelKey] = text(savedLabels[labelKey], base.labels[labelKey], 80);
    }
    const headerText = text(source.headerText, fallbackHeader, 80);
    return {
        paperWidth,
        topMarginMm: num(source.topMarginMm, base.topMarginMm, 0, exports.MAX_TOP_MARGIN_MM),
        bottomMarginMm: num(source.bottomMarginMm, base.bottomMarginMm, 0, exports.MAX_BOTTOM_MARGIN_MM),
        deviceTopTrimMm: num(source.deviceTopTrimMm, base.deviceTopTrimMm, 0, 20),
        sideMarginMm: num(source.sideMarginMm, base.sideMarginMm, 0, exports.MAX_SIDE_MARGIN_MM),
        logoUrl: text(source.logoUrl, base.logoUrl, 2048).trim(),
        logoWidth: num(source.logoWidth, base.logoWidth, 1, paperWidth),
        logoPosition: alignOf(source.logoPosition, base.logoPosition),
        headerText,
        subHeaderText: text(source.subHeaderText, base.subHeaderText, 100),
        receiptTitle: text(source.receiptTitle, base.receiptTitle, 60),
        footerText: text(source.footerText, base.footerText, 240),
        separatorChar: (text(source.separatorChar, base.separatorChar, 1) || base.separatorChar).slice(0, 1),
        itemSeparatorChar: (text(source.itemSeparatorChar, base.itemSeparatorChar, 1) || base.itemSeparatorChar).slice(0, 1),
        showItemSeparator: bool(source.showItemSeparator, base.showItemSeparator),
        qtyWidth: Math.round(num(source.qtyWidth, base.qtyWidth, 2, 10)),
        priceWidth: Math.round(num(source.priceWidth, base.priceWidth, 0, 20)),
        inlineDateMasa: bool(source.inlineDateMasa, base.inlineDateMasa),
        hidePrices: bool(source.hidePrices, base.hidePrices),
        showPaidItems: bool(source.showPaidItems, base.showPaidItems),
        elements,
        labels,
    };
}
/** Tum sablonlari tek seferde normalize eder. */
function normalizeAllLayouts(raw, restaurantName = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = {};
    for (const key of exports.PRINT_LAYOUT_KEYS) {
        result[key] = normalizeLayout(source[key], key, restaurantName);
    }
    return result;
}
//# sourceMappingURL=layout.js.map