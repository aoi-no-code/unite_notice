import { NextRequest } from 'next/server';
import { getServiceClient, getOrCreateUserByDiscordId } from '../../../../lib/db';
import { runUnitePing } from '../../../../lib/unitePing';

function isAuthorizedInternal(req: NextRequest): boolean {
  const header = req.headers.get('x-internal-secret') || '';
  const secret = process.env.INTERNAL_SHARED_SECRET || '';
  return !!secret && header === secret;
}

export async function POST(req: NextRequest) {
  // internal呼び出し or Discord interactions内からのサーバ内部呼出し想定
  if (!isAuthorizedInternal(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ownerDiscordId: string | undefined = body.owner_discord_id || body.owner_discord_id;

  try {
    const svc = getServiceClient();
    let ownerUserId: string | null = null;

    if (ownerDiscordId) {
      const { id } = await getOrCreateUserByDiscordId(ownerDiscordId);
      ownerUserId = id;
    } else if (body.owner_user_id) {
      ownerUserId = String(body.owner_user_id);
    }

    if (!ownerUserId) {
      return new Response(JSON.stringify({ error: 'owner not specified' }), { status: 400 });
    }

    const pollWindowMinutes = Number(process.env.POLL_WINDOW_MINUTES ?? '30');
    const defaultChannelId = process.env.DISCORD_DEFAULT_CHANNEL_ID!;

    const result = await runUnitePing({
      supabase: svc,
      ownerUserId,
      pollWindowMinutes,
      defaultChannelId,
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Internal Error' }), { status: 500 });
  }
}


