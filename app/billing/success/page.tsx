export default function BillingSuccessPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 12px' }}>お支払いありがとうございます</h1>
      <p style={{ margin: 0 }}>Plus プラン（フレンド5人まで）が有効になりました。</p>
      <p style={{ margin: '16px 0 0', color: '#555' }}>Discord に戻り、`/plan` で反映を確認してください。</p>
    </main>
  );
}
