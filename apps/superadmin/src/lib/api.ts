const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

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
  post: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
};
