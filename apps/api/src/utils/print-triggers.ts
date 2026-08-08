// ==========================================
// Fis Tetikleme Karari
// ==========================================
// Iptal/ikram fisi SADECE gercek bir durum degisiminde basilmalidir.
// Bu kural onceden updateItemStatus icinde ortuk duruyordu ve her istekte
// fis basiyordu: yavas yanit yuzunden butona ust uste basan kullanici ayni
// urun icin arka arkaya iptal fisi cikartiyordu (kagit israfi ve mutfakta
// kafa karisikligi).
//
// Karar burada SAF bir fonksiyon olarak durur; boylece Prisma'ya ihtiyac
// duymadan test edilebilir ve tek kaynaktan yonetilir.

export type ItemPrintTrigger = 'CANCEL' | 'TREAT' | null;

export interface ItemPrintState {
  /** Urunun mevcut (guncelleme oncesi) durumu. */
  status: string;
  /** Urun halihazirda ikram mi. */
  isTreat: boolean;
}

/**
 * Bir urun guncellemesinin fis bastirip bastirmayacagini belirler.
 *
 * @param previous Guncelleme ONCESI urun durumu (veritabanindan okunan).
 * @param nextStatus Istemcinin gonderdigi yeni durum.
 * @param nextIsTreat Guncelleme sonrasi ikram olacak mi.
 * @returns Basilacak fis turu, ya da degisim yoksa null.
 */
export function resolveItemPrintTrigger(
  previous: ItemPrintState,
  nextStatus: string,
  nextIsTreat: boolean,
): ItemPrintTrigger {
  // Zaten iptalli bir urune tekrar iptal gelirse fis basma.
  if (nextStatus === 'CANCELLED') {
    return previous.status === 'CANCELLED' ? null : 'CANCEL';
  }
  // Zaten ikram olan urune tekrar ikram gelirse fis basma.
  if (nextIsTreat) {
    return previous.isTreat ? null : 'TREAT';
  }
  return null;
}
