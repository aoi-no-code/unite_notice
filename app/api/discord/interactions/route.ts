import { waitUntil } from '@vercel/functions';
import { NextRequest } from 'next/server';
import { verifyDiscordRequest } from '../../../../lib/verify';
import {
  approveFriendRequest,
  createFriendCode,
  formatFriendListLines,
  formatPendingRequestLine,
  formatRequesterDisplayName,
  listDiscordFriends,
  listPendingFriendRequests,
  rejectFriendRequest,
  removeDiscordFriend,
  submitFriendRequest,
} from '@/lib/discordFriends';
import { countDiscordFriends, ensureBilling, formatPlanStatus, PLANS } from '@/lib/billing';
import {
  approvePaymentRequest,
  buildPaymentReportModal,
  buildPremiumIntroPayload,
  createPaymentRequest,
  ensurePremiumRow,
  formatPremiumStatusForUser,
  PREMIUM_MODAL_ID,
  PREMIUM_REPORT_BUTTON_ID,
  rejectPaymentRequest,
} from '@/lib/premium';
import { buildFriendManagePayload } from '@/lib/discordFriendManageUi';
import { getOrCreateDiscordUser, getServiceClient } from '@/lib/db';
import { fetchUniteProfile, isUnitePlayerNotIndexed } from '@/lib/unite';
import {
  buildPlayFriendRows,
  buildPlayInvitePayload,
  buildPlayListPayload,
  getPlaySenderDisplayName,
  PLAY_REPLY_MESSAGES,
} from '@/lib/play';
import { editDeferredInteractionMessage, sendDiscordDM, sendInteractionFollowup } from '@/lib/discord';
import { ACTIVE_FRIEND_SLOT_LIMIT, BILLING_FEATURE_ENABLED, COPY } from '@/lib/botCopy';
import { buildFriendCodeGuidePayload, FRIEND_CODE_ISSUE_BUTTON_ID } from '@/lib/discordFriendCodeUi';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
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

