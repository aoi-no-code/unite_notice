import { NextRequest } from 'next/server';
import { verifyDiscordRequest } from '../../../../lib/verify';
import { getOrCreateDiscordUser, getServiceClient } from '@/lib/db';
import { fetchLatestBattleAt, fetchUniteProfile } from '@/lib/unite';
import { sendDiscordDM, sendInteractionFollowup } from '@/lib/discord';
import { randomBytes } from 'crypto';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  UPDATE_MESSAGE: 7,
} as const;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
}

function ephemeral(content: string, components?: unknown[], embeds?: unknown[]) {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, components, embeds, flags: 64 },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function hasAdminPermission(permissions: string | undefined): boolean {
  if (!permissions) return false;
  try {
    return (BigInt(permissions) & BigInt(0x8)) === BigInt(0x8);
  } catch {
    return false;
  }
}

function normalizeUniteId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9]+$/.test(normalized)) return null;
  if (normalized.length > 32) return null;
  return normalized;
}

async function getUserGuildsForDm(discordUserId: string): Promise<Array<{ id: string; name: string | null }>> {
  const svc = getServiceClient();
  const { data: rows } = await svc
    .from('discord_guild_members')
    .select('guild_id')
    .eq('discord_user_id', discordUserId)
    .order('last_seen_at', { ascending: false });
  const guildIds = [...new Set((rows ?? []).map((row) => row.guild_id as string))];
  if (guildIds.length === 0) {
    // 参加トラッキング（trackGuildContext）がDB側の問題で失敗するケースでも、
    // まずは動かすためにデフォルトGuildをフォールバックする。
    const fallbackGuildId = process.env.DISCORD_GUILD_ID;
    if (!fallbackGuildId) return [];
    return [{ id: fallbackGuildId, name: null }];
  }
  const { data: guilds } = await svc.from('discord_guilds').select('id,name').in('id', guildIds);
  const nameMap = new Map((guilds ?? []).map((g) => [g.id as string, (g.name as string | null) ?? null]));
  return guildIds.map((id) => ({ id, name: nameMap.get(id) ?? null }));
}

async function upsertRegistration(
  discordUserId: string,
  unitePlayerId: string
): Promise<{ trainerName: string | null; fetchStatus: 'ok' | 'failed'; lastFetchError: string | null }> {
  const svc = getServiceClient();
  const discordUser = await getOrCreateDiscordUser(discordUserId);
  let trainerName: string | null = null;
  let fetchStatus: 'ok' | 'failed' = 'ok';
  let lastFetchError: string | null = null;
  let profileFetchedAt: string | null = null;
  try {
    const profile = await fetchUniteProfile(unitePlayerId);
    trainerName = profile?.profile?.playerName?.trim() || null;
    if (trainerName) {
      profileFetchedAt = nowIso();
    } else {
      fetchStatus = 'failed';
      lastFetchError = 'unite_player_name_not_found';
    }
  } catch {
    // 名前同期に失敗しても登録自体は継続
    fetchStatus = 'failed';
    lastFetchError = 'fetch_unite_profile_failed';
  }

  await svc.from('discord_user_game_profiles').upsert(
    {
      discord_user_id: discordUserId,
      discord_user_ref_id: discordUser.id,
      unite_player_id: unitePlayerId,
      trainer_name: trainerName,
      fetch_status: fetchStatus,
      profile_fetched_at: profileFetchedAt,
      last_fetch_error: lastFetchError,
      updated_at: nowIso(),
    },
    { onConflict: 'discord_user_id' }
  );
  return { trainerName, fetchStatus, lastFetchError };
}
function buildRegisterProfileLine(result: { trainerName: string | null; fetchStatus: 'ok' | 'failed'; lastFetchError: string | null }): string {
  if (result.fetchStatus === 'ok') {
    return `ゲーム内名: ${result.trainerName ?? '取得不可（IDのみ保存）'}`;
  }
  if (result.lastFetchError === 'unite_player_name_not_found') {
    return 'ゲーム内名: UniteAPI上で対象プレイヤーを見つけられませんでした（ID形式や公開状況を確認してください）';
  }
  if (result.lastFetchError === 'fetch_unite_profile_failed') {
    return 'ゲーム内名: 取得失敗（UniteAPIアクセス失敗）';
  }
  return 'ゲーム内名: 取得失敗（IDのみ保存）';
}


