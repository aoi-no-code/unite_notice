import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;

if (!token || !applicationId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
  process.exit(1);
}

const commands = [
  {
    name: 'register',
    description: 'DMでゲーム内IDを登録',
    type: 1,
    options: [{ type: 3, name: 'unite_player_id', description: 'ポケモンユナイトのゲーム内ID', required: true }],
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'play',
    description: 'フレンドの最新対戦を見て誘う',
    type: 1,
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'notify',
    description: 'DM通知のON/OFFを切り替える',
    type: 1,
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
    name: 'plan',
    description: 'プラン確認・フレンド枠のアップグレード',
    type: 1,
    options: [
      { type: 1, name: 'info', description: '現在のプランとフレンド枠を表示' },
      { type: 1, name: 'upgrade', description: 'Plusを申し込む（月額300円）' },
      { type: 1, name: 'portal', description: '契約の解約・支払い変更（Stripe）' },
    ],
    dm_permission: true,
    contexts: [1, 2],
  },
  {
    name: 'friend',
    description: 'フレンド管理',
    type: 1,
    options: [
      { type: 1, name: 'code', description: 'フレンド追加用コードを発行（7日間有効）' },
      {
        type: 1,
        name: 'request',
        description: 'コードを使ってフレンド申請を送る',
        options: [{ type: 3, name: 'code', description: '相手から受け取った8文字コード', required: true }],
      },
      { type: 1, name: 'list', description: '現在のフレンド一覧を表示' },
      { type: 1, name: 'manage', description: 'フレンド一覧から削除して整理' },
      { type: 1, name: 'pending', description: '届いているフレンド申請を表示' },
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
