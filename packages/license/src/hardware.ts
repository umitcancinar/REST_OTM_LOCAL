// ==========================================
// Donanim parmak izi
// ==========================================
// Amac: bir lisansin tek bir bilgisayara baglanmasi. Ayni lisans
// dosyasi kopyalanip baska makinede calistirilamasin.
//
// Tasarim gerilimi: parmak izi ne kadar HASSAS olursa kopyalama o kadar
// zorlasir, ama sira disi bir donanim degisikliginde (RAM eklendi, ag
// karti degisti) mesru musteri de kilitlenir — ve bu, aksam servisinde
// calisamayan bir restoran demektir.
//
// Bu yuzden yalnizca NADIREN degisen ve makineyi kimliklendiren
// bilgiler kullaniliyor; disk/RAM gibi degistirilebilir parcalar disarida.
// Yine de degisirse kilitlemek yerine sunucudan yeniden baglama
// istenir (bkz. license sunucusu: rebind akisi).

import { createHash } from 'crypto';
import { hostname, networkInterfaces, platform, arch, cpus } from 'os';

/**
 * Kalici MAC adreslerini toplar.
 * Sanal arayuzler (Docker, VPN, WSL, Hyper-V) BILEREK disarida: bunlar
 * kurulur/kaldirilir ve parmak izini kararsiz yapar.
 */
function stableMacAddresses(): string[] {
  const skip = /^(docker|veth|br-|virbr|vmnet|vboxnet|tun|tap|utun|wsl|Loopback|Hyper-V)/i;
  const result: string[] = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || skip.test(name)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (!a.mac || a.mac === '00:00:00:00:00:00') continue;
      result.push(a.mac.toLowerCase());
    }
  }

  // Siralama sart: isletim sistemi arayuzleri farkli sirada dondurebilir,
  // sirasiz birlestirme her acilista farkli parmak izi uretirdi.
  return [...new Set(result)].sort();
}

/**
 * Bu makineye ozgu, tekrar uretilebilir bir kimlik uretir.
 * Ayni makinede her zaman ayni degeri dondurur.
 */
export function computeHardwareId(): string {
  const parts = [
    'v1',
    platform(),
    arch(),
    hostname(),
    // CPU modeli ve cekirdek sayisi: anakart/islemci degismedikce sabit
    cpus()[0]?.model?.trim() ?? 'unknown-cpu',
    String(cpus().length),
    stableMacAddresses().join(','),
  ];

  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Destek ekraninda gosterilecek kisa hali.
 * Musteri telefonda "cihaz kodum 4F2A-9C1B" diyebilsin diye.
 */
export function shortHardwareId(hardwareId = computeHardwareId()): string {
  const s = hardwareId.toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}