function ephemeralData(data: Record<string, unknown>) {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { ...data, flags: 64 },
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

function canReviewPremiumPayment(data: { guild_id?: string; member?: { permissions?: string } }): boolean {
  if (!data?.guild_id) return false;
  return hasAdminPermission(data.member?.permissions);
}

function parseModalValues(data: {
  components?: Array<{ components?: Array<{ custom_id: string; value: string }> }>;
}): Array<{ custom_id: string; value: string }> {
  const values: Array<{ custom_id: string; value: string }> = [];
  for (const row of data.components ?? []) {
    for (const field of row.components ?? []) {
      if (field.custom_id) values.push({ custom_id: field.custom_id, value: field.value ?? '' });
    }
  }
  return values;
}

function discordUsernameFromInteraction(data: {
  member?: { user?: { username?: string; global_name?: string | null } };
  user?: { username?: string; global_name?: string | null };
}): string {
  const user = data.member?.user ?? data.user;
  return user?.global_name?.trim() || user?.username?.trim() || '不明';
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
  let uniteApiUid: string | null = null;
  try {
    const profile = await fetchUniteProfile(unitePlayerId);
    uniteApiUid = profile?.profile?.uid?.trim() || null;
    trainerName = profile?.profile?.playerName?.trim() || null;
    if (trainerName) {
      profileFetchedAt = nowIso();
    } else {
      fetchStatus = 'failed';
      lastFetchError = (await isUnitePlayerNotIndexed(unitePlayerId))
        ? 'unite_player_not_indexed'
        : 'unite_player_name_not_found';
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
      unite_api_uid: uniteApiUid,
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
    return result.trainerName ? COPY.register.profileOk(result.trainerName) : COPY.register.profileOkFallback;
  }
  if (result.lastFetchError === 'unite_player_not_indexed') {
    return COPY.register.profileNotIndexed;
  }
  if (result.lastFetchError === 'unite_player_name_not_found') {
    return COPY.register.profileNameNotFound;
  }
  if (result.lastFetchError === 'fetch_unite_profile_failed') {
    return COPY.register.profileFetchFailed;
  }
  return COPY.register.profileFailed;
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const friends = await listDiscordFriends(a);
  return friends.some((f) => f.discordUserId === b);
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
  // PING
  if (data?.type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // 受信イベントごとに、可能ならGuildコンテキストを記録する
  // Discordはインタラクション応答を短時間で返す必要があるため、
  // 追跡処理は応答ブロックしない（Vercel では waitUntil でレスポンス後も実行を継続）
  waitUntil(
    trackGuildContext(data).catch((err) => {
      const anyErr = err as any;
      console.log('[discord][interactions] trackGuildContext failed', {
        isError: err instanceof Error,
        message: (err instanceof Error ? err.message : undefined) ?? anyErr?.message ?? anyErr?.error_description,
        code: anyErr?.code,
        status: anyErr?.status,
        raw: anyErr,
      });
    })
  );

  // APPLICATION_COMMAND
  if (data?.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = data?.data?.name;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    const isDm = !data?.guild_id;
    if (!userDiscordId) return ephemeral(COPY.common.noUser);

    if (name === 'setup') {
      if (isDm) return ephemeral(COPY.setup.guildOnly);
      const permissions: string | undefined = data?.member?.permissions;
      if (!hasAdminPermission(permissions)) {
        return ephemeral(COPY.setup.adminOnly);
      }
      const embed = {
        title: COPY.setup.embedTitle,
        description: COPY.setup.embedDescription,
        color: 0x5865f2,
      };
      const components = [
        {
          type: 1,
          components: [{ type: 2, style: 1, label: COPY.setup.dmButtonLabel, custom_id: 'unite:setup_open_dm' }],
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
        return ephemeral(COPY.notify.pingDone);
      }
      return ephemeral(COPY.legacy.useNewFlow);
    }

    if (name === 'register') {
      if (!isDm) {
        return ephemeral(COPY.register.dmOnly);
      }
      const rawUniteId = data?.data?.options?.find((o: { name?: string; value?: string }) => o.name === 'unite_player_id')?.value;
      const unitePlayerId = normalizeUniteId(rawUniteId);
      if (!unitePlayerId) {
        return ephemeral(COPY.register.prompt);
      }
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.register.responseMissing);
      }

      waitUntil(
        (async () => {
          try {
            console.log('[discord][interactions] register followup start', { userDiscordId, unitePlayerId });
            const guilds = await getUserGuildsForDm(userDiscordId);
            if (guilds.length === 0) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.register.noGuild,
                flags: 64,
              });
              return;
            }
            const result = await upsertRegistration(userDiscordId, unitePlayerId);
            const profileLine = buildRegisterProfileLine(result);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.register.success(unitePlayerId, profileLine),
              flags: 64,
            });
            console.log('[discord][interactions] register followup done', { userDiscordId, unitePlayerId });
          } catch (err) {
            console.log('[discord][interactions] register followup failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.register.error,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (name === 'notify') {
      if (!isDm) return ephemeral(COPY.notify.dmOnly);
      const mode = data?.data?.options?.find((o: { name?: string; value?: string }) => o.name === 'mode')?.value;
      if (mode !== 'on' && mode !== 'off') return ephemeral(COPY.notify.invalidMode);
      const guilds = await getUserGuildsForDm(userDiscordId);
      if (guilds.length === 0) return ephemeral(COPY.notify.noGuild);
      const svc = getServiceClient();
      await svc
        .from('discord_user_game_profiles')
        .update({ notify_enabled: mode === 'on', updated_at: nowIso() })
        .eq('discord_user_id', userDiscordId);
      return ephemeral(COPY.notify.updated(mode));
    }

    if (name === 'play') {
      if (!isDm) return ephemeral(COPY.play.dmOnly);
      const svc = getServiceClient();
      const { data: myProfile } = await svc
        .from('discord_user_game_profiles')
        .select('discord_user_id')
        .eq('discord_user_id', userDiscordId)
        .maybeSingle();
      if (!myProfile) return ephemeral(COPY.play.notRegistered);

      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.play.responseMissing);
      }

      waitUntil(
        (async () => {
          try {
            const rows = await buildPlayFriendRows(userDiscordId);
            const payload = buildPlayListPayload(rows);
            await sendInteractionFollowup(applicationId, interactionToken, {
              ...payload,
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] play followup failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.play.fetchError,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (name === 'premium') {
      if (!isDm) return ephemeral(COPY.premium.dmOnly);
      if (!BILLING_FEATURE_ENABLED) return ephemeral(COPY.billing.wip);
      try {
        const payload = buildPremiumIntroPayload();
        const premium = await ensurePremiumRow(userDiscordId);
        const statusLine = formatPremiumStatusForUser(premium);
        return ephemeralData({
          content: `${payload.content}\n\n${statusLine}`,
          embeds: payload.embeds,
          components: payload.components,
        });
      } catch (err) {
        console.log('[discord][interactions] premium command failed', err);
        const message =
          err instanceof Error && err.message.includes('is not set')
            ? COPY.premium.configError
            : COPY.premium.displayError;
        return ephemeral(message);
      }
    }

    if (name === 'plan') {
      if (!isDm) return ephemeral(COPY.plan.dmOnly);
      if (!BILLING_FEATURE_ENABLED) return ephemeral(COPY.billing.wip);
      const sub = data?.data?.options?.[0]?.name as string | undefined;

      if (sub === 'info' || !sub) {
        const billing = await ensureBilling(userDiscordId);
        const count = await countDiscordFriends(userDiscordId);
        const premium = await ensurePremiumRow(userDiscordId);
        const lines = [formatPlanStatus(billing, count), '', formatPremiumStatusForUser(premium)];
        return ephemeral(lines.join('\n'));
      }

      return ephemeral(COPY.plan.usePremium);
    }

    if (name === 'friend') {
      if (!isDm) return ephemeral(COPY.friend.dmOnly);
      const sub = data?.data?.options?.[0]?.name as string | undefined;

      if (sub === 'code') {
        return ephemeralData(buildFriendCodeGuidePayload());
      }

      if (sub === 'request') {
        const rawCode = data?.data?.options?.[0]?.options?.find((o: { name?: string; value?: string }) => o.name === 'code')?.value;
        if (!rawCode || typeof rawCode !== 'string') return ephemeral(COPY.friend.requestNeedCode);
        const applicationId: string | undefined = data?.application_id;
        const interactionToken: string | undefined = data?.token;
        if (!applicationId || !interactionToken) {
          return ephemeral(COPY.friend.requestResponseMissing);
        }

        const friendRequestErrorMessages: Record<string, string> = {
          invalid_code: COPY.friend.errors.invalid_code,
          expired: COPY.friend.errors.expired,
          self: COPY.friend.errors.self,
          already_friends: COPY.friend.errors.already_friends,
          already_pending: COPY.friend.errors.already_pending,
          owner_not_registered: COPY.friend.errors.owner_not_registered,
          requester_not_registered: COPY.friend.errors.requester_not_registered,
        };

        waitUntil(
          (async () => {
            try {
              const result = await submitFriendRequest(userDiscordId, rawCode);
              if (!result.ok) {
                await sendInteractionFollowup(applicationId, interactionToken, {
                  content: friendRequestErrorMessages[result.reason] ?? COPY.friend.errors.request_failed,
                  flags: 64,
                });
                return;
              }
              const svc = getServiceClient();
              const { data: requesterProfile } = await svc
                .from('discord_user_game_profiles')
                .select('unite_player_id,trainer_name')
                .eq('discord_user_id', userDiscordId)
                .maybeSingle();
              const displayName = formatRequesterDisplayName(
                requesterProfile?.trainer_name as string | null,
                requesterProfile?.unite_player_id as string | null
              );
              try {
                await sendDiscordDM(result.ownerDiscordUserId, {
                  content: COPY.friend.requestDmToOwner(displayName),
                  components: [
                    {
                      type: 1,
                      components: [
                        { type: 2, style: 3, label: COPY.friend.approveBtn, custom_id: `friend:req:approve:${result.requestId}` },
                        { type: 2, style: 4, label: COPY.friend.rejectBtn, custom_id: `friend:req:reject:${result.requestId}` },
                      ],
                    },
                  ],
                });
              } catch {
                await sendInteractionFollowup(applicationId, interactionToken, {
                  content: COPY.friend.requestDmFailed,
                  flags: 64,
                });
                return;
              }
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.friend.requestSentOk,
                flags: 64,
              });
            } catch (err) {
              console.log('[discord][interactions] friend request followup failed', err);
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.friend.requestError,
                flags: 64,
              }).catch(() => {});
            }
          })()
        );

        return jsonResponse({
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          data: { flags: 64 },
        });
      }

      if (sub === 'list') {
        const friends = await listDiscordFriends(userDiscordId);
        return ephemeral(`${COPY.friend.listHeader(friends.length)}\n${formatFriendListLines(friends)}`);
      }

      if (sub === 'manage') {
        const friends = await listDiscordFriends(userDiscordId);
        return ephemeralData(buildFriendManagePayload(friends));
      }

      if (sub === 'pending') {
        const pending = await listPendingFriendRequests(userDiscordId);
        if (pending.length === 0) return ephemeral(COPY.friend.pendingEmpty);
        const lines = pending.map((p) => formatPendingRequestLine(p)).join('\n');
        const components = pending.slice(0, 5).flatMap((p) => [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: COPY.friend.approveBtn, custom_id: `friend:req:approve:${p.id}` },
              { type: 2, style: 4, label: COPY.friend.rejectBtn, custom_id: `friend:req:reject:${p.id}` },
            ],
          },
        ]);
        return ephemeral(`${COPY.friend.pendingHeader(pending.length)}\n${lines}`, components);
      }

      return ephemeral(COPY.friend.unknownSub);
    }

    return ephemeral(COPY.common.unknownCommand);
  }

  // MESSAGE_COMPONENT
  if (data?.type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = data?.data?.custom_id;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    const selectedValues: string[] = Array.isArray(data?.data?.values) ? data.data.values : [];
    if (!userDiscordId) return ephemeral(COPY.common.noUser);

    if (customId === 'unite:setup_open_dm') {
      try {
        await sendDiscordDM(userDiscordId, { content: COPY.setup.dmWelcome });
        return ephemeral(COPY.setup.dmSentOk);
      } catch {
        return ephemeral(COPY.setup.dmSentNg);
      }
    }

    if (customId.startsWith('register:guild_select:')) {
      const unitePlayerId = customId.replace('register:guild_select:', '');
      if (!unitePlayerId) return ephemeral(COPY.register.missingInfo);
      const result = await upsertRegistration(userDiscordId, unitePlayerId);
      const profileLine = buildRegisterProfileLine(result);
      return ephemeral(COPY.register.success(unitePlayerId, profileLine));
    }

    if (customId === FRIEND_CODE_ISSUE_BUTTON_ID) {
      const { code } = await createFriendCode(userDiscordId);
      try {
        await sendDiscordDM(userDiscordId, { content: code });
        return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
      } catch {
        return ephemeral(COPY.friend.codeDmFailed);
      }
    }

    if (customId.startsWith('friend:remove:')) {
      const friendDiscordUserId = customId.replace('friend:remove:', '');
      if (!friendDiscordUserId) return ephemeral(COPY.friend.removeInvalid);
      const result = await removeDiscordFriend(userDiscordId, friendDiscordUserId);
      if (!result.ok) {
        const messages: Record<string, string> = {
          self: COPY.friend.removeSelf,
          not_friends: COPY.friend.removeNotFriend,
        };
        return ephemeral(messages[result.reason] ?? COPY.friend.removeFailed);
      }
      const friends = await listDiscordFriends(userDiscordId);
      const payload = buildFriendManagePayload(friends, COPY.friend.removed(result.displayName));
      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: payload,
      });
    }

    if (customId.startsWith('friend:req:approve:')) {
      const requestId = customId.replace('friend:req:approve:', '');
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.friend.approveResponseMissing);
      }
      const approveErrorMessages: Record<string, string> = {
        not_found: COPY.friend.errors.approve_not_found,
        not_owner: COPY.friend.errors.approve_not_owner,
        not_pending: COPY.friend.errors.approve_not_pending,
        already_friends: COPY.friend.errors.approve_already_friends,
        friend_limit_reached: COPY.friend.errors.approve_limit(ACTIVE_FRIEND_SLOT_LIMIT),
      };

      waitUntil(
        (async () => {
          try {
            const result = await approveFriendRequest(requestId, userDiscordId);
            if (!result.ok) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: approveErrorMessages[result.reason] ?? COPY.friend.errors.approve_failed,
                flags: 64,
              });
              return;
            }
            try {
              await sendDiscordDM(result.requesterDiscordUserId, {
                content: COPY.friend.approvedDmToRequester,
              });
            } catch {
              // DM 失敗は握りつぶす
            }
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.friend.approvedOk(result.friends.length, formatFriendListLines(result.friends)),
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] friend approve followup failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.friend.approveError,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (customId.startsWith('friend:req:reject:')) {
      const requestId = customId.replace('friend:req:reject:', '');
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.friend.rejectResponseMissing);
      }

      waitUntil(
        (async () => {
          try {
            const svc = getServiceClient();
            const { data: req } = await svc
              .from('discord_friend_requests')
              .select('requester_discord_user_id')
              .eq('id', requestId)
              .maybeSingle();
            const result = await rejectFriendRequest(requestId, userDiscordId);
            if (!result.ok) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.friend.rejectFailed,
                flags: 64,
              });
              return;
            }
            if (req?.requester_discord_user_id) {
              try {
                await sendDiscordDM(req.requester_discord_user_id as string, {
                  content: COPY.friend.rejectedDmToRequester,
                });
              } catch {
                // ignore
              }
            }
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.friend.rejectedOk,
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] friend reject followup failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.friend.rejectError,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
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
      return ephemeral(COPY.notify.pingDone);
    }

    if (customId === 'play:invite_all') {
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.play.inviteAllResponseMissing);
      }

      waitUntil(
        (async () => {
          try {
            const rows = await buildPlayFriendRows(userDiscordId);
            const targets = rows.filter((r) => r.unitePlayerId);
            if (targets.length === 0) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.play.noInviteTargets,
                flags: 64,
              });
              return;
            }
            const senderName = await getPlaySenderDisplayName(userDiscordId);
            const payload = buildPlayInvitePayload(senderName, userDiscordId);
            const invited: string[] = [];
            const failed: string[] = [];
            for (const target of targets) {
              try {
                await sendDiscordDM(target.discordUserId, payload);
                invited.push(target.displayName);
              } catch {
                failed.push(target.displayName);
              }
            }
            const failLine =
              failed.length > 0 ? COPY.play.inviteAllFailSuffix(failed.slice(0, 5).join('、')) : '';
            const content =
              invited.length > 0
                ? COPY.play.inviteAllSent(invited.join('、'), failLine)
                : COPY.play.inviteAllNone(failLine);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content,
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] play invite_all failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.play.inviteAllError,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (customId.startsWith('play:invite:')) {
      const targetDiscordUserId = customId.replace('play:invite:', '');
      if (!targetDiscordUserId) return ephemeral(COPY.play.invalidTarget);
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral(COPY.play.inviteResponseMissing);
      }

      waitUntil(
        (async () => {
          try {
            if (!(await areFriends(userDiscordId, targetDiscordUserId))) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: COPY.play.notFriend,
                flags: 64,
              });
              return;
            }
            const senderName = await getPlaySenderDisplayName(userDiscordId);
            const targetName = await getPlaySenderDisplayName(targetDiscordUserId);
            await sendDiscordDM(targetDiscordUserId, buildPlayInvitePayload(senderName, userDiscordId));
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.play.inviteSent(targetName),
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] play invite failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.play.inviteFailed,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (customId.startsWith('play:reply:')) {
      const parts = customId.split(':');
      const replyCode = parts[2];
      const senderDiscordUserId = parts[3];
      const message = PLAY_REPLY_MESSAGES[replyCode];
      if (!message || !senderDiscordUserId) return ephemeral(COPY.play.replyFailed);

      waitUntil(
        (async () => {
          try {
            const responderName = await getPlaySenderDisplayName(userDiscordId);
            await sendDiscordDM(senderDiscordUserId, {
              content: COPY.play.replyNotify(responderName, message),
            });
          } catch (err) {
            console.log('[discord][interactions] play reply failed', err);
          }
        })()
      );

      return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    if (customId === 'play:close') {
      return jsonResponse({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: { content: COPY.play.menuClosed, components: [], embeds: [] },
      });
    }

    if (customId === PREMIUM_REPORT_BUTTON_ID) {
      if (!BILLING_FEATURE_ENABLED) return ephemeral(COPY.billing.wip);
      if (data?.guild_id) {
        return ephemeral(COPY.premium.reportInDm);
      }
      try {
        return jsonResponse({
          type: InteractionResponseType.MODAL,
          data: buildPaymentReportModal(),
        });
      } catch (err) {
        console.log('[discord][interactions] premium modal failed', err);
        return ephemeral(COPY.premium.modalFailed);
      }
    }

    if (customId.startsWith('premium:req:approve:')) {
      if (!canReviewPremiumPayment(data)) {
        return ephemeral(COPY.common.adminOnly);
      }
      const requestId = customId.replace('premium:req:approve:', '');
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral('承認処理の返信が作れなかった… もう一回試してね');
      }

      waitUntil(
        (async () => {
          try {
            const result = await approvePaymentRequest(requestId, userDiscordId);
            const originalContent = data?.message?.content ?? '';
            if (!result.ok) {
              await editDeferredInteractionMessage(applicationId, interactionToken, {
                content: `${originalContent}\n\n---\n⚠️ ${result.message}`,
                components: [],
              }).catch(() => {});
              return;
            }
            await editDeferredInteractionMessage(applicationId, interactionToken, {
              content: `${originalContent}\n\n---\n✅ **承認済み**（<@${userDiscordId}>）`,
              components: [],
            });
          } catch (err) {
            console.log('[discord][interactions] premium approve failed', err);
            await editDeferredInteractionMessage(applicationId, interactionToken, {
              content: `${data?.message?.content ?? ''}\n\n---\n⚠️ 承認処理中にエラーが発生しました。`,
              components: [],
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    if (customId.startsWith('premium:req:reject:')) {
      if (!canReviewPremiumPayment(data)) {
        return ephemeral(COPY.common.adminOnly);
      }
      const requestId = customId.replace('premium:req:reject:', '');
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      if (!applicationId || !interactionToken) {
        return ephemeral('却下処理の返信が作れなかった… もう一回試してね');
      }

      waitUntil(
        (async () => {
          try {
            const result = await rejectPaymentRequest(requestId, userDiscordId);
            const originalContent = data?.message?.content ?? '';
            if (!result.ok) {
              await editDeferredInteractionMessage(applicationId, interactionToken, {
                content: `${originalContent}\n\n---\n⚠️ ${result.message}`,
                components: [],
              }).catch(() => {});
              return;
            }
            await editDeferredInteractionMessage(applicationId, interactionToken, {
              content: `${originalContent}\n\n---\n❌ **却下済み**（<@${userDiscordId}>）`,
              components: [],
            });
          } catch (err) {
            console.log('[discord][interactions] premium reject failed', err);
            await editDeferredInteractionMessage(applicationId, interactionToken, {
              content: `${data?.message?.content ?? ''}\n\n---\n⚠️ 却下処理中にエラーが発生しました。`,
              components: [],
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    return ephemeral(COPY.common.unknownButton);
  }

  if (data?.type === InteractionType.MODAL_SUBMIT) {
    const modalId: string = data?.data?.custom_id;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    if (!userDiscordId) return ephemeral(COPY.common.noUser);

    if (modalId === PREMIUM_MODAL_ID) {
      if (!BILLING_FEATURE_ENABLED) return ephemeral(COPY.billing.wip);
      const applicationId: string | undefined = data?.application_id;
      const interactionToken: string | undefined = data?.token;
      const username = discordUsernameFromInteraction(data);

      waitUntil(
        (async () => {
          if (!applicationId || !interactionToken) return;
          try {
            const values = parseModalValues(data.data);
            const result = await createPaymentRequest(userDiscordId, username, values);
            if (!result.ok) {
              await sendInteractionFollowup(applicationId, interactionToken, {
                content: result.message,
                flags: 64,
              });
              return;
            }
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.premium.reportAccepted,
              flags: 64,
            });
          } catch (err) {
            console.log('[discord][interactions] premium modal submit failed', err);
            await sendInteractionFollowup(applicationId, interactionToken, {
              content: COPY.premium.reportSaveError,
              flags: 64,
            }).catch(() => {});
          }
        })()
      );

      return jsonResponse({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    return ephemeral(COPY.common.unknownModal);
  }

  return new Response('OK');
}


