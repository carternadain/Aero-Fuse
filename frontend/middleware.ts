import { NextResponse, type NextRequest } from "next/server";

// Page-level gate: ask the backend whether this browser's session cookie is valid
// (or whether login is switched off) before serving the dashboard. The API enforces
// the same check on every /api call, so this is about UX — not the only lock.
export async function middleware(req: NextRequest) {
  const api = process.env.API_BASE || "http://127.0.0.1:8000";
  try {
    const r = await fetch(`${api}/api/auth/check`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (r.status === 401) {
      // Relative Location: behind a reverse proxy, req.url carries the internal
      // host (localhost:3000), which would send phones to a dead address.
      return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
    }
  } catch {
    // Backend down: let the page load — it shows the offline banner, and has no data.
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the login page, API/webhook proxies, Next internals and static files.
  matcher: ["/((?!login|api|webhook|_next|favicon|icon-|apple-touch-icon|manifest).*)"],
};
