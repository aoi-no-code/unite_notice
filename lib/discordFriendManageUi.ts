import type { FriendProfile } from './discordFriends';
import { formatRequesterDisplayName } from './discordFriends';

const MAX_REMOVE_BUTTONS = 20;

export function buildFriendManagePayload(friends: FriendProfile[], removedLine?: string) {
  if (friends.length === 0) {
    const prefix = removedLine ? `${removedLine}\n\n` : '';
    return {
      content: `${prefix}フレンドはいません。\`/friend code\` で追加できます。`,
      embeds: [] as unknown[],
      components: [] as unknown[],
    };
  }

  const description = friends
    .map((f, i) => {
      const label = formatRequesterDisplayName(f.trainerName, f.unitePlayerId);
      return `${i + 1}. **${label}**`;
    })
    .join('\n');

  const components: unknown[] = [];
  const targets = friends.slice(0, MAX_REMOVE_BUTTONS);
  for (let i = 0; i < targets.length; i += 5) {
    const chunk = targets.slice(i, i + 5);
    components.push({
      type: 1,
      components: chunk.map((f) => {
        const label = formatRequesterDisplayName(f.trainerName, f.unitePlayerId);
        return {
          type: 2,
          style: 4,
          label: `削除: ${label}`.slice(0, 80),
          custom_id: `friend:remove:${f.discordUserId}`,
        };
      }),
    });
  }

  const prefix = removedLine ? `${removedLine}\n\n` : '';
  return {
    content: `${prefix}**フレンド整理** — 削除する相手のボタンを押してください。`,
    embeds: [{ title: `フレンド一覧（${friends.length}人）`, description, color: 0x5865f2 }],
    components,
  };
}
