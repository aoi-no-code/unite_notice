export default function BillingCancelPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 12px' }}>決済をキャンセルしました</h1>
      <p style={{ margin: 0 }}>プランは変更されていません。再度アップグレードする場合は Bot の DM で `/plan upgrade` を実行してください。</p>
    </main>
  );
}
