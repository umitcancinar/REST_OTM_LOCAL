import { NextRequest, NextResponse } from "next/server";
import { controlApiUrl, readControlApiJson } from "@/lib/control-api";
import { mutationRequestError } from "@/lib/request-security";
import { setSession, tokens } from "@/lib/server-session";

export const runtime = "nodejs";

async function upstream(req: NextRequest, accessToken: string, path: string[], body?: string) {
  const url = new URL(controlApiUrl(path.map(encodeURIComponent).join("/")));
  url.search = req.nextUrl.search;
  return fetch(url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": req.headers.get("content-type") || "application/json",
      ...(req.headers.get("x-tenant-id") ? { "x-tenant-id": req.headers.get("x-tenant-id")! } : {}),
    },
    body: body || undefined,
    cache: "no-store",
    redirect: "error",
  });
}

async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const originError = mutationRequestError(req);
  if (originError) return NextResponse.json({ message: originError }, { status: 403 });

  try {
    const { path } = await context.params;
    const current = tokens(req);
    if (!current.accessToken) return NextResponse.json({ message: "Oturum gerekli." }, { status: 401 });
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
    let result = await upstream(req, current.accessToken, path, body);
    let refreshed: { accessToken: string; refreshToken: string } | null = null;

    if (result.status === 401 && current.refreshToken && process.env.SUPERADMIN_BFF_SERVICE_SECRET) {
      const refresh = await fetch(controlApiUrl("auth/superadmin/refresh"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-rest-otm-service-secret": process.env.SUPERADMIN_BFF_SERVICE_SECRET,
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
        cache: "no-store",
        redirect: "error",
      });
      if (refresh.ok) {
        const json = await readControlApiJson<{ data?: { accessToken?: string; refreshToken?: string } }>(refresh, "superadmin-refresh");
        const nextTokens = json.data as { accessToken?: string; refreshToken?: string };
        if (nextTokens.accessToken && nextTokens.refreshToken) {
          refreshed = { accessToken: nextTokens.accessToken, refreshToken: nextTokens.refreshToken };
          result = await upstream(req, refreshed.accessToken, path, body);
        }
      }
    }

    const response = new NextResponse(result.body, {
      status: result.status,
      headers: {
        "Content-Type": result.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
    if (refreshed?.accessToken && refreshed.refreshToken) setSession(response, refreshed);
    return response;
  } catch (error) {
    console.error("[superadmin-bff]", error);
    return NextResponse.json({ message: "Yönetim API bağlantısı kurulamadı." }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
