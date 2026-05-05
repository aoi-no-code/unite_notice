'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type FriendRow = {
  friendship_id: string;
  friend_user_id: string;
  friend_trainer_id: string | null;
  friend_discord_id: string | null;
  since: string;
};

type SlotInfo = {
  used: number;
  max: number;
  plan: string;
};

export function FriendRequestPanel() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [trainerId, setTrainerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [slot, setSlot] = useState<SlotInfo | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(true);

  async function getAccessToken(): Promise<string> {
    const { data, error: tokenError } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (tokenError || !token) throw new Error('セッションを取得できませんでした。再ログインしてください。');
    return token;
  }

  async function submitRequest() {
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/friend-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          addressee_unite_trainer_id: trainerId.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error || '申請に失敗しました');

      setTrainerId('');
      setInfo('フレンド申請を送信しました。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '申請に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadFriends() {
    setLoadingFriends(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/friendships', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { friends?: FriendRow[]; slot?: SlotInfo; error?: string };
      if (!res.ok) throw new Error(body.error || 'フレンド一覧の取得に失敗しました');
      setFriends(body.friends ?? []);
      setSlot(body.slot ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'フレンド一覧の取得に失敗しました');
    } finally {
      setLoadingFriends(false);
    }
  }

  useEffect(() => {
    void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="panel">
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>フレンド申請</h2>
      <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 14 }}>
        相手のトレーナーIDを入力して申請を送ります。
      </p>

      <div style={{ display: 'grid', gap: 10 }}>
        <input
          value={trainerId}
          onChange={(e) => setTrainerId(e.target.value.toUpperCase())}
          placeholder="相手のトレーナーID（英数字）"
          className="input"
        />
        <button
          type="button"
          onClick={() => void submitRequest()}
          disabled={submitting}
          className="btn"
          style={{ cursor: submitting ? 'wait' : 'pointer' }}
        >
          {submitting ? '送信中…' : '申請を送る'}
        </button>
      </div>

      {error ? (
        <p style={{ marginTop: 12, color: '#ff8181', fontSize: 14 }} role="alert">
          {error}
        </p>
      ) : null}
      {info ? <p style={{ marginTop: 12, color: '#9de7b3', fontSize: 14 }}>{info}</p> : null}

      <hr style={{ margin: '18px 0', borderColor: 'var(--border)', opacity: 0.4 }} />
      <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>フレンド一覧</h3>
      {slot ? (
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
          プラン: {slot.plan} / 利用枠: {slot.used} / {slot.max}
        </p>
      ) : null}
      {loadingFriends ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>読み込み中…</p>
      ) : friends.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>まだフレンドはいません。</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          {friends.map((row) => (
            <li key={row.friendship_id}>
              {row.friend_trainer_id ?? '(トレーナーID未登録)'} / {new Date(row.since).toLocaleDateString('ja-JP')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
