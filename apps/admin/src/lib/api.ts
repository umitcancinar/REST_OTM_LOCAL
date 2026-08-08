// Uretim local paketinde admin + API tek LAN gateway/origin altindadir.
// Mutlak localhost adresi telefonda kullanicinin kendi cihazina gider.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const ORDER_COMMAND_STORAGE_KEY = 'restotm:pending-order-command';

async function orderCommandBody(endpoint: string, body: any): Promise<any> {
  if (endpoint !== '/orders' || body?.clientCommandId || typeof window === 'undefined') return body;
  const serialized = JSON.stringify(body);
  let fingerprint = serialized;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(serialized),
    );
    fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let pending: { fingerprint: string; id: string } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(ORDER_COMMAND_STORAGE_KEY) || 'null');
  } catch {
    sessionStorage.removeItem(ORDER_COMMAND_STORAGE_KEY);
  }
  if (!pending || pending.fingerprint !== fingerprint) {
    const id = globalThis.crypto?.randomUUID?.()
      ?? `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pending = { fingerprint, id };
    sessionStorage.setItem(ORDER_COMMAND_STORAGE_KEY, JSON.stringify(pending));
  }
  return { ...body, clientCommandId: pending.id };
}

function redirectOnLicenseLock(response: Response): boolean {
  if (response.status !== 423 || typeof window === 'undefined') return false;

  // Aktivasyon ekrani API yardimcisini kullanmaz; yine de bu kontrol,
  // ileride kullanmasi halinde kendi kendine yonlendirme dongusunu engeller.
  if (window.location.pathname !== '/activate') {
    window.location.replace('/activate');
  }
  return true;
}

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const impersonatedTenantId = typeof window !== 'undefined' ? localStorage.getItem('impersonatedTenantId') : null;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(impersonatedTenantId ? { 'x-tenant-id': impersonatedTenantId } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (redirectOnLicenseLock(response)) {
    throw new Error('Yerel lisans doğrulaması gerekiyor.');
  }

  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        // Attempt to refresh
        const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          const { accessToken, refreshToken: newRefreshToken } = refreshData.data;
          
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);
          
          // Retry original request with new token
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${accessToken}`,
          };
          const retryRes = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: retryHeaders,
          });

          if (redirectOnLicenseLock(retryRes)) {
            throw new Error('Yerel lisans doğrulaması gerekiyor.');
          }
          
          if (!retryRes.ok) throw new Error('Retry failed');
          const retryData = await retryRes.json();
          return retryData.data;
        }
      } catch (err) {
        console.error('Session refresh failed', err);
      }
    }

    // If no refresh token or refresh failed, logout
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('impersonatedTenantId');
    localStorage.removeItem('impersonatedTenantName');
    window.location.href = '/';
  }

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.message || 'API Hatası');
  }

  return data.data; 
}

export const api = {
  get: (endpoint: string) => fetchWithAuth(endpoint),
  post: async (endpoint: string, body: any) => {
    const commandBody = await orderCommandBody(endpoint, body);
    const result = await fetchWithAuth(endpoint, { method: 'POST', body: JSON.stringify(commandBody) });
    if (endpoint === '/orders' && typeof window !== 'undefined') {
      sessionStorage.removeItem(ORDER_COMMAND_STORAGE_KEY);
    }
    return result;
  },
  patch: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
};
