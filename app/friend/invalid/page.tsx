import Link from 'next/link';

export default function InvalidFriendInvitePage() {
  return (
    <main className="invite-page">
      <div className="invite-card">
        <h1>招待リンクが無効です</h1>
        <p className="muted">URL を確認するか、招待者に新しいリンクを発行してもらってください。</p>
        <p className="muted small">
          <Link href="/">UniteFriends</Link>
        </p>
      </div>
    </main>
  );
}
