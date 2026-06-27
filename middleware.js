import { verifySessionToken, parseCookie, SESSION_COOKIE } from "./lib/auth.js";

const PUBLIC_PATHS = new Set(["/login.html", "/login", "/favicon.ico"]);

function isPublicApi(pathname) {
  return (
    pathname === "/api/heyreach-webhook" ||
    pathname === "/api/gmail/webhook" ||
    pathname.startsWith("/api/gmail/oauth") ||
    pathname === "/api/cron/renew-gmail-watches" ||
    pathname.startsWith("/api/auth/")
  );
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  if (PUBLIC_PATHS.has(pathname) || isPublicApi(pathname)) {
    return;
  }

  const token = parseCookie(request.headers.get("cookie") || "", SESSION_COOKIE);
  const session = await verifySessionToken(token);

  if (session) {
    return;
  }

  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const loginUrl = new URL("/login.html", request.url);
  loginUrl.searchParams.set("next", pathname === "/" ? "/" : pathname);
  return Response.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
