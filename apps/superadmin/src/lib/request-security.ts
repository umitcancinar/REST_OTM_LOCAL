type HeaderReader = {
  get(name: string): string | null;
};

export type MutationRequest = {
  method: string;
  headers: HeaderReader;
  nextUrl: { origin: string };
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizedOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: MutationRequest) {
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    firstHeaderValue(request.headers.get("host"));
  const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const fallback = normalizedOrigin(request.nextUrl.origin);

  if (!host) return fallback;

  const protocol = forwardedProtocol ?? (fallback ? new URL(fallback).protocol.slice(0, -1) : "https");
  return normalizedOrigin(`${protocol}://${host}`);
}

function configuredOrigins() {
  return [process.env.SUPERADMIN_PUBLIC_URL, ...(process.env.SUPERADMIN_ALLOWED_ORIGINS ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(normalizedOrigin)
    .filter((value): value is string => Boolean(value));
}

/**
 * Validates browser-originated state changes before any credential-bearing BFF
 * request is forwarded. SameSite cookies remain the primary boundary; this is
 * the explicit Origin/Host check required for defence in depth.
 */
export function mutationRequestError(
  request: MutationRequest,
  extraAllowedOrigins: readonly string[] = configuredOrigins(),
) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return "Çapraz site isteği reddedildi.";

  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return "İstek kaynağı doğrulanamadı.";

  const origin = normalizedOrigin(suppliedOrigin);
  if (!origin) return "Geçersiz istek kaynağı.";

  const allowed = new Set<string>();
  const ownOrigin = requestOrigin(request);
  if (ownOrigin) allowed.add(ownOrigin);
  for (const candidate of extraAllowedOrigins) {
    const normalized = normalizedOrigin(candidate);
    if (normalized) allowed.add(normalized);
  }

  return allowed.has(origin) ? null : "İstek kaynağı bu yönetim paneliyle eşleşmiyor.";
}