async function getGuildMemberDiscordUserIds(guildId: string, excludeDiscordUserId?: string): Promise<string[]> {
  const svc = getServiceClient();
  let query = svc.from('discord_guild_members').select('discord_user_id').eq('guild_id', guildId);
  if (excludeDiscordUserId) {
    query = query.neq('discord_user_id', excludeDiscordUserId);
  }
  const { data } = await query.limit(200);
  return [...new Set((data ?? []).map((row) => row.discord_user_id as string))];
}

async function buildPlayCandidates(guildId: string, currentDiscordUserId: string) {
  const svc = getServiceClient();
  const friendIds = await getFriendDiscordIds(currentDiscordUserId);
  if (friendIds.size === 0) return [];
  const guildMemberIds = await getGuildMemberDiscordUserIds(guildId, currentDiscordUserId);
  if (guildMemberIds.length === 0) return [];
  const { data: rows } = await svc
    .from('discord_user_game_profiles')
    .select('discord_user_id, unite_player_id, notify_enabled')
    .in('discord_user_id', guildMemberIds)
    .eq('notify_enabled', true)
    .limit(25);

  const twoHoursMs = 2 * 60 * 60 * 1000;
  const now = Date.now();
  const candidates: Array<{
    discordUserId: string;
    unitePlayerId: string;
    latestBattleAt: Date;
    minutesAgo: number;
  }> = [];

  for (const row of rows ?? []) {
    const discordUserId = row.discord_user_id as string;
    if (!friendIds.has(discordUserId)) continue;
    const unitePlayerId = row.unite_player_id as string;
    const { latestBattleAt } = await fetchLatestBattleAt(unitePlayerId);
    if (!latestBattleAt) continue;
    const diffMs = now - latestBattleAt.getTime();
    if (diffMs > twoHoursMs) continue;
    candidates.push({
      discordUserId,
      unitePlayerId,
      latestBattleAt,
      minutesAgo: Math.max(1, Math.floor(diffMs / (60 * 1000))),
    });
  }

  candidates.sort((a, b) => a.latestBattleAt.getTime() - b.latestBattleAt.getTime());
  return candidates;
}

