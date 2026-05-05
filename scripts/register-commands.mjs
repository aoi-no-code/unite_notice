import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Node.js 20+ (fetch 同梱)
const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !applicationId || !guildId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID or DISCORD_GUILD_ID');
  process.exit(1);
}

const commands = [
  {
    name: 'setup',
    description: 'サーバー向け案内メッセージを投稿',
    type: 1, // CHAT_INPUT
    dm_permission: false,
  },
];

async function registerGuildCommands() {
  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to register commands:', res.status, text);
    process.exit(1);
  }
  const json = await res.json();
  console.log('Registered commands:', json.map((c) => ({ id: c.id, name: c.name })));
}

registerGuildCommands().catch((err) => {
  console.error(err);
  process.exit(1);
});


