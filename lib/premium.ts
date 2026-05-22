import { buildPremiumIntroContent, COPY } from './botCopy';
import { getServiceClient } from './db';
import { sendDiscord, sendDiscordDM } from './discord';
import {
  addPremiumRole,
  fetchDiscordUser,
  formatDiscordDisplayName,
  removePremiumRole,
} from './discordRoles';
import { applyFreePlan, PLANS } from './billing';

export const PREMIUM_REPORT_BUTTON_ID = 'premium:pay:report';
export const PREMIUM_MODAL_ID = 'premium:pay:modal';

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';
export type PremiumStatus = 'active' | 'inactive';

export type PremiumConfig = {
  priceYen: number;
  premiumDays: number;
  qrImageUrl: string;
  adminReviewChannelId: string;
};

type PaymentRequestRow = {
  id: string;
  discord_user_id: string;
  discord_username: string | null;
  amount: number;
  payer_name: string;
  paid_at: string;
  note: string | null;
  status: PaymentRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

type PremiumRow = {
  discord_user_id: string;
  premium_status: PremiumStatus;
  premium_until: string | null;
  premium_source: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function getPremiumConfig(): PremiumConfig {
  const qrImageUrl = process.env.PAYPAY_QR_IMAGE_URL?.trim();
  const adminReviewChannelId = process.env.ADMIN_REVIEW_CHANNEL_ID?.trim();
  if (!qrImageUrl) throw new Error('PAYPAY_QR_IMAGE_URL is not set');
  if (!adminReviewChannelId) throw new Error('ADMIN_REVIEW_CHANNEL_ID is not set');

  const priceYen = Number.parseInt(process.env.PREMIUM_PRICE ?? '300', 10);
  const premiumDays = Number.parseInt(process.env.PREMIUM_DAYS ?? '30', 10);
  if (!Number.isFinite(priceYen) || priceYen <= 0) throw new Error('PREMIUM_PRICE is invalid');
  if (!Number.isFinite(premiumDays) || premiumDays <= 0) throw new Error('PREMIUM_DAYS is invalid');

  return { priceYen, premiumDays, qrImageUrl, adminReviewChannelId };
}

export function isPremiumRowActive(row: PremiumRow | null | undefined): boolean {
  if (!row || row.premium_status !== 'active') return false;
  if (!row.premium_until) return false;
  return new Date(row.premium_until).getTime() > Date.now();
}

export async function getPremiumRow(discordUserId: string): Promise<PremiumRow | null> {
  const svc = getServiceClient();
  const { data } = await svc
    .from('discord_user_premium')
    .select('discord_user_id,premium_status,premium_until,premium_source')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();
  return (data as PremiumRow | null) ?? null;
}

export async function ensurePremiumRow(discordUserId: string): Promise<PremiumRow> {
  const existing = await getPremiumRow(discordUserId);
  if (existing) {
    if (isPremiumRowActive(existing)) return existing;
    if (existing.premium_status === 'active') {
      await deactivatePremium(discordUserId, { removeRole: true });
      return (await getPremiumRow(discordUserId))!;
    }
    return existing;
  }

  const svc = getServiceClient();
  const { error } = await svc.from('discord_user_premium').insert({
    discord_user_id: discordUserId,
    premium_status: 'inactive',
    updated_at: nowIso(),
  });
  if (error) throw error;

  return {
    discord_user_id: discordUserId,
    premium_status: 'inactive',
    premium_until: null,
    premium_source: null,
  };
}

export function buildPremiumIntroPayload(): {
  content: string;
  embeds: unknown[];
  components: unknown[];
} {
  const { priceYen, qrImageUrl } = getPremiumConfig();
  return {
    content: buildPremiumIntroContent(priceYen),
    embeds: [
      {
        title: COPY.premium.qrEmbedTitle,
        image: { url: qrImageUrl },
        color: 0x00b900,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: COPY.premium.reportBtn,
            custom_id: PREMIUM_REPORT_BUTTON_ID,
          },
        ],
      },
    ],
  };
}

