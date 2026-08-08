import { redirect } from 'next/navigation';

export default function Home() {
  // Production'da burası bir "QR Kodunuzu Okutun" sayfası veya ana landing page olmalı.
  // Geliştirme sürecinde kolaylık olması için mevcut restorana yönlendirelim.
  redirect('/lezzet-restoran');
}
