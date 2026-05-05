import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;

if (!token || !applicationId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
  process.exit(1);
}

// グローバルコマンドは反映に時間がかかることがあります（数分〜）。
// DMで候補として出したいコマンドは dm_permission=true にします。
const commands = [
  {
    name: 'register',
    description: 'DMでゲーム内IDを登録',
    type: 1, // CHAT_INPUT
    options: [{ type: 3, name: 'unite_player_id', description: 'ポケモンユナイトのゲーム内ID', required: true }],
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'play',
    description: 'DMで最近プレイしている候補を探す',
    type: 1, // CHAT_INPUT
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'notify',
    description: 'DM通知のON/OFFを切り替える',
    type: 1, // CHAT_INPUT
    options: [
      {
        type: 3,
        name: 'mode',
        description: '通知設定',
        required: true,
        choices: [
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ],
      },
    ],
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'friend',
    description: 'フレンド管理',
    type: 1, // CHAT_INPUT
    options: [
      { type: 1, name: 'find', description: '同じサーバー内からフレンド候補を探す' },
      { type: 1, name: 'invite', description: 'サーバー外ユーザー向けの招待URLを発行する' },
      {
        type: 1,
        name: 'accept',
        description: '招待トークンでフレンド追加する',
        options: [{ type: 3, name: 'token', description: '招待トークン', required: true }],
      },
    ],
    dm_permission: true,
    contexts: [1, 2],
  },
];

async function registerGlobalCommands() {
  const url = `https://discord.com/api/v10/applications/${applicationId}/commands`;
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
    console.error('Failed to register global commands:', res.status, text);
    process.exit(1);
  }
  const json = await res.json();
  console.log(
    'Registered global commands:',
    json.map((c) => ({
      id: c.id,
      name: c.name,
      dm_permission: c.dm_permission,
    }))
  );
}

registerGlobalCommands().catch((err) => {
  console.error(err);
  process.exit(1);
});

