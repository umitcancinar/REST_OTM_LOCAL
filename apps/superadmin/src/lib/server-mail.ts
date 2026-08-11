function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

export type AdminMailFailure =
  | "unconfigured"
  | "unauthorized"
  | "rate-limited"
  | "provider-error"
  | "unavailable";

export class AdminMailError extends Error {
  readonly failure: AdminMailFailure;
  readonly providerStatus?: number;

  constructor(
    failure: AdminMailFailure,
    providerStatus?: number,
  ) {
    super(`admin-mail-${failure}`);
    this.name = "AdminMailError";
    this.failure = failure;
    this.providerStatus = providerStatus;
  }
}

export function adminMailUserMessage(error: AdminMailError) {
  switch (error.failure) {
    case "unconfigured":
      return "E-posta doğrulama servisi yapılandırılmadı.";
    case "unauthorized":
      return "E-posta doğrulama servisi yetkilendirilemedi. Resend anahtarını ve doğrulanmış gönderici alan adını kontrol edin.";
    case "rate-limited":
      return "E-posta servisi istek sınırına ulaştı. Lütfen kısa bir süre sonra tekrar deneyin.";
    case "provider-error":
      return "Doğrulama e-postası gönderici tarafından reddedildi. Gönderici adresini ve alıcıyı kontrol edin.";
    case "unavailable":
      return "E-posta doğrulama servisine şu anda ulaşılamıyor. Lütfen tekrar deneyin.";
  }
}

export async function sendAdminVerificationEmail({
  to,
  code,
  id,
}: {
  to: string;
  code: string;
  id: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SUPERADMIN_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new AdminMailError("unconfigured");

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `superadmin:${id}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${code} — REST_OTM yönetici giriş kodu`,
        text: `REST_OTM yönetici giriş kodunuz: ${code}. Kod 10 dakika geçerlidir.`,
        html: `<div style="background:#f4f0e8;padding:40px 16px;font-family:Arial,sans-serif;color:#1c1714"><div style="max-width:560px;margin:auto;background:#fffdf9;border:1px solid #e4dbd0;border-radius:18px;overflow:hidden"><div style="background:#171310;padding:28px 32px;color:#fff"><div style="font-family:Georgia,serif;font-size:24px;letter-spacing:.5px">REST_OTM</div><div style="margin-top:6px;font-size:10px;font-weight:bold;letter-spacing:2px;color:#d7ccc1">YÖNETİCİ ERİŞİMİ</div></div><div style="padding:32px"><p style="margin:0;color:#e5714b;font-size:11px;font-weight:bold;letter-spacing:2px">İKİ AŞAMALI DOĞRULAMA</p><h1 style="margin:12px 0 8px;font:600 30px Georgia,serif">Giriş kodun.</h1><p style="color:#665c55;line-height:1.6">Yönetim paneli oturumunu açmak için aşağıdaki tek kullanımlık kodu girin.</p><div style="margin:26px 0;padding:18px;border-radius:12px;background:#171310;color:#fff;font-size:32px;font-weight:700;letter-spacing:10px;text-align:center">${escapeHtml(code)}</div><p style="color:#786d65;font-size:13px">Kod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız derhal parolanızı değiştirin.</p></div></div></div>`,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    console.error("[superadmin-mail] request unavailable");
    throw new AdminMailError("unavailable");
  }

  if (!response.ok) {
    // Do not place the provider response body or any credential into logs.
    console.error("[superadmin-mail] delivery failed", response.status);
    if (response.status === 401 || response.status === 403) {
      throw new AdminMailError("unauthorized", response.status);
    }
    if (response.status === 429) {
      throw new AdminMailError("rate-limited", response.status);
    }
    if (response.status >= 500) {
      throw new AdminMailError("unavailable", response.status);
    }
    throw new AdminMailError("provider-error", response.status);
  }
}
