import Stripe from 'stripe';
import { getServiceClient } from './db';
import { listDiscordFriends } from './discordFriends';

export type PlanId = 'free' | 'plus';

export type BillingState = {
  discordUserId: string;
  planId: PlanId;
  maxFriendSlots: number;
  paidAt: string | null;
};

export const PLANS: Record<
  PlanId,
  { id: PlanId; label: string; maxFriends: number; priceYen: number; description: string }
> = {
  free: {
    id: 'free',
    label: '無料',
    maxFriends: 3,
    priceYen: 0,
    description: 'フレンド3人まで無料',
  },
  plus: {
    id: 'plus',
    label: 'Plus',
    maxFriends: 5,
    priceYen: 300,
    description: 'フレンド5人まで（300円・買い切り）',
  },
};

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

export async function ensureBilling(discordUserId: string): Promise<BillingState> {
  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('discord_user_billing')
    .select('discord_user_id,plan_id,max_friend_slots,paid_at')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();

  if (existing) {
    return {
      discordUserId,
      planId: existing.plan_id as PlanId,
      maxFriendSlots: existing.max_friend_slots as number,
      paidAt: (existing.paid_at as string | null) ?? null,
    };
  }

  const free = PLANS.free;
  const { error } = await svc.from('discord_user_billing').insert({
    discord_user_id: discordUserId,
    plan_id: free.id,
    max_friend_slots: free.maxFriends,
  });
  if (error) throw error;

  return {
    discordUserId,
    planId: free.id,
    maxFriendSlots: free.maxFriends,
    paidAt: null,
  };
}

export async function countDiscordFriends(discordUserId: string): Promise<number> {
  const friends = await listDiscordFriends(discordUserId);
  return friends.length;
}

export async function canAddFriend(discordUserId: string): Promise<{
  ok: boolean;
  current: number;
  max: number;
  planId: PlanId;
}> {
  const billing = await ensureBilling(discordUserId);
  const current = await countDiscordFriends(discordUserId);
  return {
    ok: current < billing.maxFriendSlots,
    current,
    max: billing.maxFriendSlots,
    planId: billing.planId,
  };
}

export function formatPlanStatus(billing: BillingState, friendCount: number): string {
  const plan = PLANS[billing.planId];
  const lines = [
    `**現在のプラン:** ${plan.label}（${plan.maxFriends}人まで）`,
    `**フレンド:** ${friendCount}/${billing.maxFriendSlots}人`,
  ];
  if (billing.planId === 'free') {
    lines.push('', `5人まで使うには **${PLANS.plus.priceYen}円** のアップグレードが必要です。`, '`/plan upgrade` で決済ページを開けます。');
  } else if (billing.paidAt) {
    lines.push('', `アップグレード済み（${new Date(billing.paidAt).toLocaleString('ja-JP')}）`);
  }
  return lines.join('\n');
}

export async function applyPlusPlan(discordUserId: string, checkoutSessionId: string): Promise<void> {
  const plus = PLANS.plus;
  const svc = getServiceClient();
  const now = new Date().toISOString();
  const { error } = await svc.from('discord_user_billing').upsert(
    {
      discord_user_id: discordUserId,
      plan_id: plus.id,
      max_friend_slots: plus.maxFriends,
      stripe_checkout_session_id: checkoutSessionId,
      paid_at: now,
      updated_at: now,
    },
    { onConflict: 'discord_user_id' }
  );
  if (error) throw error;
}

export async function createPlusCheckoutSession(discordUserId: string): Promise<string> {
  const billing = await ensureBilling(discordUserId);
  if (billing.planId === 'plus') {
    throw new Error('already_plus');
  }

  const priceId = process.env.STRIPE_PRICE_PLUS;
  if (!priceId) throw new Error('STRIPE_PRICE_PLUS is not set');

  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('APP_BASE_URL is not set');

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { discord_user_id: discordUserId },
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
  });

  if (!session.url) throw new Error('Stripe checkout URL missing');
  return session.url;
}

export async function handleStripeCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const discordUserId = session.metadata?.discord_user_id;
  if (!discordUserId) throw new Error('discord_user_id missing in checkout metadata');
  if (session.payment_status !== 'paid') return;
  await applyPlusPlan(discordUserId, session.id);
}
