// middleware.ts  ← na raiz do projeto, ao lado de next.config.js
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

  // Verifica sessão ativa (também atualiza o cookie de refresh automaticamente)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;

  // Sem sessão tentando acessar raiz → manda para /login
  if (!session && pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Com sessão tentando acessar /login → manda para raiz
  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

// Define quais rotas passam pelo middleware
export const config = {
  matcher: ["/", "/login"],
};
