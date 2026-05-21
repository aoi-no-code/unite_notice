import Link from 'next/link';
import type { ReactNode } from 'react';
import { getFriendInvitePreview } from '@/lib/discordFriendInvite';

const ERROR_MESSAGES: Record<string, string> = {
  invalid: '招待が見つからないか、無効です。',
  used: 'この招待はすでに使用されています。',
  expired: 'この招待は有効期限切れです。',
  self: '自分の招待リンクは使えません。',
  cancelled: 'Discord 連携がキャンセルされました。',
  oauth: 'Discord 連携に失敗しました。もう一度お試しください。',
  config: 'サーバー設定が不足しています（管理者に連絡してください）。',
  failed: 'フレンド追加に失敗しました。',
};

type Props = {
  params: { token: string };
  searchParams: { ok?: string; error?: string };
};

export default async function FriendInvitePage({ params, searchParams }: Props) {
  const token = params.token?.trim() ?? '';
  const validToken = /^[a-f0-9]{24}$/i.test(token);

  if (!validToken) {
    return (
      <InviteShell title="招待リンクが無効です">
        <p className="muted">URL を確認してください。</p>
      </InviteShell>
    );
  }

  if (searchParams.ok === '1') {
    return (
      <InviteShell title="フレンド追加が完了しました">
        <p>Bot の DM で <code>/play</code> を使ってフレンドのプレイ状況を確認できます。</p>
        <p className="muted">まだの場合は Bot に <code>/register ゲーム内ID</code> を実行してください。</p>
      </InviteShell>
    );
  }

  const errorKey = searchParams.error;
  if (errorKey) {
    return (
      <InviteShell title="フレンド追加できませんでした">
        <p>{ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.failed}</p>
        <p className="muted">
          手動で受け付ける場合: Bot の DM で <code>/friend accept {token}</code>
        </p>
      </InviteShell>
    );
  }

  const preview = await getFriendInvitePreview(token);
  if (!preview) {
    return (
      <InviteShell title="招待が見つかりません">
        <p className="muted">リンクの有効期限（7日）が切れているか、URL が間違っています。</p>
      </InviteShell>
    );
  }

  if (preview.used) {
    return (
      <InviteShell title="すでに使用済みの招待です">
        <p className="muted">招待者に新しいリンクを発行してもらってください（Bot DM で /friend invite）。</p>
      </InviteShell>
    );
  }

  if (preview.expired) {
    return (
      <InviteShell title="招待の有効期限が切れています">
        <p className="muted">招待者に /friend invite で新しいリンクを発行してもらってください。</p>
      </InviteShell>
    );
  }

  const expires = new Date(preview.expiresAt).toLocaleString('ja-JP');

  return (
    <InviteShell title="UniteFriends フレンド招待">
      <p>
        Discord ユーザー <strong>@{preview.inviterDiscordUserId}</strong> からフレンド招待が届いています。
      </p>
      <p className="muted">有効期限: {expires}</p>
      <a className="btn btn-primary" href={`/api/friend-invites/authorize?token=${token}`}>
        Discord で承認してフレンド追加
      </a>
      <p className="muted small">
        ボタンで Discord ログイン後、自動でフレンド登録します。
        <br />
        うまくいかない場合は Bot の DM で <code>/friend accept {token}</code>
      </p>
    </InviteShell>
  );
}

function InviteShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="invite-page">
      <div className="invite-card">
        <h1>{title}</h1>
        <div className="invite-body">{children}</div>
        <p className="muted small">
          <Link href="/">UniteFriends</Link>
        </p>
      </div>
    </main>
  );
}