export function buildPaymentReportModal() {
  const { priceYen } = getPremiumConfig();
  return {
    custom_id: PREMIUM_MODAL_ID,
    title: '支払いの報告',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'payer_name',
            label: 'PayPay送金名義',
            style: 1,
            required: true,
            max_length: 50,
            placeholder: '例: ヤマダタロウ',
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'amount',
            label: '送金金額（円）',
            style: 1,
            required: true,
            max_length: 10,
            placeholder: String(priceYen),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'paid_at',
            label: '送金日時',
            style: 1,
            required: true,
            max_length: 40,
            placeholder: '例: 2026/5/22 14:30',
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'note',
            label: '備考（任意）',
            style: 2,
            required: false,
            max_length: 500,
            placeholder: '送金時のメモなど',
          },
        ],
      },
    ],
  };
}

function parseModalField(values: Array<{ custom_id: string; value: string }>, id: string): string {
  return values.find((v) => v.custom_id === id)?.value?.trim() ?? '';
}

function parsePaidAt(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, '/').replace(/-/g, '/');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const jp = trimmed.match(/^(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?\s*(\d{1,2})?:?(\d{1,2})?/);
  if (jp) {
    const y = Number(jp[1]);
    const m = Number(jp[2]) - 1;
    const d = Number(jp[3]);
    const hh = Number(jp[4] ?? 0);
    const mm = Number(jp[5] ?? 0);
    const dt = new Date(y, m, d, hh, mm);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

export async function hasPendingPaymentRequest(discordUserId: string): Promise<boolean> {
  const svc = getServiceClient();
  const { data } = await svc
    .from('payment_requests')
    .select('id')
    .eq('discord_user_id', discordUserId)
    .eq('status', 'pending')
    .maybeSingle();
  return Boolean(data?.id);
}

export async function createPaymentRequest(
  discordUserId: string,
  discordUsername: string,
  modalValues: Array<{ custom_id: string; value: string }>
): Promise<{ ok: true; requestId: string } | { ok: false; reason: string; message: string }> {
  if (await hasPendingPaymentRequest(discordUserId)) {
    return {
      ok: false,
      reason: 'pending_exists',
      message: 'すでに確認待ちの申請があります。承認または却下されるまで、新しい申請はできません。',
    };
  }

  const premium = await ensurePremiumRow(discordUserId);
  if (isPremiumRowActive(premium)) {
    return {
      ok: false,
      reason: 'already_premium',
      message: 'すでにプレミアムが有効です。期限切れ後に再度お申し込みください。',
    };
  }

  const payerName = parseModalField(modalValues, 'payer_name');
  const amountRaw = parseModalField(modalValues, 'amount');
  const paidAtRaw = parseModalField(modalValues, 'paid_at');
  const note = parseModalField(modalValues, 'note') || null;

  if (!payerName) {
    return { ok: false, reason: 'invalid_input', message: 'PayPay送金名義を入力してください。' };
  }

  const amount = Number.parseInt(amountRaw.replace(/[,，]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_input', message: '送金金額は正の数値で入力してください。' };
  }

  const paidAt = parsePaidAt(paidAtRaw);
  if (!paidAt) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: '送金日時を認識できませんでした。例: 2026/5/22 14:30 の形式で入力してください。',
    };
  }

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('payment_requests')
    .insert({
      discord_user_id: discordUserId,
      discord_username: discordUsername,
      amount,
      payer_name: payerName,
      paid_at: paidAt.toISOString(),
      note,
      status: 'pending',
      updated_at: nowIso(),
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        reason: 'pending_exists',
        message: 'すでに確認待ちの申請があります。しばらくお待ちください。',
      };
    }
    throw error;
  }

  const requestId = data.id as string;
  await notifyAdminPaymentRequest(requestId);
  return { ok: true, requestId };
}

async function getPaymentRequest(requestId: string): Promise<PaymentRequestRow | null> {
  const svc = getServiceClient();
  const { data } = await svc.from('payment_requests').select('*').eq('id', requestId).maybeSingle();
  return (data as PaymentRequestRow | null) ?? null;
}

