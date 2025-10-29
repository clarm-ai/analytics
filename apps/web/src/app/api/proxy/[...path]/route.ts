export const runtime = 'edge';

export async function GET(req: Request, ctx: { params: { path: string[] } }) { return proxy(req, ctx.params); }
export async function POST(req: Request, ctx: { params: { path: string[] } }) { return proxy(req, ctx.params); }
export async function PUT(req: Request, ctx: { params: { path: string[] } }) { return proxy(req, ctx.params); }
export async function PATCH(req: Request, ctx: { params: { path: string[] } }) { return proxy(req, ctx.params); }
export async function DELETE(req: Request, ctx: { params: { path: string[] } }) { return proxy(req, ctx.params); }

async function proxy(request: Request, { path }: { path: string[] }) {
  const backendBase = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
  if (!backendBase) return new Response('BACKEND_URL not configured', { status: 500 });
  const inUrl = new URL(request.url);
  const target = new URL(`${backendBase}/${(path || []).join('/')}${inUrl.search}`);

  const headers = new Headers(request.headers);
  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
  if (!['GET','HEAD'].includes(request.method)) {
    // @ts-ignore - edge supports streaming
    init.body = (request as any).body;
    // @ts-ignore
    (init as any).duplex = 'half';
  }
  const res = await fetch(target.toString(), init);
  return new Response(res.body, { status: res.status, headers: res.headers });
}


