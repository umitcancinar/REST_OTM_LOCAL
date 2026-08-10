const PRODUCTION_MARKETING_ORIGIN = "https://www.restoranyonetim.com";

type MarketingOriginOptions = {
  configuredOrigin?: string;
  production?: boolean;
};

function canonicalHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Render's proxy can expose localhost:PORT as req.url. Production redirects
 * therefore use our canonical HTTPS origin instead of client-controlled Host
 * headers. Local development keeps the request origin.
 */
export function resolveMarketingOrigin(
  requestUrl: string,
  options: MarketingOriginOptions = {},
): string {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const configured = canonicalHttpsOrigin(
    options.configuredOrigin ?? process.env.MARKETING_PUBLIC_URL,
  );

  if (configured) return configured;
  if (production) return PRODUCTION_MARKETING_ORIGIN;
  return new URL(requestUrl).origin;
}

export function marketingRedirectUrl(requestUrl: string): URL {
  return new URL("/", resolveMarketingOrigin(requestUrl));
}
