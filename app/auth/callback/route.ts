import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncPublicUserFromAuthUser } from '../../../lib/auth/syncPublicUser';
import { syncTrainerNameIfChanged } from '@/lib/trainerName';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(`${origin}/login?error=missing_env`);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    try {
      await syncPublicUserFromAuthUser(user);
      const { data: profile } = await supabase
        .from('users')
        .select('unite_trainer_id, trainer_name')
        .eq('id', user.id)
        .maybeSingle();
      if (!profile?.unite_trainer_id) {
        return NextResponse.redirect(`${origin}/unite-id?next=${encodeURIComponent(next)}`);
      }

      // ログインごとにAPIから最新トレーナーネームを同期する
      try {
        await syncTrainerNameIfChanged({
          supabase,
          userId: user.id,
          uniteTrainerId: profile.unite_trainer_id,
          currentTrainerName: profile.trainer_name ?? null,
          source: 'login',
        });
      } catch {
        // 外部API失敗時はログイン体験を優先して続行
      }
    } catch {
      return NextResponse.redirect(`${origin}/login?error=sync`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
