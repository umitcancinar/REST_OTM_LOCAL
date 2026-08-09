const API_BASE_URL = '/api/backend';

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const impersonatedTenantId = typeof window !== 'undefined' ? localStorage.getItem('impersonatedTenantId') : null;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(impersonatedTenantId ? { 'x-tenant-id': impersonatedTenantId } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    // Refresh rotation runs in the same-origin server BFF; browser JS never sees tokens.
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
  post: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
};
