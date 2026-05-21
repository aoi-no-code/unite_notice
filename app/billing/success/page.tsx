export default function BillingSuccessPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 12px' }}>ご契約ありがとうございます</h1>
      <p style={{ margin: 0 }}>Plus プラン（フレンド5人まで・月額300円）の申し込みが完了しました。</p>
      <p style={{ margin: '16px 0 0', color: '#555' }}>
        Discord に戻り、`/plan info` で反映を確認してください。解約は `/plan portal` から行えます。
      </p>
    </main>
  );
}
