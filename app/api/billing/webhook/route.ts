import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * Stripe Webhook（無効化）
 * PayPay 手動確認に移行したため、Stripe イベントは処理しません。
 * 復帰時は git 履歴の handleStripeCheckoutCompleted 等を参照してください。
 */
export async function POST(_req: NextRequest) {
  return new Response(
    JSON.stringify({
      error: 'stripe_disabled',
      message: 'Stripe webhook is disabled. Premium uses PayPay manual review via /premium.',
    }),
    { status: 410, headers: { 'Content-Type': 'application/json' } }
  );
}
