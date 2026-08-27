import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = ["/groups", "/join"];
const authRoutes = ["/login"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getSession() reads the JWT from the cookie locally — no network round
  // trip to Supabase's Auth API (unlike getUser(), which was measured at
  // 300ms-1.6s per call here and ran on every single navigation). This is
  // safe specifically because this app never treats the middleware's
  // identity check as the real security boundary: every actual data call
  // goes through Supabase's own REST/RPC API, which independently verifies
  // the JWT signature server-side and enforces RLS regardless of what this
  // function decides. A forged/expired cookie can at worst reach a page
  // shell here — the real data queries still get rejected by Supabase
  // itself. Same reasoning already applied to the group-membership
  // pre-check removed from app/groups/[groupId]/layout.tsx.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = request.nextUrl.pathname;
  const isProtectedRoute = protectedRoutes.some((route) =>
    path.startsWith(route)
  );
  const isAuthRoute = authRoutes.some((route) => path.startsWith(route));

  if (isProtectedRoute && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/groups", request.url));
  }

  if (!user) {
    return supabaseResponse;
  }

  // Forward the (locally-read, not server-verified) user id/email as a
  // convenience header so page.tsx Server Components don't need their own
  // auth call just to render an "as X" label or an early redirect check.
  // RULE: never use this header to gate a real decision (anything an
  // owner/permission check controls, not just a redirect or display
  // label) — call supabase.auth.getUser() directly in that page instead,
  // the way app/groups/[groupId]/invite/page.tsx does for its "is this
  // user the group owner" check. Those pages are low-traffic, so the
  // extra network round trip doesn't cost anything that matters.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);
  if (user.email) requestHeaders.set("x-user-email", user.email);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}
