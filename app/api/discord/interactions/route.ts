import { NextRequest } from 'next/server';
import { verifyDiscordRequest } from '../../../../lib/verify';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export async function POST(req: NextRequest) {
  const verified = await verifyDiscordRequest(req as unknown as Request);
  if (!verified.valid) return new Response('Bad signature', { status: 401 });
  const { body } = verified;
  const data = JSON.parse(body || '{}');

  // PING
  if (data?.type === InteractionType.PING) {
    return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), { headers: { 'Content-Type': 'application/json' } });
  }

  // APPLICATION_COMMAND
  if (data?.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = data?.data?.name;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;

    if (name === 'unite' && data?.data?.options?.[0]?.name === 'ping') {
      // 内部エンドポイントを起動（ownerを呼び出しユーザーに）
      await fetch(`${process.env.APP_BASE_URL}/api/unite/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SHARED_SECRET || '',
        },
        body: JSON.stringify({ owner_discord_id: userDiscordId }),
      });

      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'チェックを実行しました。', flags: 64 }, // ephemeral
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (name === 'unite' && data?.data?.options?.[0]?.name === 'add') {
      const trainerId = data?.data?.options?.[0]?.options?.find((o: any) => o.name === 'friend_unite_id')?.value;
      const label = data?.data?.options?.[0]?.options?.find((o: any) => o.name === 'label')?.value;
      if (!trainerId || !userDiscordId) {
        return new Response(JSON.stringify({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '引数が不足しています', flags: 64 } }), { headers: { 'Content-Type': 'application/json' } });
      }
      // アプリ側に登録（サービスロールで owner をDiscordユーザーに紐付け）
      await fetch(`${process.env.APP_BASE_URL}/api/unite/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SHARED_SECRET || '',
        },
        body: JSON.stringify({ owner_discord_id: userDiscordId }),
      });
      // SupabaseへのUPSERTは /api/friends へ（owner本人のJWTが必要だが、Botからは不可）
      // 簡易対応としてはエフェメラルで案内
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'ダッシュボードで友達を追加してください: /dashboard', flags: 64 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (name === 'unite' && data?.data?.options?.[0]?.name === 'list') {
      // 最小実装: ボタン付きの案内
      const components = [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '今チェック', custom_id: 'unite:check_now' },
          ],
        },
      ];
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '友達一覧はダッシュボードで確認できます。', components, flags: 64 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '未対応のコマンドです', flags: 64 } }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // MESSAGE_COMPONENT
  if (data?.type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = data?.data?.custom_id;
    const userDiscordId: string | undefined = data?.member?.user?.id || data?.user?.id;
    if (customId === 'unite:check_now' && userDiscordId) {
      await fetch(`${process.env.APP_BASE_URL}/api/unite/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_SHARED_SECRET || '',
        },
        body: JSON.stringify({ owner_discord_id: userDiscordId }),
      });

      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'チェックを実行しました。', flags: 64 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: '未対応のボタンです', flags: 64 } }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response('OK');
}


