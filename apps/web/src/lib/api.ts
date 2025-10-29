export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean>) {
  const u = new URL(`/api/proxy${path}`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (params) Object.entries(params).forEach(([k, v]) => v !== '' && v !== undefined && u.searchParams.set(k, String(v)));
  const res = await fetch(u.toString(), { credentials: 'include' });
  if (!res.ok) throw new Error(`GET ${u} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function apiCsvUrl(path: string, params?: Record<string, string | number | boolean>) {
  const u = new URL(`/api/proxy${path}`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (params) Object.entries(params).forEach(([k, v]) => v !== '' && v !== undefined && u.searchParams.set(k, String(v)));
  return u.toString();
}


