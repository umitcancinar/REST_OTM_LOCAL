const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const WAITER_BASE_PATH = '/garson';
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

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
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
          
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${accessToken}`,
          };
          const retryRes = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: retryHeaders,
          });
          
          const retryData = await retryRes.json();
          if (retryRes.ok) return retryData.data;
        }
      } catch (err) {
        console.error('Session refresh failed', err);
      }
    }

    // Force Logout on persistent 401 or refresh failure
    console.warn('Session expired. Redirecting to login...');
    localStorage.clear(); // Clear everything to be safe
    window.location.href = `${WAITER_BASE_PATH}/?error=session_expired`;
    return;
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
