'use client';

import { useEffect, useState } from 'react';

const FRIEND_CODE_RE = /^[A-F0-9]{8}$/;

export function CopyFriendCodeClient({ code: rawCode }: { code: string }) {
  const code = rawCode.trim().toUpperCase();
  const [status, setStatus] = useState('コピー中…');

  useEffect(() => {
    if (!FRIEND_CODE_RE.test(code)) {
      setStatus('無効なコードです。Bot の DM で /friend code を実行してください。');
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => setStatus(`コピーしました: ${code}`))
      .catch(() => setStatus(`コード: ${code}（長押しで選択してコピーしてください）`));
  }, [code]);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        lineHeight: 1.6,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <h1 style={{ margin: '0 0 12px', fontSize: 20 }}>フレンドコード</h1>
      <p style={{ margin: 0 }}>{status}</p>
      <p style={{ margin: '16px 0 0', color: '#555', fontSize: 14 }}>Discord に戻って相手にコードを送ってください。</p>
    </main>
  );
}