function formatAdminRequestMessage(req: PaymentRequestRow): string {
  return [
    '**新しい支払い申請**',
    `申請者: ${req.discord_username ?? '不明'} (<@${req.discord_user_id}>)`,
    `DiscordユーザーID: \`${req.discord_user_id}\``,
    `金額: **${req.amount}円**`,
    `PayPay名義: ${req.payer_name}`,
    `送金日時: ${new Date(req.paid_at).toLocaleString('ja-JP')}`,
    req.note ? `備考: ${req.note}` : null,
    '',
    '※ 申請者からスクリーンショットがDMで届くまで、内容を照合してください。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function notifyAdminPaymentRequest(requestId: string): Promise<void> {
  const req = await getPaymentRequest(requestId);
  if (!req) return;
  const { adminReviewChannelId } = getPremiumConfig();
  await sendDiscord(adminReviewChannelId, {
    content: formatAdminRequestMessage(req),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: '承認', custom_id: `premium:req:approve:${requestId}` },
          { type: 2, style: 4, label: '却下', custom_id: `premium:req:reject:${requestId}` },
        ],
      },
    ],
  });
}

async function applyPlusBilling(discordUserId: string, paidAt: string): Promise<void> {
  const plus = PLANS.plus;
  const svc = getServiceClient();
  const { error } = await svc.from('discord_user_billing').upsert(
    {
      discord_user_id: discordUserId,
      plan_id: plus.id,
      max_friend_slots: plus.maxFriends,
      paid_at: paidAt,
      updated_at: nowIso(),
    },
    { onConflict: 'discord_user_id' }
  );
  if (error) throw error;
}

async function activatePremium(
  discordUserId: string,
  premiumUntil: Date,
  source: 'paypay_manual'
): Promise<void> {
  const svc = getServiceClient();
  const { error } = await svc.from('discord_user_premium').upsert(
    {
      discord_user_id: discordUserId,
      premium_status: 'active',
      premium_until: premiumUntil.toISOString(),
      premium_source: source,
      updated_at: nowIso(),
    },
    { onConflict: 'discord_user_id' }
  );
  if (error) throw error;
  await applyPlusBilling(discordUserId, nowIso());
  try {
    await addPremiumRole(discordUserId);
  } catch (err) {
    console.error('[premium] addPremiumRole failed', discordUserId, err);
    throw new Error('role_grant_failed');
  }
}

export async function deactivatePremium(
  discordUserId: string,
  opts?: { removeRole?: boolean }
): Promise<void> {
  const svc = getServiceClient();
  const { error } = await svc.from('discord_user_premium').upsert(
    {
      discord_user_id: discordUserId,
      premium_status: 'inactive',
      premium_until: null,
      updated_at: nowIso(),
    },
    { onConflict: 'discord_user_id' }
  );
  if (error) throw error;
  await applyFreePlan(discordUserId);
  if (opts?.removeRole !== false) {
    try {
      await removePremiumRole(discordUserId);
    } catch (err) {
      console.error('[premium] removePremiumRole failed', discordUserId, err);
    }
  }
}

export type ReviewResult =
  | { ok: true; request: PaymentRequestRow }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'forbidden' | 'role_grant_failed'; message: string };

