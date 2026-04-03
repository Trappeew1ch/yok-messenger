import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/chat';
  const redirectTo = request.nextUrl.clone();

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              redirectTo.searchParams.delete(name);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if user has a profile → if not, go to onboarding
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('display_name')
          .eq('id', user.id)
          .single();

        if (!profile || !profile.display_name) {
          redirectTo.pathname = '/onboarding';
        } else {
          redirectTo.pathname = next;
        }
      } else {
        redirectTo.pathname = next;
      }

      redirectTo.searchParams.delete('code');
      redirectTo.searchParams.delete('next');

      const response = NextResponse.redirect(redirectTo);

      // Set cookies from the exchange
      const supabaseWithCookies = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => {
                response.cookies.set(name, value, options);
              });
            },
          },
        }
      );

      await supabaseWithCookies.auth.exchangeCodeForSession(code);

      return response;
    }
  }

  // If error or no code, redirect to auth
  redirectTo.pathname = '/auth';
  redirectTo.searchParams.delete('code');
  redirectTo.searchParams.delete('next');
  return NextResponse.redirect(redirectTo);
}
