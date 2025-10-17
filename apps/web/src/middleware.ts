import { NextRequest, NextResponse } from "next/server";

// Redirect root to basePath and rewrite /analytics/{channel} -> /analytics?channel={channel}
export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/") {
    url.pathname = "/analytics";
    return NextResponse.redirect(url);
  }

  // Support multi-channel URLs without a dynamic route file by rewriting
  // /analytics/{channelId} to /analytics?channel={channelId}
  if (pathname.startsWith("/analytics/")) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const channelId = parts[1];
      url.pathname = "/analytics";
      url.searchParams.set("channel", channelId);
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/analytics/:path*"],
};


