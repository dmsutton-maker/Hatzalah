import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieBundle = { name: string; value: string; options: CookieOptions }[];

/**
 * Refreshes the Supabase session cookie and gates /admin.
 *
 * This is a convenience redirect, not the security boundary — RLS is. Even if this
 * middleware were bypassed, the anon key can read nothing (04_rls.sql).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieBundle) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicAdminPath =
    path.startsWith("/admin/login") || path.startsWith("/admin/auth");

  if (!user && path.startsWith("/admin") && !isPublicAdminPath) {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = path === "/admin" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }

  if (user && path.startsWith("/admin/login")) {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = "/admin";
    dashboard.search = "";
    return NextResponse.redirect(dashboard);
  }

  return response;
}

export const config = {
  // Admin only. The staff scanner at /s/[token] must never touch auth — it is anonymous
  // by design, and a middleware hop there is latency at the register for nothing.
  matcher: ["/admin/:path*"],
};
