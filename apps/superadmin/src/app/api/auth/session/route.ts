import { NextRequest, NextResponse } from 'next/server';
import { controlApiUrl, readControlApiJson } from '@/lib/control-api';
import {
  clearSession,
  pendingMfa,
  setSession,
  tokens,
  type SessionUser,
} from '@/lib/server-session';

export const runtime = 'nodejs';

type SessionState = 'authenticated' | 'pending-mfa' | 'unauthenticated' | 'unavailable';

function response(state: SessionState, extra: Record<string, unknown> = {}) {
  const result = NextResponse.json({ state, ...extra });
  result.headers.set('Cache-Control', 'no-store, private');
  return result;
}

async function profile(accessToken: string) {
  return fetch(controlApiUrl('auth/profile'), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    redirect: 'error',
  });
}

async function refresh(refreshToken: string) {
  const serviceSecret = process.env.SUPERADMIN_BFF_SERVICE_SECRET;
  if (!serviceSecret) return null;
  const result = await fetch(controlApiUrl('auth/superadmin/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rest-otm-service-secret': serviceSecret,
    },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
    redirect: 'error',
  });
  if (!result.ok) return null;
  const payload = await readControlApiJson<{
    data?: { accessToken?: string; refreshToken?: string };
  }>(result, 'superadmin-session-refresh');
  if (!payload.data?.accessToken || !payload.data.refreshToken) return null;
  return {
    accessToken: payload.data.accessToken,
    refreshToken: payload.data.refreshToken,
  };
}

export async function GET(req: NextRequest) {
  const current = tokens(req);
  if (!current.accessToken && !current.refreshToken) {
    return response(pendingMfa(req) ? 'pending-mfa' : 'unauthenticated');
  }

  try {
    let active = current.accessToken;
    let renewed: { accessToken: string; refreshToken: string } | null = null;
    let upstream = active ? await profile(active) : null;

    if ((!upstream || upstream.status === 401) && current.refreshToken) {
      renewed = await refresh(current.refreshToken);
      if (renewed) {
        active = renewed.accessToken;
        upstream = await profile(active);
      }
    }

    if (!upstream || upstream.status === 401 || upstream.status === 403) {
      const result = response('unauthenticated');
      clearSession(result);
      return result;
    }
    if (!upstream.ok) return response('unavailable');

    const payload = await readControlApiJson<{ data?: SessionUser }>(upstream, 'superadmin-session-profile');
    const user = payload.data;
    if (!user || user.role !== 'SUPER_ADMIN') {
      const result = response('unauthenticated');
      clearSession(result);
      return result;
    }

    const result = response('authenticated', {
      user,
      security: {
        // SuperAdmin access/refresh tokenlari yalniz MFA verify rotasinda BFF
        // HttpOnly cookie'lerine yazilir; public auth bu rolu tokenlayamaz.
        mfaVerified: true,
        httpOnlySession: true,
        secureTransport: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      },
      checkedAt: new Date().toISOString(),
    });
    if (renewed) setSession(result, renewed);
    return result;
  } catch (error) {
    console.error('[superadmin-session-status]', error);
    return response('unavailable');
  }
}
