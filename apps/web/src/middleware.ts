import { NextRequest, NextResponse } from "next/server";

// Redirect root to the configured basePath so local dev at "/" works
export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  if (url.pathname === "/") {
    url.pathname = "/analytics";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};