function pairDiscordIds(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

async function getFriendDiscordIds(discordUserId: string): Promise<Set<string>> {
  const svc = getServiceClient();
  const { data: rows } = await svc
    .from('discord_friendships')
    .select('user_low_discord_id,user_high_discord_id')
    .or(`user_low_discord_id.eq.${discordUserId},user_high_discord_id.eq.${discordUserId}`);
  const friendIds = new Set<string>();
  for (const row of rows ?? []) {
    const low = row.user_low_discord_id as string;
    const high = row.user_high_discord_id as string;
    friendIds.add(low === discordUserId ? high : low);
  }
  return friendIds;
}

async function upsertFriendship(a: string, b: string, source: 'same_guild' | 'invite_link') {
  if (a === b) return;
  const svc = getServiceClient();
  const { low, high } = pairDiscordIds(a, b);
  await svc.from('discord_friendships').upsert(
    {
      user_low_discord_id: low,
      user_high_discord_id: high,
      source,
    },
    { onConflict: 'user_low_discord_id,user_high_discord_id' }
  );
}

async function notifyUsers(senderDiscordUserId: string, targetDiscordUserIds: string[]) {
  const errors: string[] = [];
  for (const discordUserId of targetDiscordUserIds) {
    try {
      await sendDiscordDM(discordUserId, {
        content: `🎮 <@${senderDiscordUserId}> さんからお誘いです！\n今プレイ可能なら返信してみてください。`,
      });
    } catch {
      errors.push(discordUserId);
    }
  }
  return errors;
}

async function trackGuildContext(data: any) {
  const guildId: string | undefined = data?.guild_id;
  if (!guildId) return;

  const guildName: string | null = data?.guild?.name ?? null;
  const guildIcon: string | null = data?.guild?.icon ?? null;
  const guildOwnerId: string | null = data?.guild?.owner_id ?? null;
  const preferredLocale: string | null = data?.guild_locale ?? null;
  const features = Array.isArray(data?.guild?.features) ? data.guild.features : [];
  const discordUserId: string | undefined = data?.member?.user?.id || data?.user?.id;
  if (!discordUserId) return;

  // サーバー内アクションをしたユーザーは、guild関連テーブルに加えて
  // discord_users にも先に同期しておく。
  await getOrCreateDiscordUser(discordUserId);

  const svc = getServiceClient();
  await svc.from('discord_guilds').upsert(
    {
      id: guildId,
      name: guildName,
      icon: guildIcon,
      owner_id: guildOwnerId,
      preferred_locale: preferredLocale,
      features,
      last_seen_at: nowIso(),
      updated_at: nowIso(),
    },
    { onConflict: 'id' }
  );

  await svc.from('discord_guild_members').upsert(
    {
      guild_id: guildId,
      discord_user_id: discordUserId,
      last_seen_at: nowIso(),
      updated_at: nowIso(),
    },
    { onConflict: 'guild_id,discord_user_id' }
  );
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('X-Signature-Ed25519') ?? '';
  const timestamp = req.headers.get('X-Signature-Timestamp') ?? '';
  console.log('[discord][interactions] incoming', {
    hasSignature: Boolean(signature),
    hasTimestamp: Boolean(timestamp),
    signatureLen: signature.length,
    timestampLen: timestamp.length,
    guild_id: req.headers.get('x-discord-guild-id') ?? undefined,
  });

  const verified = await verifyDiscordRequest(req as unknown as Request);
  console.log('[discord][interactions] verified', { valid: verified.valid });
  if (!verified.valid) return new Response('Bad signature', { status: 401 });
  const { body } = verified;
  const data = JSON.parse(body || '{}');
  console.log('[discord][interactions] payload', {
    type: data?.type,
    name: data?.data?.name,
    guild_id: data?.guild_id,
    isDM: !data?.guild_id,
  });
  const appBaseUrl = process.env.APP_BASE_URL || '';

  // PING
  if (data?.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // 受信イベントごとに、可能ならGuildコンテキストを記録する
  // Discordはインタラクション応答を短時間で返す必要があるため、
  // 追跡処理は応答ブロックしない（失敗はログ出して握りつぶす）
  void trackGuildContext(data).catch((err) => {
    const anyErr = err as any;
    console.log('[discord][interactions] trackGuildContext failed', {
      isError: err instanceof Error,
      message: (err instanceof Error ? err.message : undefined) ?? anyErr?.message ?? anyErr?.error_description,
      code: anyErr?.code,
      status: anyErr?.status,
      raw: anyErr,
    });
  });

  // APPLICATION_COMMAND
  if (data?.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = data?.data?.name;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    const isDm = !data?.guild_id;
    if (!userDiscordId) return ephemeral('Discordユーザー情報を取得できませんでした。');

    if (name === 'setup') {
      if (isDm) return ephemeral('/setup はサーバー内で実行してください。');
      const permissions: string | undefined = data?.member?.permissions;
      if (!hasAdminPermission(permissions)) {
        return ephemeral('このコマンドは管理者のみ実行できます。');
      }
      const embed = {
        title: '🎮 UniteFriendsへようこそ！',
        description:
          'このBotは、ポケモンユナイトで\n「今誘えそうなフレンド」を見つけるためのBotです。\n\nサーバー内では登録通知を流さず、\n登録・検索・通知設定はすべてBotとの個別DMで行います。\n\n使い方：\n1. BotとのDMを開く\n2. /register でゲーム内IDを登録\n3. /friend find で同じサーバー内フレンドを追加\n4. サーバー外フレンドは /friend invite のURL経由で追加\n5. /play で今誘えそうなフレンドを検索',
        color: 0x5865f2,
      };
      const components = [
        {
          type: 1,
          components: [{ type: 2, style: 1, label: 'BotとDMを開く', custom_id: 'unite:setup_open_dm' }],
        },
      ];
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [embed], components },
      });
    }

    if (name === 'unite') {
      const subcommand = data?.data?.options?.[0]?.name;
      if (subcommand === 'ping') {
        await fetch(`${process.env.APP_BASE_URL}/api/unite/ping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_SHARED_SECRET || '',
          },
          body: JSON.stringify({ owner_discord_id: userDiscordId }),
        });
        return ephemeral('チェックを実行しました。');
      }
      return ephemeral('新フローでは /setup /register /play /notify を利用してください。');
    }

    if (name === 'register') {
      if (!isDm) {
        return ephemeral('`/register` はDM専用です。サーバー内では `/setup` で案内を表示してください。');
      }
      const rawUniteId = data?.data?.options?.find((o: { name?: string; value?: string }) => o.name === 'unite_player_id')?.value;
      const unitePlayerId = normalizeUniteId(rawUniteId);
      if (!unitePlayerId) {
        return ephemeral(
          '🎮 UniteFriendsへようこそ！\n\nまずはあなたのポケモンユナイトのゲーム内IDを登録してください。\n\n/register ゲーム内ID\n\n登録後は\n/play\nで、同じサーバーにいる登録済みユーザーの中から\n最近対戦している人を探せます。'
        );
      }
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral('登録レスポンスの情報を取得できませんでした。再実行してください。');
      }

      void (async () => {
        try {
          const guilds = await getUserGuildsForDm(userDiscordId);
          if (guilds.length === 0) {
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: '参加中サーバーが見つかりません。先にサーバー内でBotコマンドを一度実行してください。',
              flags: 64,
            });
            return;
          }
          const result = await upsertRegistration(userDiscordId, unitePlayerId);
          const profileLine = buildRegisterProfileLine(result);
          await sendInteractionFollowup(applicationId, interactionToken, {
            content: `登録しました。\nゲーム内ID: ${unitePlayerId}\n${profileLine}\n\n次は /play を実行してください。`,
            flags: 64,
          });
        } catch (err) {
          console.log('[discord][interactions] register followup failed', err);
          await sendInteractionFollowup(applicationId, interactionToken, {
            content: '登録中にエラーが発生しました。少し待ってから再実行してください。',
            flags: 64,
          }).catch(() => {});
        }
      })();

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (name === 'notify') {
      if (!isDm) return ephemeral('/notify はDM専用です。');
      const mode = data?.data?.options?.find((o: { name?: string; value?: string }) => o.name === 'mode')?.value;
      if (mode !== 'on' && mode !== 'off') return ephemeral('`/notify on` または `/notify off` を指定してください。');
      const guilds = await getUserGuildsForDm(userDiscordId);
      if (guilds.length === 0) return ephemeral('対象サーバーが見つかりません。');
      const svc = getServiceClient();
      await svc
        .from('discord_user_game_profiles')
        .update({ notify_enabled: mode === 'on', updated_at: nowIso() })
        .eq('discord_user_id', userDiscordId);
      return ephemeral(`通知設定を ${mode.toUpperCase()} に更新しました。`);
    }

    if (name === 'play') {
      if (!isDm) return ephemeral('/play はDM専用です。');
      const svc = getServiceClient();
      const { data: myProfile } = await svc
        .from('discord_user_game_profiles')
        .select('discord_user_id')
        .eq('discord_user_id', userDiscordId)
        .maybeSingle();
      if (!myProfile) return ephemeral('登録が見つかりません。先に /register を実行してください。');
      const guilds = await getUserGuildsForDm(userDiscordId);
      const guildIds = guilds.map((g) => g.id);
      if (guildIds.length === 0) return ephemeral('検索対象のサーバーが見つかりません。先にサーバー内でBotを利用してください。');

      if (guildIds.length > 1) {
        const nameMap = new Map(guilds.map((g) => [g.id as string, g.name]));
        return ephemeral('検索対象のサーバーを選択してください。', [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: 'play:guild_select',
                placeholder: 'サーバーを選択',
                options: guildIds.slice(0, 25).map((id) => ({ label: (nameMap.get(id) ?? id).slice(0, 100), value: id })),
              },
            ],
          },
        ]);
      }

      const guildId = guildIds[0];
      const candidates = await buildPlayCandidates(guildId, userDiscordId);
      if (candidates.length === 0) return ephemeral('フレンドの中で直近プレイ候補が見つかりませんでした。先に /friend find または /friend invite を利用してください。');
      const embed = {
        title: '🎮 今誘えそうな候補',
        description: candidates
          .map((c, idx) => `${idx + 1}. <@${c.discordUserId}> (${c.minutesAgo}分前 / ID:${c.unitePlayerId})`)
          .join('\n'),
        color: 0x57f287,
      };
      return ephemeral('通知先を選択してください。', [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `play:notify_one:${guildId}`,
              placeholder: '通知するユーザーを選択',
              options: candidates
                .slice(0, 25)
                .map((c) => ({ label: `${c.unitePlayerId} (${c.minutesAgo}分前)`.slice(0, 100), value: c.discordUserId })),
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '全員に通知', custom_id: `play:notify_all:${guildId}` },
            { type: 2, style: 2, label: '閉じる', custom_id: 'play:close' },
          ],
        },
      ], [embed]);
    }

    if (name === 'friend') {
      if (!isDm) return ephemeral('/friend はDM専用です。');
      const sub = data?.data?.options?.[0]?.name as string | undefined;

      if (sub === 'find') {
        const guilds = await getUserGuildsForDm(userDiscordId);
        if (guilds.length === 0) return ephemeral('対象サーバーが見つかりません。');
        const guildId = guilds[0].id;
        const svc = getServiceClient();
        const guildMemberIds = await getGuildMemberDiscordUserIds(guildId, userDiscordId);
        if (guildMemberIds.length === 0) return ephemeral('同じサーバー内で候補が見つかりませんでした。');
        const { data: rows } = await svc
          .from('discord_user_game_profiles')
          .select('discord_user_id,unite_player_id')
          .in('discord_user_id', guildMemberIds)
          .limit(25);
        const friendIds = await getFriendDiscordIds(userDiscordId);
        const candidates = (rows ?? []).filter((row) => !friendIds.has(row.discord_user_id as string));
        if (candidates.length === 0) {
          return ephemeral('同じサーバー内で新規に追加できる候補が見つかりませんでした。サーバー外の相手は /friend invite でURL招待してください。');
        }
        return ephemeral('同じサーバーの候補です。フレンド追加する相手を選んでください。', [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `friend:add:${guildId}`,
                placeholder: 'フレンド追加する相手',
                options: candidates.map((row) => ({
                  label: `${row.unite_player_id as string}`.slice(0, 100),
                  value: row.discord_user_id as string,
                })),
              },
            ],
          },
        ]);
      }

      if (sub === 'invite') {
        const guilds = await getUserGuildsForDm(userDiscordId);
        const guildId = guilds[0]?.id ?? process.env.DISCORD_GUILD_ID ?? null;
        const token = randomBytes(12).toString('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
        const svc = getServiceClient();
        await svc.from('discord_friend_invites').insert({
          token,
          inviter_discord_user_id: userDiscordId,
          guild_id: guildId,
          expires_at: expiresAt,
        });
        return ephemeral(
          `サーバー外ユーザー用のフレンド招待URLです（7日間有効）。\n${appBaseUrl}/friend/${token}\n\n相手にはこのURLと一緒に「DMで /friend accept ${token} を実行」と伝えてください。`
        );
      }

      if (sub === 'accept') {
        const token = data?.data?.options?.[0]?.options?.find((o: { name?: string; value?: string }) => o.name === 'token')?.value;
        if (!token || typeof token !== 'string') return ephemeral('token を指定してください。');
        const svc = getServiceClient();
        const { data: invite } = await svc
          .from('discord_friend_invites')
          .select('token,inviter_discord_user_id,expires_at,used_by_discord_user_id')
          .eq('token', token)
          .maybeSingle();
        if (!invite) return ephemeral('招待トークンが見つかりません。');
        if (invite.used_by_discord_user_id) return ephemeral('この招待トークンはすでに使用済みです。');
        if (new Date(invite.expires_at as string).getTime() < Date.now()) return ephemeral('この招待トークンは有効期限切れです。');
        const inviterDiscordUserId = invite.inviter_discord_user_id as string;
        if (inviterDiscordUserId === userDiscordId) return ephemeral('自分の招待URLは受け付けられません。');
        await upsertFriendship(inviterDiscordUserId, userDiscordId, 'invite_link');
        await svc
          .from('discord_friend_invites')
          .update({ used_by_discord_user_id: userDiscordId, used_at: nowIso() })
          .eq('token', token);
        return ephemeral('フレンド登録が完了しました。/play でフレンド候補を探せます。');
      }

      return ephemeral('未対応の /friend サブコマンドです。');
    }

    return ephemeral('未対応のコマンドです');
  }

  // MESSAGE_COMPONENT
  if (data?.type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = data?.data?.custom_id;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    const selectedValues: string[] = Array.isArray(data?.data?.values) ? data.data.values : [];
    if (!userDiscordId) return ephemeral('Discordユーザー情報を取得できませんでした。');

    if (customId === 'unite:setup_open_dm') {
      const dmText =
        '🎮 UniteFriendsへようこそ！\n\nまずはあなたのポケモンユナイトのゲーム内IDを登録してください。\n\n/register ゲーム内ID\n\n登録後は\n/play\nで、同じサーバーにいる登録済みユーザーの中から\n最近対戦している人を探せます。\n\n注意点：\n- サーバーチャンネルに個人の登録通知は流さない\n- 登録・検索・通知設定はDM内で完結させる\n- DMが送れない場合は「Discordのプライバシー設定でDMを許可してください」\n- 通知を受け取りたくない場合は /notify off で停止できます。';
      try {
        await sendDiscordDM(userDiscordId, { content: dmText });
        return ephemeral('DMを送信しました。DM内で `/register` を実行してください。');
      } catch {
        return ephemeral('DMできませんでした。Discordのプライバシー設定でDMを許可してください。');
      }
    }

    if (customId.startsWith('register:guild_select:')) {
      const unitePlayerId = customId.replace('register:guild_select:', '');
      if (!unitePlayerId) return ephemeral('登録情報が不足しています。');
      const result = await upsertRegistration(userDiscordId, unitePlayerId);
      const profileLine = buildRegisterProfileLine(result);
      return ephemeral(`登録しました。\nゲーム内ID: ${unitePlayerId}\n${profileLine}\n\n次は /play を実行してください。`);
    }

    if (customId.startsWith('friend:add:')) {
      const guildId = customId.replace('friend:add:', '');
      const targetDiscordUserId = selectedValues[0];
      if (!targetDiscordUserId) return ephemeral('追加する相手を選択してください。');
      const svc = getServiceClient();
      const { data: member } = await svc
        .from('discord_guild_members')
        .select('discord_user_id')
        .eq('guild_id', guildId)
        .eq('discord_user_id', targetDiscordUserId)
        .maybeSingle();
      if (!member) {
        return ephemeral('同じサーバー内のユーザーのみ追加できます。サーバー外の相手は /friend invite を使ってください。');
      }
      const { data: profile } = await svc
        .from('discord_user_game_profiles')
        .select('discord_user_id')
        .eq('discord_user_id', targetDiscordUserId)
        .maybeSingle();
      if (!profile) return ephemeral('このユーザーはまだゲーム内IDを登録していません。');
      await upsertFriendship(userDiscordId, targetDiscordUserId, 'same_guild');
      return ephemeral('フレンド追加しました。/play で検索できます。');
    }

    if (customId === 'unite:check_now') {
      await fetch(`${process.env.APP_BASE_URL}/api/unite/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SHARED_SECRET || '',
        },
        body: JSON.stringify({ owner_discord_id: userDiscordId }),
      });
      return ephemeral('チェックを実行しました。');
    }

    if (customId === 'play:guild_select') {
      const guildId = selectedValues[0];
      if (!guildId) return ephemeral('サーバーを選択してください。');
      const candidates = await buildPlayCandidates(guildId, userDiscordId);
      if (candidates.length === 0) return ephemeral('直近でプレイしている候補が見つかりませんでした。');
      const embed = {
        title: '🎮 今誘えそうな候補',
        description: candidates
          .map((c, idx) => `${idx + 1}. <@${c.discordUserId}> (${c.minutesAgo}分前 / ID:${c.unitePlayerId})`)
          .join('\n'),
        color: 0x57f287,
      };
      return ephemeral('通知先を選択してください。', [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `play:notify_one:${guildId}`,
              placeholder: '通知するユーザーを選択',
              options: candidates
                .slice(0, 25)
                .map((c) => ({ label: `${c.unitePlayerId} (${c.minutesAgo}分前)`.slice(0, 100), value: c.discordUserId })),
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '全員に通知', custom_id: `play:notify_all:${guildId}` },
            { type: 2, style: 2, label: '閉じる', custom_id: 'play:close' },
          ],
        },
      ], [embed]);
    }

    if (customId.startsWith('play:notify_one:')) {
      const targetDiscordUserId = selectedValues[0];
      if (!targetDiscordUserId) return ephemeral('通知先を選択してください。');
      const errors = await notifyUsers(userDiscordId, [targetDiscordUserId]);
      if (errors.length > 0) {
        return ephemeral('通知に失敗しました。Discordのプライバシー設定でDMを許可してください。');
      }
      return ephemeral('選択したユーザーにDM通知しました。');
    }

    if (customId.startsWith('play:notify_all:')) {
      const guildId = customId.replace('play:notify_all:', '');
      const svc = getServiceClient();
      const guildMemberIds = await getGuildMemberDiscordUserIds(guildId, userDiscordId);
      if (guildMemberIds.length === 0) return ephemeral('通知対象が見つかりませんでした。');
      const { data: rows } = await svc
        .from('discord_user_game_profiles')
        .select('discord_user_id')
        .in('discord_user_id', guildMemberIds)
        .eq('notify_enabled', true)
        .limit(50);
      const targetIds = (rows ?? []).map((row) => row.discord_user_id as string);
      if (targetIds.length === 0) return ephemeral('通知対象が見つかりませんでした。');
      const errors = await notifyUsers(userDiscordId, targetIds);
      if (errors.length > 0) {
        return ephemeral(
          `一部通知に失敗しました（${errors.length}件）。Discordのプライバシー設定でDMを許可してください。`
        );
      }
      return ephemeral(`${targetIds.length}人にDM通知しました。`);
    }

    if (customId === 'play:close') {
      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: { content: 'このメニューは閉じました。', components: [], embeds: [] },
      });
    }
    return ephemeral('未対応のボタンです');
  }

  return new Response('OK');
}


