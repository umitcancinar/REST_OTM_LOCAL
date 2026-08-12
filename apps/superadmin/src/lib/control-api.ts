export class ControlApiProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlApiProtocolError";
  }
}

export class ControlApiUnavailableError extends Error {
  constructor(message = "Kontrol API kullanılamıyor.") {
    super(message);
    this.name = "ControlApiUnavailableError";
  }
}

type ReadyProbeOptions = {
  attempts?: number;
  timeoutMs?: number;
  controlApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  wait?: (delayMs: number) => Promise<void>;
};

/**
 * Render free services can return their own HTML 502 page while waking up.
 * Probe readiness before sending the non-idempotent MFA request so credentials
 * are submitted exactly once and a cold start cannot create duplicate MFA
 * challenges or e-mails.
 */
export async function waitForControlApiReady({
  attempts = 6,
  timeoutMs = 12_000,
  controlApiBaseUrl,
  fetchImpl = fetch,
  wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}: ReadyProbeOptions = {}): Promise<void> {
  const delays = [0, 1_500, 3_000, 5_000, 8_000, 10_000];
  const safeAttempts = Math.max(1, Math.min(attempts, delays.length));

  for (let attempt = 0; attempt < safeAttempts; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);

    try {
      const response = await fetchImpl(controlApiUrl("ready", controlApiBaseUrl), {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && contentType.toLowerCase().includes("application/json")) {
        const payload = await response.json() as { success?: boolean };
        if (payload.success === true) return;
      }

      console.warn("[control-api-readiness]", {
        attempt: attempt + 1,
        status: response.status,
        contentType,
      });
    } catch (error) {
      console.warn("[control-api-readiness]", {
        attempt: attempt + 1,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  throw new ControlApiUnavailableError();
}

export function controlApiBase(raw = process.env.REST_OTM_API_URL) {
  if (!raw) throw new Error("REST_OTM_API_URL is not configured");

  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("REST_OTM_API_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("REST_OTM_API_URL must not contain credentials, query parameters, or a fragment");
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (!path) url.pathname = "/api";
  else if (path === "/api") url.pathname = "/api";
  else throw new Error("REST_OTM_API_URL path must be empty or /api");

  return url.toString().replace(/\/$/, "");
}

export function controlApiUrl(path: string, raw = process.env.REST_OTM_API_URL) {
  const normalizedPath = path.replace(/^\/+/, "");
  return `${controlApiBase(raw)}/${normalizedPath}`;
}

export async function readControlApiJson<T = unknown>(response: Response, operation: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("[control-api-protocol]", {
      operation,
      status: response.status,
      contentType,
      responseLength: text.length,
    });
    throw new ControlApiProtocolError("Kontrol API beklenmeyen bir yanıt döndürdü.");
  }
}
