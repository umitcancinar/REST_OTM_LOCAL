import { discoverPrinters } from './printer/scanner';

async function main() {
  console.log('\n==========================================');
  console.log('📡 REST_OTM YAZICI KEŞİF ARACI');
  console.log('==========================================\n');

  try {
    const printers = await discoverPrinters(500);
    
    if (printers.length === 0) {
      console.log('\n❌ Hiçbir yazıcı bulunamadı.');
      console.log('💡 İpucu: Yazıcınızın açık ve ethernet kablosuyla modeme bağlı olduğundan emin olun.');
    } else {
      console.log(`\n🎉 Toplam ${printers.length} yazıcı bulundu:`);
      console.log('------------------------------------------');
      printers.forEach((p, i) => {
        console.log(`${i + 1}. IP ADRESİ: ${p.ip} | PORT: ${p.port}`);
      });
      console.log('------------------------------------------');
      console.log('\n💡 Bu IP adreslerini Admin Panelinde "Yazıcı Ayarları" kısmına ekleyebilirsin.');
    }
  } catch (err) {
    console.error('Tarama sırasında bir hata oluştu:', err);
  }

  process.exit(0);
}

main();
