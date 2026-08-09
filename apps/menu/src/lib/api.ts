function cloudMenuApiBaseUrl(): string {
  const raw = process.env.CLOUD_MENU_API_URL
    || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:4000/api');
  if (!raw) {
    throw new Error('Production menu runtime icin CLOUD_MENU_API_URL zorunludur.');
  }

  const parsed = new URL(raw);
  if (
    (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
    || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('CLOUD_MENU_API_URL guvenli, credentials/query/hash icermeyen bir HTTPS URL olmali.');
  }
  return parsed.toString().replace(/\/$/, '');
}

// Tüm menü verisini çeken asıl fonksiyon (ISR Desktekli)
export async function getRestaurantMenu(slug: string) {
  try {
    const response = await fetch(`${cloudMenuApiBaseUrl()}/public/menu/${encodeURIComponent(slug)}`, {
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
