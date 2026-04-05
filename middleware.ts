// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  const { pathname } = request.nextUrl;

  const protectedPaths = ["/hub", "/operacao", "/diretoria"];
  const isProtected = protectedPaths.some(p => pathname.startsWith(p));

  // Sem sessão tentando acessar rota protegida → /login
  if (!session && isProtected) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Com sessão tentando acessar /login → /hub
  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/hub", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/", "/login", "/hub", "/hub/:path*", "/operacao", "/operacao/:path*", "/diretoria", "/diretoria/:path*"],
};
