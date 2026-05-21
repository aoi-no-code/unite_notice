## Pokemon UNITE Notice (UniteFriends)

Discord のスラッシュコマンド / ボタンで、登録したフレンドのプレイ状況を確認し、アクティブなら DM で「今やろう？」と通知する **Discord Bot 専用** アプリです。

### Tech Stack

- Next.js 14（API Routes のみ。Web UI なし）
- Supabase（Postgres）
- Discord Bot（Slash Commands + Component Interactions）

### セットアップ

1. **Discord Developer Portal**
   - アプリ + Bot 作成、Bot をサーバーに招待
   - `PUBLIC KEY` を控える
   - Interactions Endpoint: `https://<ドメイン>/api/discord/interactions`
2. **Supabase**
   - `supabase/schema.sql` を実行（Discord 用テーブル）
   - 本番では `20260430_drop_public_users.sql` 済み想定（Web 用 `users` は不要）
3. **環境変数**
   - `env.sample` を `.env.local` にコピーして設定
   - Vercel にも同様に設定
4. **Slash Commands**
   - ギルド: `npm run discord:register-commands`（`/setup`）
   - グローバル: `npm run discord:register-global-commands`（`/register`, `/play`, `/notify`, `/friend`）

### 環境変数（主要）

- `APP_BASE_URL` … 本番 URL（Interactions 内部呼び出し用）
- `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
- `INTERNAL_SHARED_SECRET`, `POLL_WINDOW_MINUTES`, `UNITEAPI_BASE`

### Discord コマンド（DM 中心）

| コマンド | 説明 |
|----------|------|
| `/setup` | サーバー内案内（管理者・サーバーのみ） |
| `/register` | ゲーム内 ID 登録 |
| `/friend find` | 同じサーバー内からフレンド追加 |
| `/friend invite` | 招待トークン発行（相手は `/friend accept`） |
| `/friend accept` | 招待トークンでフレンド追加 |
| `/play` | フレンドの直近プレイ候補を検索 |
| `/notify on\|off` | 通知 ON/OFF |

### API

- `POST /api/discord/interactions` … Discord Interactions
- `POST /api/unite/ping` … 内部用ポーリング（`x-internal-secret` + `owner_discord_id`）

### データ（Discord 用）

- `discord_users`, `discord_user_game_profiles`
- `discord_guilds`, `discord_guild_members`
- `discord_friendships`, `discord_friend_invites`

### ライブラリ

- `lib/unite.ts` … UniteAPI からプロフィール取得
- `lib/discord.ts` … Discord API
- `lib/unitePing.ts` … `discord_friendships` ベースの通知
- `lib/db.ts` … Supabase サービスロール
