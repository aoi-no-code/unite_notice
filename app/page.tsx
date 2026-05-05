import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { FriendRequestPanel } from './FriendRequestPanel';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  let displayName: string | null = null;
  let userId: string | null = null;
  let trainerName: string | null = null;
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    if (userId) {
      const { data: profile } = await supabase
        .from('users')
        .select('unite_trainer_id, trainer_name')
        .eq('id', userId)
        .maybeSingle();
      if (!profile?.unite_trainer_id) {
        redirect('/unite-id?next=/');
      }
      trainerName = profile.trainer_name ?? null;
    }
    const meta = user?.user_metadata as Record<string, string | undefined> | undefined;
    displayName =
      user?.email ??
      meta?.full_name ??
      meta?.name ??
      meta?.preferred_username ??
      meta?.user_name ??
      null;
  } catch {
    displayName = null;
  }

  return (
    <main className="container">
      <h1 style={{ fontSize: 'clamp(22px, 6vw, 26px)', margin: '0 0 12px' }}>Pokemon UNITE Notice</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 28px', lineHeight: 1.6 }}>
        フレンドのログイン状況を Discord で通知するアプリです。
      </p>

      {!displayName ? <p style={{ marginBottom: 20, color: 'var(--muted)' }}>未ログインです。</p> : null}
      {displayName && trainerName ? (
        <p style={{ marginBottom: 20, color: 'var(--muted)' }}>トレーナーネーム: {trainerName}</p>
      ) : null}

      <div className="actions">
        {!displayName ? (
          <Link
            href="/login"
            className="btn btn-primary"
          >
            ログイン
          </Link>
        ) : (
          <a
            href="/auth/signout"
            className="btn"
          >
            ログアウト
          </a>
        )}
      </div>
      {userId ? <FriendRequestPanel /> : null}
    </main>
  );
}
