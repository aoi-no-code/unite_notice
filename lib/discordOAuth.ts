const DISCORD_API = 'https://discord.com/api/v10';

export function getFriendInviteOAuthRedirectUri(): string {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('APP_BASE_URL is not set');
  return `${base}/api/friend-invites/callback`;
}

export function buildDiscordAuthorizeUrl(state: string): string {
  const clientId = process.env.DISCORD_APPLICATION_ID;
  if (!clientId) throw new Error('DISCORD_APPLICATION_ID is not set');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getFriendInviteOAuthRedirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export async function fetchDiscordUserIdFromOAuthCode(code: string): Promise<string> {
  const clientId = process.env.DISCORD_APPLICATION_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('DISCORD_APPLICATION_ID / DISCORD_CLIENT_SECRET is not set');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getFriendInviteOAuthRedirectUri(),
  });

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Discord OAuth token error ${tokenRes.status}: ${text}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('Discord OAuth access_token missing');

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) {
    const text = await userRes.text().catch(() => '');
    throw new Error(`Discord OAuth user error ${userRes.status}: ${text}`);
  }

  const user = (await userRes.json()) as { id?: string };
  if (!user.id) throw new Error('Discord OAuth user id missing');
  return user.id;
}
