type DiscordMessagePayload = {
  content?: string;
  embeds?: any[];
  components?: any[];
  flags?: number;
};

export async function sendDiscord(channelId: string, payload: DiscordMessagePayload) {
  const token = process.env.DISCORD_BOT_TOKEN!;
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function sendInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  payload: DiscordMessagePayload
) {
  // flags=64 でエフェメラル
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}


