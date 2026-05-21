import { getServiceClient } from './db';

export type AcceptInviteResult =
  | { ok: true; inviterDiscordUserId: string }
  | { ok: false; reason: 'not_found' | 'used' | 'expired' | 'self' };

export type InvitePreview = {
  token: string;
  inviterDiscordUserId: string;
  expiresAt: string;
  used: boolean;
  expired: boolean;
};

export async function getFriendInvitePreview(token: string): Promise<InvitePreview | null> {
  const svc = getServiceClient();
  const { data: invite } = await svc
    .from('discord_friend_invites')
    .select('token,inviter_discord_user_id,expires_at,used_by_discord_user_id')
    .eq('token', token)
    .maybeSingle();
  if (!invite) return null;
  const expiresAt = invite.expires_at as string;
  return {
    token: invite.token as string,
    inviterDiscordUserId: invite.inviter_discord_user_id as string,
    expiresAt,
    used: Boolean(invite.used_by_discord_user_id),
    expired: new Date(expiresAt).getTime() < Date.now(),
  };
}

export async function acceptFriendInvite(
  token: string,
  inviteeDiscordUserId: string
): Promise<AcceptInviteResult> {
  const svc = getServiceClient();
  const { data: invite } = await svc
    .from('discord_friend_invites')
    .select('token,inviter_discord_user_id,expires_at,used_by_discord_user_id')
    .eq('token', token)
    .maybeSingle();

  if (!invite) return { ok: false, reason: 'not_found' };
  if (invite.used_by_discord_user_id) return { ok: false, reason: 'used' };
  if (new Date(invite.expires_at as string).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const inviterDiscordUserId = invite.inviter_discord_user_id as string;
  if (inviterDiscordUserId === inviteeDiscordUserId) return { ok: false, reason: 'self' };

  const { low, high } =
    inviterDiscordUserId < inviteeDiscordUserId
      ? { low: inviterDiscordUserId, high: inviteeDiscordUserId }
      : { low: inviteeDiscordUserId, high: inviterDiscordUserId };

  await svc.from('discord_friendships').upsert(
    {
      user_low_discord_id: low,
      user_high_discord_id: high,
      source: 'invite_link',
    },
    { onConflict: 'user_low_discord_id,user_high_discord_id' }
  );

  await svc
    .from('discord_friend_invites')
    .update({ used_by_discord_user_id: inviteeDiscordUserId, used_at: new Date().toISOString() })
    .eq('token', token);

  return { ok: true, inviterDiscordUserId };
}

export function buildFriendInviteUrl(token: string): string {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/friend/${token}`;
}
