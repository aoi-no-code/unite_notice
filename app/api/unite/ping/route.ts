import { NextRequest } from 'next/server';
import { getServiceClient } from '../../../../lib/db';
import { runUnitePing } from '../../../../lib/unitePing';

function isAuthorizedInternal(req: NextRequest): boolean {
  const header = req.headers.get('x-internal-secret') || '';
  const secret = process.env.INTERNAL_SHARED_SECRET || '';
  return !!secret && header === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedInternal(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ownerDiscordId: string | undefined = body.owner_discord_id;

  if (!ownerDiscordId) {
    return new Response(JSON.stringify({ error: 'owner_discord_id is required' }), { status: 400 });
  }

  try {
    const svc = getServiceClient();
    const pollWindowMinutes = Number(process.env.POLL_WINDOW_MINUTES ?? '30');
    const defaultChannelId = process.env.DISCORD_DEFAULT_CHANNEL_ID || undefined;

    const result = await runUnitePing({
      supabase: svc,
      ownerDiscordId,
      pollWindowMinutes,
      defaultChannelId,
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal Error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
