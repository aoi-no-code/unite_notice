import { randomBytes } from 'crypto';
import { COPY } from './botCopy';
import { canAddFriend } from './billing';
import { getServiceClient } from './db';

export type FriendProfile = {
  discordUserId: string;
  unitePlayerId: string | null;
  trainerName: string | null;
};

export type PendingRequest = {
  id: string;
  requesterDiscordUserId: string;
  requesterUniteId: string | null;
  requesterTrainerName: string | null;
  code: string;
  createdAt: string;
};

function pairDiscordIds(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

export async function areDiscordFriends(a: string, b: string): Promise<boolean> {
  const { low, high } = pairDiscordIds(a, b);
  const svc = getServiceClient();
  const { data } = await svc
    .from('discord_friendships')
    .select('user_low_discord_id')
    .eq('user_low_discord_id', low)
    .eq('user_high_discord_id', high)
    .maybeSingle();
  return Boolean(data);
}

export async function createFriendCode(ownerDiscordUserId: string): Promise<{ code: string; expiresAt: string }> {
  const svc = getServiceClient();
  const code = randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await svc.from('discord_friend_codes').insert({
    code,
    owner_discord_user_id: ownerDiscordUserId,
    expires_at: expiresAt,
  });
  return { code, expiresAt };
}

export async function submitFriendRequest(
  requesterDiscordUserId: string,
  rawCode: string
): Promise<
  | { ok: true; requestId: string; ownerDiscordUserId: string }
  | {
      ok: false;
      reason:
        | 'invalid_code'
        | 'expired'
        | 'self'
        | 'already_friends'
        | 'already_pending'
        | 'owner_not_registered'
        | 'requester_not_registered';
    }
> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false, reason: 'invalid_code' };

  const svc = getServiceClient();
  const { data: friendCode } = await svc
    .from('discord_friend_codes')
    .select('code,owner_discord_user_id,expires_at')
    .eq('code', code)
    .maybeSingle();
  if (!friendCode) return { ok: false, reason: 'invalid_code' };
  if (new Date(friendCode.expires_at as string).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const ownerDiscordUserId = friendCode.owner_discord_user_id as string;
  if (ownerDiscordUserId === requesterDiscordUserId) return { ok: false, reason: 'self' };

  if (await areDiscordFriends(ownerDiscordUserId, requesterDiscordUserId)) {
    return { ok: false, reason: 'already_friends' };
  }

  const { data: ownerProfile } = await svc
    .from('discord_user_game_profiles')
    .select('discord_user_id')
    .eq('discord_user_id', ownerDiscordUserId)
    .maybeSingle();
  if (!ownerProfile) return { ok: false, reason: 'owner_not_registered' };

  const { data: requesterProfile } = await svc
    .from('discord_user_game_profiles')
    .select('discord_user_id')
    .eq('discord_user_id', requesterDiscordUserId)
    .maybeSingle();
  if (!requesterProfile) return { ok: false, reason: 'requester_not_registered' };

  const { data: existingPending } = await svc
    .from('discord_friend_requests')
    .select('id')
    .eq('requester_discord_user_id', requesterDiscordUserId)
    .eq('owner_discord_user_id', ownerDiscordUserId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingPending) return { ok: false, reason: 'already_pending' };

  const { data: inserted, error } = await svc
    .from('discord_friend_requests')
    .insert({
      code,
      requester_discord_user_id: requesterDiscordUserId,
      owner_discord_user_id: ownerDiscordUserId,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !inserted) throw error ?? new Error('failed to insert friend request');

  return { ok: true, requestId: inserted.id as string, ownerDiscordUserId };
}

async function getProfileMap(discordUserIds: string[]): Promise<Map<string, FriendProfile>> {
  const map = new Map<string, FriendProfile>();
  if (discordUserIds.length === 0) return map;
  const svc = getServiceClient();
  const { data: rows } = await svc
    .from('discord_user_game_profiles')
    .select('discord_user_id,unite_player_id,trainer_name')
    .in('discord_user_id', discordUserIds);
  for (const row of rows ?? []) {
    map.set(row.discord_user_id as string, {
      discordUserId: row.discord_user_id as string,
      unitePlayerId: (row.unite_player_id as string | null) ?? null,
      trainerName: (row.trainer_name as string | null) ?? null,
    });
  }
  return map;
}

export async function listDiscordFriends(discordUserId: string): Promise<FriendProfile[]> {
  const svc = getServiceClient();
  const { data: rows } = await svc
    .from('discord_friendships')
    .select('user_low_discord_id,user_high_discord_id')
    .or(`user_low_discord_id.eq.${discordUserId},user_high_discord_id.eq.${discordUserId}`);
  const friendIds = (rows ?? []).map((row) =>
    row.user_low_discord_id === discordUserId ? (row.user_high_discord_id as string) : (row.user_low_discord_id as string)
  );
  const profileMap = await getProfileMap(friendIds);
  return friendIds.map((id) => profileMap.get(id) ?? { discordUserId: id, unitePlayerId: null, trainerName: null });
}

export async function listPendingFriendRequests(ownerDiscordUserId: string): Promise<PendingRequest[]> {
  const svc = getServiceClient();
  const { data: rows } = await svc
    .from('discord_friend_requests')
    .select('id,requester_discord_user_id,code,created_at')
    .eq('owner_discord_user_id', ownerDiscordUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  const requesterIds = (rows ?? []).map((r) => r.requester_discord_user_id as string);
  const profileMap = await getProfileMap(requesterIds);
  return (rows ?? []).map((row) => {
    const requesterDiscordUserId = row.requester_discord_user_id as string;
    const profile = profileMap.get(requesterDiscordUserId);
    return {
      id: row.id as string,
      requesterDiscordUserId,
      requesterUniteId: profile?.unitePlayerId ?? null,
      requesterTrainerName: profile?.trainerName ?? null,
      code: row.code as string,
      createdAt: row.created_at as string,
    };
  });
}

/** Discord ID は使わず、ゲーム内名 → ゲーム内ID → 汎用ラベルの順で表示 */
export function formatRequesterDisplayName(
  trainerName: string | null | undefined,
  unitePlayerId: string | null | undefined
): string {
  const name = trainerName?.trim();
  if (name) return name;
  const id = unitePlayerId?.trim();
  if (id) return id;
  return COPY.friend.requesterFallback;
}

export function formatFriendListLines(friends: FriendProfile[]): string {
  if (friends.length === 0) return COPY.friend.listEmpty;
  return friends
    .map((f, i) => {
      const label = f.trainerName || f.unitePlayerId || f.discordUserId;
      const idPart = f.unitePlayerId ? ` (${f.unitePlayerId})` : '';
      return `${i + 1}. ${label}${idPart}`;
    })
    .join('\n');
}

export function formatPendingRequestLine(req: PendingRequest): string {
  const label = formatRequesterDisplayName(req.requesterTrainerName, req.requesterUniteId);
  const idPart =
    req.requesterTrainerName && req.requesterUniteId ? ` (${req.requesterUniteId})` : '';
  return `・${label}${idPart}`;
}

export async function approveFriendRequest(
  requestId: string,
  ownerDiscordUserId: string
): Promise<
  | { ok: true; friends: FriendProfile[]; requesterDiscordUserId: string }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'not_pending' | 'already_friends' | 'friend_limit_reached' }
> {
  const svc = getServiceClient();
  const { data: req } = await svc
    .from('discord_friend_requests')
    .select('id,requester_discord_user_id,owner_discord_user_id,status')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { ok: false, reason: 'not_found' };
  if (req.owner_discord_user_id !== ownerDiscordUserId) return { ok: false, reason: 'not_owner' };
  if (req.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const requesterDiscordUserId = req.requester_discord_user_id as string;

  const slot = await canAddFriend(ownerDiscordUserId);
  if (!slot.ok) {
    return { ok: false, reason: 'friend_limit_reached' };
  }

  if (await areDiscordFriends(ownerDiscordUserId, requesterDiscordUserId)) {
    await svc
      .from('discord_friend_requests')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', requestId);
    const friends = await listDiscordFriends(ownerDiscordUserId);
    return { ok: true, friends, requesterDiscordUserId };
  }

  const { low, high } = pairDiscordIds(ownerDiscordUserId, requesterDiscordUserId);
  await svc.from('discord_friendships').upsert(
    {
      user_low_discord_id: low,
      user_high_discord_id: high,
      source: 'friend_code',
    },
    { onConflict: 'user_low_discord_id,user_high_discord_id' }
  );
  await svc
    .from('discord_friend_requests')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', requestId);

  const friends = await listDiscordFriends(ownerDiscordUserId);
  return { ok: true, friends, requesterDiscordUserId };
}

export async function removeDiscordFriend(
  ownerDiscordUserId: string,
  friendDiscordUserId: string
): Promise<
  | { ok: true; displayName: string }
  | { ok: false; reason: 'self' | 'not_friends' }
> {
  if (ownerDiscordUserId === friendDiscordUserId) return { ok: false, reason: 'self' };
  if (!(await areDiscordFriends(ownerDiscordUserId, friendDiscordUserId))) {
    return { ok: false, reason: 'not_friends' };
  }

  const profileMap = await getProfileMap([friendDiscordUserId]);
  const profile = profileMap.get(friendDiscordUserId);
  const displayName = formatRequesterDisplayName(profile?.trainerName, profile?.unitePlayerId);

  const { low, high } = pairDiscordIds(ownerDiscordUserId, friendDiscordUserId);
  const svc = getServiceClient();
  await svc
    .from('discord_friendships')
    .delete()
    .eq('user_low_discord_id', low)
    .eq('user_high_discord_id', high);

  return { ok: true, displayName };
}

export async function rejectFriendRequest(
  requestId: string,
  ownerDiscordUserId: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_owner' | 'not_pending' }> {
  const svc = getServiceClient();
  const { data: req } = await svc
    .from('discord_friend_requests')
    .select('id,owner_discord_user_id,status,requester_discord_user_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { ok: false, reason: 'not_found' };
  if (req.owner_discord_user_id !== ownerDiscordUserId) return { ok: false, reason: 'not_owner' };
  if (req.status !== 'pending') return { ok: false, reason: 'not_pending' };

  await getServiceClient()
    .from('discord_friend_requests')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', requestId);

  return { ok: true };
}
