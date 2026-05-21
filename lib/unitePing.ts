import { SupabaseClient } from '@supabase/supabase-js';
import { fetchLastOnline, fetchLatestBattleAt } from './unite';
import { sendDiscord, sendDiscordDM } from './discord';

type PingOptions = {
  supabase: SupabaseClient;
  ownerDiscordId: string;
  pollWindowMinutes: number;
  defaultChannelId?: string;
};

export async function runUnitePing(options: PingOptions): Promise<{ notified: number; checked: number }> {
  const { supabase, ownerDiscordId, pollWindowMinutes, defaultChannelId } = options;

  const { data: friendships, error } = await supabase
    .from('discord_friendships')
    .select('user_low_discord_id,user_high_discord_id')
    .or(`user_low_discord_id.eq.${ownerDiscordId},user_high_discord_id.eq.${ownerDiscordId}`);
  if (error) throw error;
  if (!friendships || friendships.length === 0) return { notified: 0, checked: 0 };

  const friendDiscordIds = friendships.map((row) =>
    row.user_low_discord_id === ownerDiscordId ? row.user_high_discord_id : row.user_low_discord_id
  );
  const { data: friendProfiles, error: friendProfilesErr } = await supabase
    .from('discord_user_game_profiles')
    .select('discord_user_id, unite_player_id, trainer_name, unite_api_uid')
    .in('discord_user_id', friendDiscordIds);
  if (friendProfilesErr) throw friendProfilesErr;
  const targets = (friendProfiles ?? []).filter((u) => !!u.unite_player_id);
  if (targets.length === 0) return { notified: 0, checked: 0 };

  const now = new Date();
  const windowMs = pollWindowMinutes * 60 * 1000;
  const activeThreshold = new Date(now.getTime() - windowMs);

  let notified = 0;
  let checked = 0;

  for (const fr of targets) {
    checked += 1;
    const trainerId = fr.unite_player_id as string;
    const { latestBattleAt } = await fetchLatestBattleAt(trainerId);
    const { lastOnline } = await fetchLastOnline(trainerId);
    const activityAt = latestBattleAt ?? lastOnline;

    if (!activityAt) continue;
    if (activityAt < activeThreshold) continue;

    const label = (fr.trainer_name as string | null) || trainerId;
    const content = `今やろう？ ${label} さんがアクティブかも（最新バトル: <t:${Math.floor(
      activityAt.getTime() / 1000
    )}:R>）`;

    try {
      await sendDiscordDM(ownerDiscordId, { content });
      notified += 1;
    } catch {
      if (defaultChannelId) {
        await sendDiscord(defaultChannelId, { content });
        notified += 1;
      }
    }
  }

  return { notified, checked };
}
