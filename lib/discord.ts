type DiscordMessagePayload = {
  content?: string;
  embeds?: any[];
  components?: any[];
  flags?: number;
};

async function discordApi(path: string, init: RequestInit) {
  const token = process.env.DISCORD_BOT_TOKEN!;
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API error ${res.status}: ${body || 'unknown error'}`);
  }
  return res;
}

export async function sendDiscord(channelId: string, payload: DiscordMessagePayload) {
  await discordApi(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function sendDiscordDM(discordUserId: string, payload: DiscordMessagePayload): Promise<string> {
  const dmRes = await discordApi('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  const dm = (await dmRes.json()) as { id?: string };
  if (!dm.id) {
    throw new Error('Discord DM channel id not found');
  }
  await sendDiscord(dm.id, payload);
  return dm.id;
}

export async function sendInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  payload: DiscordMessagePayload
) {
  // flags=64 でエフェメラル（interaction token URL のみで認可）
  const res = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord followup error ${res.status}: ${body || 'unknown error'}`);
  }
}


