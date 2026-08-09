import { getRestaurantMenu } from '../../lib/api';
import MenuClient from './MenuClient';

// Next.js Server Component - Direkt sunucuda veriyi çeker
export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tableId?: string; tableToken?: string }>;
}) {
  const { slug } = await params;
  const { tableId, tableToken } = await searchParams;
  
  // 1. URL'den restoranın slug'ını al ve API'ye sor
  const menuData = await getRestaurantMenu(slug);

  if (!menuData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-[#050508] text-white">
        <div className="text-4xl mb-4">🍽️</div>
        <h1 className="text-xl font-bold mb-2">Menü Bulunamadı!</h1>
        <p className="text-[#a0a0b8] mb-6">Restorana ait menü verisine ulaşılamadı. Lütfen adresi kontrol edin.</p>
      </div>
    );
  }

  // 2. Tasarımı bozmadan Client bileşenimize data'yı paslıyoruz.
  return (
    <MenuClient 
      tenantSlug={slug}
      tableId={tableId}
      tableToken={tableToken}
      menuData={menuData.categories}
      restaurantInfo={{ name: menuData.restaurantName }}
    />
  );
}
