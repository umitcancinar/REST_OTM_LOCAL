// ==========================================
// Tarih Yardimcilari — isletme saat dilimi
// ==========================================
// Rapor uc noktalari YYYY-MM-DD bekler ve gunu sunucuda uygular.
// `new Date().toISOString()` UTC dondurdugu icin Turkiye'de (UTC+3)
// gece 00:00-03:00 arasinda BIR ONCEKI gunu isaret eder; o saatlerde
// hala acik olan bir restoranin gunluk cirosu yanlis gune yazilirdi.
// Bu yuzden gun her zaman isletmenin saat diliminden hesaplanir.

const BUSINESS_TIME_ZONE = 'Europe/Istanbul';

/** Verilen ani isletme saat diliminde YYYY-MM-DD olarak dondurur. */
export function formatBusinessDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