export async function approvePaymentRequest(
  requestId: string,
  reviewerDiscordId: string
): Promise<ReviewResult> {
  const req = await getPaymentRequest(requestId);
  if (!req) return { ok: false, reason: 'not_found', message: '申請が見つかりません。' };
  if (req.status !== 'pending') {
    return { ok: false, reason: 'not_pending', message: 'この申請はすでに処理済みです。' };
  }

  const { premiumDays } = getPremiumConfig();
  const premiumUntil = new Date();
  premiumUntil.setDate(premiumUntil.getDate() + premiumDays);

  const svc = getServiceClient();
  const reviewedAt = nowIso();
  const { data: updated, error } = await svc
    .from('payment_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewerDiscordId,
      reviewed_at: reviewedAt,
      updated_at: reviewedAt,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!updated) {
    return { ok: false, reason: 'not_pending', message: 'この申請はすでに処理済みです。' };
  }

  try {
    await activatePremium(req.discord_user_id, premiumUntil, 'paypay_manual');
  } catch (err) {
    await svc
      .from('payment_requests')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null, updated_at: nowIso() })
      .eq('id', requestId);
    const message =
      err instanceof Error && err.message === 'role_grant_failed'
        ? 'Premiumロールの付与に失敗しました。Botの権限とロール順序を確認してください。'
        : '承認処理中にエラーが発生しました。';
    return { ok: false, reason: 'role_grant_failed', message };
  }

  const untilLabel = premiumUntil.toLocaleString('ja-JP');
  try {
    await sendDiscordDM(req.discord_user_id, {
      content: COPY.premium.approvedDm(untilLabel),
    });
  } catch {
    // DM失敗は握りつぶす
  }

  const { adminReviewChannelId } = getPremiumConfig();
  await sendDiscord(adminReviewChannelId, {
    content: [
      '**承認済み**',
      `申請ID: \`${requestId}\``,
      `対象: <@${req.discord_user_id}>（${req.discord_username ?? '不明'}）`,
      `承認者: <@${reviewerDiscordId}>`,
      `有効期限: ${untilLabel}`,
    ].join('\n'),
  });

  return { ok: true, request: updated as PaymentRequestRow };
}

export async function rejectPaymentRequest(
  requestId: string,
  reviewerDiscordId: string
): Promise<ReviewResult> {
  const req = await getPaymentRequest(requestId);
  if (!req) return { ok: false, reason: 'not_found', message: '申請が見つかりません。' };
  if (req.status !== 'pending') {
    return { ok: false, reason: 'not_pending', message: 'この申請はすでに処理済みです。' };
  }

  const svc = getServiceClient();
  const reviewedAt = nowIso();
  const { data: updated, error } = await svc
    .from('payment_requests')
    .update({
      status: 'rejected',
      reviewed_by: reviewerDiscordId,
      reviewed_at: reviewedAt,
      updated_at: reviewedAt,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!updated) {
    return { ok: false, reason: 'not_pending', message: 'この申請はすでに処理済みです。' };
  }

  try {
    await sendDiscordDM(req.discord_user_id, {
      content: COPY.premium.rejectedDm,
    });
  } catch {
    // ignore
  }

  const { adminReviewChannelId } = getPremiumConfig();
  await sendDiscord(adminReviewChannelId, {
    content: [
      '**却下済み**',
      `申請ID: \`${requestId}\``,
      `対象: <@${req.discord_user_id}>（${req.discord_username ?? '不明'}）`,
      `処理者: <@${reviewerDiscordId}>`,
    ].join('\n'),
  });

  return { ok: true, request: updated as PaymentRequestRow };
}

export function formatPremiumStatusForUser(premium: PremiumRow | null): string {
  if (isPremiumRowActive(premium)) {
    const until = new Date(premium!.premium_until!).toLocaleString('ja-JP');
    return COPY.plan.premiumActive(until);
  }
  if (premium?.premium_status === 'active') {
    return COPY.plan.premiumExpired;
  }
  return COPY.plan.premiumInactive;
}

export async function processExpiredPremiums(): Promise<{ expired: number }> {
  const svc = getServiceClient();
  const now = nowIso();
  const { data: rows, error } = await svc
    .from('discord_user_premium')
    .select('discord_user_id,premium_status,premium_until')
    .eq('premium_status', 'active')
    .lt('premium_until', now);

  if (error) throw error;
  let expired = 0;
  for (const row of rows ?? []) {
    await deactivatePremium(row.discord_user_id as string);
    expired += 1;
    try {
      await sendDiscordDM(row.discord_user_id as string, {
        content: COPY.premium.expiredDm,
      });
    } catch {
      // ignore
    }
  }
  return { expired };
}

export async function resolveDiscordUsername(
  discordUserId: string,
  fallback?: string
): Promise<string> {
  if (fallback?.trim()) return fallback.trim();
  try {
    const user = await fetchDiscordUser(discordUserId);
    return formatDiscordDisplayName(user);
  } catch {
    return '不明';
  }
}
