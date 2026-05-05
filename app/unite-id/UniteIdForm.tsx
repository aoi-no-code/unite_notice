'use client';

import { useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type Props = {
  nextPath: string;
};

export function UniteIdForm({ nextPath }: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (sessionError || !token) {
        throw new Error('セッションが無効です。再ログインしてください。');
      }

      const res = await fetch('/api/me/unite-id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ unite_trainer_id: value }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? '登録に失敗しました');
      window.location.href = nextPath;
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>トレーナーIDを登録</h1>
      <p style={{ margin: '0 0 18px', color: 'var(--muted)', lineHeight: 1.6 }}>
        初回利用のため、トレーナーID（英数字）を登録してください。
      </p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="例: AB12CD34"
        autoComplete="off"
        className="input"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={loading}
        className="btn btn-primary"
        style={{ marginTop: 12, width: '100%', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.8 : 1 }}
      >
        {loading ? '登録中…' : '登録して続行'}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 12, color: '#ff8181', fontSize: 14 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
