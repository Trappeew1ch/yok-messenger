import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
          cookiesToSet.forEach(({ name, value, options }) =>
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

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // Public routes — always accessible
  const publicRoutes = ['/auth'];
  if (publicRoutes.some(r => path.startsWith(r))) {
    // If logged in and going to /auth, redirect to /chat
    if (user && path.startsWith('/auth')) {
      return NextResponse.redirect(new URL('/chat', request.url));
    }
    return response;
  }

  // Root — redirect to /chat if authenticated
  if (path === '/') {
    if (user) return NextResponse.redirect(new URL('/chat', request.url));
    return response;
  }

  // Onboarding — only for logged-in users
  if (path.startsWith('/onboarding')) {
    if (!user) return NextResponse.redirect(new URL('/auth', request.url));
    return response;
  }

  // Protected routes — require auth
  if (!user) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
