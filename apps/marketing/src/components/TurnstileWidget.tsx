import Script from "next/script";
import { turnstileAction, turnstileSiteKey } from "@/lib/turnstile";

export function TurnstileWidget() {
  const siteKey = turnstileSiteKey();
  if (!siteKey) return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">Güvenlik doğrulaması henüz yapılandırılmadı.</p>;
  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
    <div className="flex min-h-[70px] items-center justify-center overflow-hidden rounded-md border border-line bg-bg px-2 py-1.5">
      <div className="cf-turnstile" data-sitekey={siteKey} data-action={turnstileAction()} data-language="tr" data-theme="light" data-size="flexible" />
    </div>
  </>;
}
