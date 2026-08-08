// .env dosyasından API adresini al (Yoksa localhost kullan)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Tüm menü verisini çeken asıl fonksiyon (ISR Desktekli)
export async function getRestaurantMenu(slug: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/public/menu/${slug}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Next.js ISR (Incremental Static Regeneration) için cache ayarı (60 saniyede bir günceller)
      next: { revalidate: 60 } 
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Menü bulunamadı veya API hatası!');
    }
    
    return data.data; // Yönetici panelinden girilen kategoriler ve ürünler döner
  } catch (error) {
    console.error("Menü çekilirken hata oluştu:", error);
    return null;
  }
}

