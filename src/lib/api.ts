export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('fortix_token');
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('X-Fortix-Token', token);
  }
  
  const urlObj = new URL(url, window.location.origin);

  const response = await fetch(urlObj.toString(), {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    localStorage.removeItem('fortix_token'); window.location.href = '/'; // force re-login
  }
  
  return response;
}
