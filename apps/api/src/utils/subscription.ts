// ==========================================
// Uyelik Suresi Hesabi (saf fonksiyon)
// ==========================================
// Superadmin bir tenant'in uyeligini uzattiginda/azalttiginda kullanilir.
// Saf tutuluyor (DB'ye dokunmuyor) ki apps/api/test altinda dogrudan
// test edilebilsin — bkz. print-triggers.ts ile ayni desen.

/**
 * Yeni uyelik bitis tarihini hesaplar.
 *
 * Kural: `yeniTarih = max(suAn, mevcutBitis ?? suAn) + ay`
 * - Suresi hala devam eden bir uyelik uzatilirsa, MEVCUT bitis tarihinden
 *   itibaren eklenir (bugunden degil) — standart SaaS davranisi.
 * - Suresi dolmus veya hic ayarlanmamis bir tenant icin bugunden baslar.
 * - `months` negatif olabilir (azaltma); ayni formul her iki yonde de
 *   dogru sonucu verir.
 */
export function addMonthsToExpiry(current: Date | null, months: number, now: Date = new Date()): Date {
  const base = current && current > now ? current : now;
  const result = new Date(base);
  result.setMonth(result.getMonth() + months);
  return result;
}
