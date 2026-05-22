const DISCORD_API = 'https://discord.com/api/v10';

async function discordApi(path: string, init: RequestInit) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  const res = await fetch(`${DISCORD_API}${path}`, {
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

export function getPremiumGuildId(): string {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error('DISCORD_GUILD_ID is not set');
  return guildId;
}

export function getPremiumRoleId(): string {
  const roleId = process.env.PREMIUM_ROLE_ID;
  if (!roleId) throw new Error('PREMIUM_ROLE_ID is not set');
  return roleId;
}

export async function addPremiumRole(discordUserId: string): Promise<void> {
  const guildId = getPremiumGuildId();
  const roleId = getPremiumRoleId();
  await discordApi(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: 'PUT',
  });
}

export async function removePremiumRole(discordUserId: string): Promise<void> {
  const guildId = getPremiumGuildId();
  const roleId = getPremiumRoleId();
  await discordApi(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: 'DELETE',
  });
}

export async function fetchDiscordUser(discordUserId: string): Promise<{
  id: string;
  username: string;
  global_name: string | null;
}> {
  const res = await discordApi(`/users/${discordUserId}`, { method: 'GET' });
  return res.json();
}

export function formatDiscordDisplayName(user: {
  global_name?: string | null;
  username?: string;
}): string {
  return user.global_name?.trim() || user.username?.trim() || '不明';
}
