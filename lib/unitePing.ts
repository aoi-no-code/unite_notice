import { SupabaseClient } from '@supabase/supabase-js';
import { fetchLastOnline } from './unite';
import { sendDiscord } from './discord';

type PingOptions = {
  supabase: SupabaseClient;
  ownerUserId: string;
  pollWindowMinutes: number;
  defaultChannelId: string;
};

export async function runUnitePing(options: PingOptions): Promise<{ notified: number; checked: number }> {
  const { supabase, ownerUserId, pollWindowMinutes, defaultChannelId } = options;

  const { data: friends, error } = await supabase
    .from('friend_links')
    .select('id, friend_unite_id, friend_label, notify_channel_id, last_seen_at, active')
    .eq('owner_user_id', ownerUserId)
    .eq('active', true);
  if (error) throw error;
  if (!friends || friends.length === 0) return { notified: 0, checked: 0 };

  const now = new Date();
  const windowMs = pollWindowMinutes * 60 * 1000;
  const activeThreshold = new Date(now.getTime() - windowMs);

  let notified = 0;
  let checked = 0;

  for (const fr of friends) {
    checked += 1;
    const { lastOnline } = await fetchLastOnline(fr.friend_unite_id);

    // last_seen_at 更新
    await supabase
      .from('friend_links')
      .update({ last_seen_at: lastOnline ? lastOnline.toISOString() : null })
      .eq('id', fr.id);

    if (!lastOnline) continue;
    if (lastOnline < activeThreshold) continue; // 非アクティブ

    // 直近2時間の重複送信抑制
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('notification_logs')
      .select('id')
      .eq('friend_link_id', fr.id)
      .gte('sent_at', twoHoursAgo)
      .limit(1);
    if (recent && recent.length > 0) continue;

    const channelId = fr.notify_channel_id || defaultChannelId;
    const label = fr.friend_label || fr.friend_unite_id;
    const content = `今やろう？ ${label} さんがオンラインかも（最終ログイン: <t:${Math.floor(
      lastOnline.getTime() / 1000
    )}:R>）`;

    await sendDiscord(channelId, { content });
    await supabase
      .from('notification_logs')
      .insert({ friend_link_id: fr.id, channel_id: channelId, payload: { content } });
    notified += 1;
  }

  return { notified, checked };
}


