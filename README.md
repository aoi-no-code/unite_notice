## Pokemon UNITE Notice (UniteFriends)

Discord のスラッシュコマンド / ボタンで、登録したフレンドのプレイ状況を確認し、アクティブなら DM で「今やろう？」と通知する **Discord Bot 専用** アプリです。

### Tech Stack

- Next.js 14（API Routes のみ）
- Supabase（Postgres）
- Discord Bot（Slash Commands + Component Interactions）

### セットアップ

1. Discord Developer Portal … Bot、Interactions Endpoint、トークン類
2. Supabase … `supabase/schema.sql` + migrations
3. 環境変数 … `env.sample` 参照
4. コマンド登録 … `npm run discord:register-commands` / `discord:register-global-commands`

### フレンド追加（DM のみ）

1. **A** が DM で `/friend code` → 8文字コード（7日有効）を **B** に伝える
2. **B** が Bot の DM で `/friend request <コード>`
3. **A** に DM で申請通知（承認 / 拒否ボタン）
4. **A** が承認 → **フレンド一覧**を表示。`/friend list` でも確認可能

### Discord コマンド

| コマンド | 説明 |
|----------|------|
| `/register` | ゲーム内 ID 登録 |
| `/friend code` | フレンド追加用コード発行 |
| `/friend request` | コードでフレンド申請 |
| `/friend pending` | 保留中の申請一覧 |
| `/friend list` | フレンド一覧 |
| `/friend manage` | フレンド整理（ボタンで削除） |
| `/play` | フレンドの最新対戦（時間・パーティ）を表示し、誘い DM を送る |
| `/plan info` | プラン・フレンド枠の確認 |
| `/plan upgrade` | Plus（5人枠・300円）へアップグレード |
| `/notify on\|off` | 通知 ON/OFF |
| `/setup` | サーバー内案内（管理者） |

### 環境変数

- `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
- `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`
- `INTERNAL_SHARED_SECRET`, `POLL_WINDOW_MINUTES`, `UNITEAPI_BASE`

### 課金プラン

| プラン | フレンド上限 | 料金 |
|--------|-------------|------|
| 無料 | 3人 | 0円 |
| Plus | 5人 | 300円（買い切り） |

- DM で `/plan info` / `/plan upgrade`
- Stripe Checkout → Webhook `POST /api/billing/webhook` で枠を反映
- 環境変数: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`（Stripe で 300円の Price を作成し ID を設定）

### Supabase マイグレーション（本番）

順に実行:

1. `20260521_add_unite_api_uid.sql`
2. `20260522_discord_friend_requests.sql`
3. `20260523_discord_user_billing.sql`
