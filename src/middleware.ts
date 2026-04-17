import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";

interface SessionData {
  userId?: number;
  username?: string;
  isLoggedIn: boolean;
}

// In-memory rate limiter for guest-facing endpoints
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Periodically clean up expired entries
if (typeof globalThis !== "undefined") {
  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (entry.resetAt <= now) rateLimitMap.delete(key);
    }
  };
  setInterval(cleanup, 60_000);
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error(
    "SESSION_SECRET env var is required. Generate one with: openssl rand -base64 32",
  );
}

const sessionOptions = {
  password: sessionSecret,
  cookieName: "campsense-session",
  cookieOptions: {
    secure: process.env.FORCE_HTTPS === "true",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export async function middleware(request: NextRequest) {
  // Force HTTPS redirect
  if (
    process.env.FORCE_HTTPS === "true" &&
    request.headers.get("x-forwarded-proto") !== "https" &&
    !request.nextUrl.hostname.match(/^(localhost|127\.|10\.|192\.168\.)/)
  ) {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 301);
  }

  // Rate limit guest-facing endpoints
  const path = request.nextUrl.pathname;
  if (path.startsWith("/guest") || path.startsWith("/shower") || path.startsWith("/laundry") || path.startsWith("/services")) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
  }

  // Only check auth for /admin routes
  if (path.startsWith("/admin")) {
    const response = NextResponse.next();
    const session = await getIronSession<SessionData>(
      request,
      response,
      sessionOptions,
    );

    if (!session.isLoggedIn) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
