import Stripe from 'stripe';
import { getServiceClient } from './db';
import { listDiscordFriends } from './discordFriends';

export type PlanId = 'free' | 'plus';

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
  stripeCustomerId: string | null;
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
    label: 'Plus',
    maxFriends: 5,
    priceYen: 300,
    description: 'フレンド5人まで（月額300円）',
  },
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

function isPlusSubscriptionActive(row: BillingRow): boolean {
  if (!row.stripe_subscription_id) {
    return row.plan_id === 'plus';
  }
  const status = row.subscription_status;
  if (status && ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true;
  if (row.current_period_end) {
    return new Date(row.current_period_end).getTime() > Date.now();
  }
  return false;
}

function rowToBillingState(row: BillingRow): BillingState {
  const plusActive = isPlusSubscriptionActive(row);
  const planId: PlanId = plusActive ? 'plus' : 'free';
  const plan = PLANS[planId];
  return {
    discordUserId: row.discord_user_id,
    planId,
    maxFriendSlots: plan.maxFriends,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    currentPeriodEnd: row.current_period_end,
    stripeCustomerId: row.stripe_customer_id,
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

  if (existing) {
    const state = rowToBillingState(existing as BillingRow);
    if (state.planId === 'free' && (existing as BillingRow).plan_id === 'plus' && !isPlusSubscriptionActive(existing as BillingRow)) {
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
  if (billing.planId === 'plus') {
    if (billing.currentPeriodEnd) {
      lines.push(`**次回更新:** ${new Date(billing.currentPeriodEnd).toLocaleString('ja-JP')}`);
    }
    lines.push('', '解約・支払い方法の変更は `/plan portal` から行えます。');
  } else {
    lines.push(
      '',
      `5人まで使うには **月額${PLANS.plus.priceYen}円** の Plus プランが必要です。`,
      '`/plan upgrade` で申し込みできます。'
    );
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

export async function syncStripeSubscription(
  discordUserId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? null;

  const plusActive =
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) ||
    (subscription.status === 'canceled' && subscription.cancel_at_period_end && subscription.current_period_end * 1000 > Date.now());

  const svc = getServiceClient();
  const now = new Date().toISOString();

  if (plusActive) {
    const plus = PLANS.plus;
    const { error } = await svc.from('discord_user_billing').upsert(
      {
        discord_user_id: discordUserId,
        plan_id: plus.id,
        max_friend_slots: plus.maxFriends,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        subscription_status: subscription.status,
        current_period_end: periodEnd,
        paid_at: now,
        updated_at: now,
      },
      { onConflict: 'discord_user_id' }
    );
    if (error) throw error;
    return;
  }

  await applyFreePlan(discordUserId);
  await svc
    .from('discord_user_billing')
    .update({
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      subscription_status: subscription.status,
      current_period_end: periodEnd,
      updated_at: now,
    })
    .eq('discord_user_id', discordUserId);
}

async function getOrCreateStripeCustomer(discordUserId: string, existingCustomerId: string | null): Promise<string> {
  if (existingCustomerId) return existingCustomerId;
  const stripe = stripeClient();
  const customer = await stripe.customers.create({
    metadata: { discord_user_id: discordUserId },
  });
  const svc = getServiceClient();
  await svc
    .from('discord_user_billing')
    .upsert(
      {
        discord_user_id: discordUserId,
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'discord_user_id' }
    );
  return customer.id;
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
  const customerId = await getOrCreateStripeCustomer(discordUserId, billing.stripeCustomerId);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { discord_user_id: discordUserId },
    subscription_data: {
      metadata: { discord_user_id: discordUserId },
    },
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
  });

  if (!session.url) throw new Error('Stripe checkout URL missing');
  return session.url;
}

export async function createBillingPortalSession(discordUserId: string): Promise<string> {
  const billing = await ensureBilling(discordUserId);
  if (!billing.stripeCustomerId) {
    throw new Error('no_customer');
  }

  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('APP_BASE_URL is not set');

  const stripe = stripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: `${baseUrl}/billing/portal-return`,
  });

  if (!session.url) throw new Error('Billing portal URL missing');
  return session.url;
}

export async function handleStripeCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const discordUserId = session.metadata?.discord_user_id;
  if (!discordUserId) throw new Error('discord_user_id missing in checkout metadata');

  if (session.mode === 'subscription' && session.subscription) {
    const stripe = stripeClient();
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncStripeSubscription(discordUserId, subscription);
    return;
  }

  if (session.payment_status === 'paid') {
    const stripe = stripeClient();
    const plus = PLANS.plus;
    const svc = getServiceClient();
    const now = new Date().toISOString();
    await svc.from('discord_user_billing').upsert(
      {
        discord_user_id: discordUserId,
        plan_id: plus.id,
        max_friend_slots: plus.maxFriends,
        stripe_checkout_session_id: session.id,
        paid_at: now,
        updated_at: now,
      },
      { onConflict: 'discord_user_id' }
    );
  }
}

export async function handleStripeSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const discordUserId = subscription.metadata?.discord_user_id;
  if (!discordUserId) {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (!customerId) return;
    const svc = getServiceClient();
    const { data } = await svc
      .from('discord_user_billing')
      .select('discord_user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (!data?.discord_user_id) return;
    await syncStripeSubscription(data.discord_user_id as string, subscription);
    return;
  }
  await syncStripeSubscription(discordUserId, subscription);
}
