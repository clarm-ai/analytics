export const runtime = "edge";

// Using the runtime's env via globalThis for Next-on-Pages
function getEnv(): any {
  try {
    // Cloudflare Pages / Workers: env on globalThis
    return (globalThis as any).env || (globalThis as any).process?.env || {};
  } catch {
    return (globalThis as any).process?.env || {};
  }
}

export function getUID(req: Request): string {
  const url = new URL(req.url);
  const qp = url.searchParams.get("uid");
  if (qp) return qp;
  const host = url.hostname.split(".");
  if (host.length > 2) return host[0];
  const cookie = req.headers.get("cookie") || "";
  const m = /uid=([^;]+)/i.exec(cookie);
  return m ? decodeURIComponent(m[1]) : "demo";
}

export function getDB(): D1Database | undefined {
  const env: any = getEnv();
  return env.DB as D1Database | undefined;
}

// Convenience helpers for D1 queries with graceful failure
export async function d1All<T = any>(sql: string, ...binds: any[]): Promise<T[]> {
  const db = getDB();
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    const res = await (binds?.length ? stmt.bind(...binds) : stmt).all<T>();
    return (res?.results as T[]) || [];
  } catch {
    return [];
  }
}

export async function d1Run(sql: string, ...binds: any[]): Promise<boolean> {
  const db = getDB();
  if (!db) return false;
  try {
    const stmt = db.prepare(sql);
    await (binds?.length ? stmt.bind(...binds) : stmt).run();
    return true;
  } catch {
    return false;
  }
}



