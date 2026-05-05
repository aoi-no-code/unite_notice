'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const errorMessages: Record<string, string> = {
  auth: 'ログインに失敗しました。もう一度お試しください。',
  missing_code: '認証コードがありません。',
  missing_env: 'サーバー設定が不足しています（Supabase の環境変数）。',
  sync: 'アカウント同期に失敗しました。管理者に連絡してください。',
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const errorKey = searchParams.get('error');
  const errorText = errorKey ? errorMessages[errorKey] ?? 'エラーが発生しました。' : null;

  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(false);

  async function signInWithDiscord() {
    setLoading(true);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo: `${origin}/auth/callback`,
        },
      });
      if (error) throw error;
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('OAuth URL を取得できませんでした');
    } catch {
      setLoading(false);
      window.location.href = '/login?error=auth';
    }
  }

  return (
    <div className="card" style={{ maxWidth: 400 }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>ログイン</h1>
      <p style={{ margin: '0 0 24px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
        このアプリは Discord アカウントでのみログインできます。
      </p>

      {errorText ? (
        <p
          role="alert"
          style={{
            margin: '0 0 20px',
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255, 64, 64, 0.12)',
            border: '1px solid rgba(255, 64, 64, 0.35)',
            fontSize: 14,
          }}
        >
          {errorText}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void signInWithDiscord()}
        disabled={loading}
        className="btn btn-primary"
        style={{ width: '100%', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.75 : 1 }}
      >
        <DiscordGlyph />
        {loading ? 'リダイレクト中…' : 'Discord で続ける'}
      </button>

      <p style={{ margin: '20px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        Supabase の Authentication で Discord プロバイダを有効にし、リダイレクト URL に{' '}
        <code style={{ wordBreak: 'break-all' }}>/auth/callback</code> を登録してください。
      </p>
    </div>
  );
}

function DiscordGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.125-.094.25-.192.373-.292a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.121.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
  );
}
