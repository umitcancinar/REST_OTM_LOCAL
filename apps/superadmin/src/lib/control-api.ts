export class ControlApiProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlApiProtocolError";
  }
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
