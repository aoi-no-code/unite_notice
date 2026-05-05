import { SupabaseClient } from '@supabase/supabase-js';
import { fetchLastOnline, fetchLatestBattleAt } from './unite';
import { sendDiscord, sendDiscordDM } from './discord';

type PingOptions = {
  supabase: SupabaseClient;
  ownerUserId: string;
  pollWindowMinutes: number;
  defaultChannelId?: string;
};

export async function runUnitePing(options: PingOptions): Promise<{ notified: number; checked: number }> {
  const { supabase, ownerUserId, pollWindowMinutes, defaultChannelId } = options;

  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('id, user_low_id, user_high_id')
    .or(`user_low_id.eq.${ownerUserId},user_high_id.eq.${ownerUserId}`)
    .eq('active', true);
  if (error) throw error;
  if (!friendships || friendships.length === 0) return { notified: 0, checked: 0 };

  const friendUserIds = friendships.map((row) =>
    row.user_low_id === ownerUserId ? row.user_high_id : row.user_low_id
  );
  const { data: friendUsers, error: friendUsersErr } = await supabase
    .from('users')
    .select('id, unite_trainer_id, trainer_name')
    .in('id', friendUserIds);
  if (friendUsersErr) throw friendUsersErr;
  const targets = (friendUsers ?? []).filter((u) => !!u.unite_trainer_id);
  if (targets.length === 0) return { notified: 0, checked: 0 };

  const { data: owner, error: ownerErr } = await supabase
    .from('users')
    .select('discord_id')
    .eq('id', ownerUserId)
    .maybeSingle();
  if (ownerErr) throw ownerErr;
  const ownerDiscordId = owner?.discord_id ?? null;

  const now = new Date();
  const windowMs = pollWindowMinutes * 60 * 1000;
  const activeThreshold = new Date(now.getTime() - windowMs);

  let notified = 0;
  let checked = 0;

  for (const fr of targets) {
    checked += 1;
    const trainerId = fr.unite_trainer_id as string;
    const { latestBattleAt } = await fetchLatestBattleAt(trainerId);
    const { lastOnline } = await fetchLastOnline(trainerId);
    const activityAt = latestBattleAt ?? lastOnline;

    if (!activityAt) continue;
    if (activityAt < activeThreshold) continue; // 非アクティブ

    const label = fr.trainer_name || trainerId;
    const content = `今やろう？ ${label} さんがアクティブかも（最新バトル: <t:${Math.floor(
      activityAt.getTime() / 1000
    )}:R>）`;

    if (ownerDiscordId) {
      await sendDiscordDM(ownerDiscordId, { content });
    } else if (defaultChannelId) {
      await sendDiscord(defaultChannelId, { content });
    } else {
      continue;
    }
    notified += 1;
  }

  return { notified, checked };
}


