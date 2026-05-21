import { formatRequesterDisplayName, listDiscordFriends } from './discordFriends';
import { getServiceClient } from './db';
import { fetchLatestMatchSummary } from './unite';

export type PlayFriendRow = {
  discordUserId: string;
  displayName: string;
  unitePlayerId: string | null;
  timeAgoLabel: string;
  partyLabel: string | null;
};

const MAX_PLAY_INVITE_BUTTONS = 15;

export async function buildPlayFriendRows(ownerDiscordUserId: string): Promise<PlayFriendRow[]> {
  const friends = await listDiscordFriends(ownerDiscordUserId);
  if (friends.length === 0) return [];

  const svc = getServiceClient();
  const { data: profileRows } = await svc
    .from('discord_user_game_profiles')
    .select('discord_user_id,unite_player_id,trainer_name,unite_api_uid')
    .in(
      'discord_user_id',
      friends.map((f) => f.discordUserId)
    );

  const profileMap = new Map(
    (profileRows ?? []).map((row) => [
      row.discord_user_id as string,
      {
        unitePlayerId: (row.unite_player_id as string | null) ?? null,
        trainerName: (row.trainer_name as string | null) ?? null,
        uniteApiUid: (row.unite_api_uid as string | null) ?? null,
      },
    ])
  );

  const rows: PlayFriendRow[] = [];
  for (const friend of friends) {
    const profile = profileMap.get(friend.discordUserId);
    const displayName = formatRequesterDisplayName(profile?.trainerName, profile?.unitePlayerId);
    if (!profile?.unitePlayerId) {
      rows.push({
        discordUserId: friend.discordUserId,
        displayName,
        unitePlayerId: null,
        timeAgoLabel: '未登録',
        partyLabel: null,
      });
      continue;
    }

    const summary = await fetchLatestMatchSummary(profile.unitePlayerId, {
      uniteApiUid: profile.uniteApiUid,
    });
    rows.push({
      discordUserId: friend.discordUserId,
      displayName,
      unitePlayerId: profile.unitePlayerId,
      timeAgoLabel: summary?.timeAgoLabel ?? '対戦履歴なし',
      partyLabel: summary?.partyLabel ?? null,
    });
  }

  rows.sort((a, b) => {
    if (a.timeAgoLabel === '未登録' || a.timeAgoLabel === '対戦履歴なし') return 1;
    if (b.timeAgoLabel === '未登録' || b.timeAgoLabel === '対戦履歴なし') return -1;
    return a.displayName.localeCompare(b.displayName, 'ja');
  });

  return rows;
}

export function buildPlayListPayload(rows: PlayFriendRow[]) {
  if (rows.length === 0) {
    return {
      content: 'フレンドがいません。`/friend code` でフレンドを追加してください。',
      components: [] as unknown[],
      embeds: [] as unknown[],
    };
  }

  const description = rows
    .map((row, idx) => {
      const partyPart = row.partyLabel ? ` / ${row.partyLabel}` : '';
      return `${idx + 1}. **${row.displayName}** — ${row.timeAgoLabel}${partyPart}`;
    })
    .join('\n');

  const inviteTargets = rows.filter((r) => r.unitePlayerId).slice(0, MAX_PLAY_INVITE_BUTTONS);
  const components: unknown[] = [];
  for (let i = 0; i < inviteTargets.length; i += 5) {
    const chunk = inviteTargets.slice(i, i + 5);
    components.push({
      type: 1,
      components: chunk.map((row) => ({
        type: 2,
        style: 1,
        label: `誘う: ${row.displayName}`.slice(0, 80),
        custom_id: `play:invite:${row.discordUserId}`,
      })),
    });
  }
  if (components.length < 5) {
    components.push({
      type: 1,
      components: [
        { type: 2, style: 1, label: '一括で誘う', custom_id: 'play:invite_all' },
        { type: 2, style: 2, label: '閉じる', custom_id: 'play:close' },
      ],
    });
  }

  return {
    content: '**フレンドの最新対戦**（フレンドのみ表示）',
    embeds: [{ title: '🎮 /play', description, color: 0x57f287 }],
    components,
  };
}

export const PLAY_REPLY_MESSAGES: Record<string, string> = {
  '1': 'インするね！',
  '2': '次やろ！',
  '3': 'ちょっと待ってね、色々あってまたやろ！',
};

export async function getPlaySenderDisplayName(discordUserId: string): Promise<string> {
  const svc = getServiceClient();
  const { data: profile } = await svc
    .from('discord_user_game_profiles')
    .select('trainer_name,unite_player_id')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();
  return formatRequesterDisplayName(
    (profile?.trainer_name as string | null) ?? null,
    (profile?.unite_player_id as string | null) ?? null
  );
}

export function buildPlayInvitePayload(senderDisplayName: string, senderDiscordUserId: string) {
  return {
    content: `🎮 **${senderDisplayName}** さんから\n一緒にやらない？`,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'インするね！', custom_id: `play:reply:1:${senderDiscordUserId}` },
          { type: 2, style: 3, label: '次やろ！', custom_id: `play:reply:2:${senderDiscordUserId}` },
          {
            type: 2,
            style: 2,
            label: 'また今度やろ',
            custom_id: `play:reply:3:${senderDiscordUserId}`,
          },
        ],
      },
    ],
  };
}
