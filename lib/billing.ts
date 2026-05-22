import { ACTIVE_FRIEND_SLOT_LIMIT, BILLING_FEATURE_ENABLED, COPY } from './botCopy';
import { getServiceClient } from './db';
import { listDiscordFriends } from './discordFriends';
import { getPremiumRow, isPremiumRowActive } from './premium';

export type PlanId = 'free' | 'plus';

/** @deprecated Stripe サブスク状態（PayPay手動確認に移行済み） */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
  | null;

export type BillingState = {
  discordUserId: string;
  planId: PlanId;
  maxFriendSlots: number;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  /** @deprecated Stripe Customer ID */
  stripeCustomerId: string | null;
  premiumUntil: string | null;
};

type BillingRow = {
  discord_user_id: string;
  plan_id: string;
  max_friend_slots: number;
  paid_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
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
    label: 'Plus（プレミアム）',
    maxFriends: 5,
    priceYen: 300,
    description: 'フレンド5人まで（PayPay・月額）',
  },
};

async function isPlusActive(discordUserId: string, row: BillingRow): Promise<boolean> {
  const premium = await getPremiumRow(discordUserId);
  if (isPremiumRowActive(premium)) return true;

  // --- Stripe（無効化・後で復帰可能） ---
  // const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
  // if (row.stripe_subscription_id) { ... }
  return false;
}

function rowToBillingState(row: BillingRow, plusActive: boolean, premiumUntil: string | null): BillingState {
  const planId: PlanId = plusActive ? 'plus' : 'free';
  const plan = PLANS[planId];
  return {
    discordUserId: row.discord_user_id,
    planId,
    maxFriendSlots: plan.maxFriends,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    currentPeriodEnd: premiumUntil ?? row.current_period_end,
    stripeCustomerId: row.stripe_customer_id,
    premiumUntil,
  };
}

export async function ensureBilling(discordUserId: string): Promise<BillingState> {
  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('discord_user_billing')
    .select(
      'discord_user_id,plan_id,max_friend_slots,paid_at,stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end'
    )
    .eq('discord_user_id', discordUserId)
    .maybeSingle();

  const premium = await getPremiumRow(discordUserId);
  const premiumUntil = isPremiumRowActive(premium) ? premium!.premium_until : null;

  if (existing) {
    const plusActive = await isPlusActive(discordUserId, existing as BillingRow);
    const state = rowToBillingState(existing as BillingRow, plusActive, premiumUntil);
    if (state.planId === 'free' && (existing as BillingRow).plan_id === 'plus' && !plusActive) {
      await applyFreePlan(discordUserId);
      return ensureBilling(discordUserId);
    }
    return state;
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
    subscriptionStatus: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    premiumUntil: null,
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
  const current = await countDiscordFriends(discordUserId);
  if (!BILLING_FEATURE_ENABLED) {
    const max = ACTIVE_FRIEND_SLOT_LIMIT;
    return {
      ok: current < max,
      current,
      max,
      planId: 'free',
    };
  }

  const billing = await ensureBilling(discordUserId);
  return {
    ok: current < billing.maxFriendSlots,
    current,
    max: billing.maxFriendSlots,
    planId: billing.planId,
  };
}

export function formatPlanStatus(billing: BillingState, friendCount: number): string {
  if (!BILLING_FEATURE_ENABLED) {
    const free = PLANS.free;
    return [
      COPY.plan.currentPlan(free.label, ACTIVE_FRIEND_SLOT_LIMIT),
      COPY.plan.friendCount(friendCount, ACTIVE_FRIEND_SLOT_LIMIT),
      '',
      COPY.billing.wip,
    ].join('\n');
  }

  const plan = PLANS[billing.planId];
  const lines = [
    COPY.plan.currentPlan(plan.label, plan.maxFriends),
    COPY.plan.friendCount(friendCount, billing.maxFriendSlots),
  ];
  if (billing.planId === 'plus') {
    if (billing.premiumUntil || billing.currentPeriodEnd) {
      const end = billing.premiumUntil ?? billing.currentPeriodEnd;
      lines.push(COPY.plan.premiumUntil(new Date(end!).toLocaleString('ja-JP')));
    }
    lines.push('', COPY.plan.premiumRenew);
  } else {
    const price = process.env.PREMIUM_PRICE ?? String(PLANS.plus.priceYen);
    lines.push('', COPY.plan.premiumUpsell(price));
  }
  return lines.join('\n');
}

export async function applyFreePlan(discordUserId: string): Promise<void> {
  const free = PLANS.free;
  const svc = getServiceClient();
  const now = new Date().toISOString();
  const { error } = await svc.from('discord_user_billing').upsert(
    {
      discord_user_id: discordUserId,
      plan_id: free.id,
      max_friend_slots: free.maxFriends,
      subscription_status: 'canceled',
      updated_at: now,
    },
    { onConflict: 'discord_user_id' }
  );
  if (error) throw error;
}

// =============================================================================
// Stripe（無効化 — PayPay手動確認に移行。復帰時はコメントを戻して利用）
// =============================================================================

const STRIPE_DISABLED_MESSAGE =
  'Stripe課金は現在無効です。`/premium` からPayPay送金でお申し込みください。';

/** @deprecated */
export async function createPlusCheckoutSession(_discordUserId: string): Promise<string> {
  throw new Error(STRIPE_DISABLED_MESSAGE);
}

/** @deprecated */
export async function createBillingPortalSession(_discordUserId: string): Promise<string> {
  throw new Error(STRIPE_DISABLED_MESSAGE);
}

/** @deprecated */
export async function handleStripeCheckoutCompleted(_session: unknown): Promise<void> {
  throw new Error(STRIPE_DISABLED_MESSAGE);
}

/** @deprecated */
export async function handleStripeSubscriptionEvent(_subscription: unknown): Promise<void> {
  throw new Error(STRIPE_DISABLED_MESSAGE);
}

/*
import Stripe from 'stripe';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

export async function syncStripeSubscription(...) { ... }
async function getOrCreateStripeCustomer(...) { ... }
// 旧 Stripe Checkout / Portal / Webhook 同期ロジック
*/
