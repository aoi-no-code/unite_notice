## Pokemon UNITE Notice App

Discordのスラッシュコマンド/ボタン操作で、登録した友達の「最終ログイン」を確認し、一定時間内にアクティブならDiscordに「今やろう？」通知を送るアプリです。

### Tech Stack
- Next.js 14 (App Router, TypeScript)
- Supabase (Postgres, Auth, RLS)
- Discord Bot (Slash Commands + Component Interactions)
- Node.js 20

### セットアップ
1. Discord Developer Portal
   - アプリ+Bot作成、Botをサーバに招待
   - PUBLIC KEY を控える
2. Supabase
   - プロジェクト作成
   - `supabase/schema.sql` を実行（RLS有効化を含む）
3. 環境変数
   - ルートの `env.sample` を参考に `.env.local` を作成
   - Vercel へデプロイ時も同様に環境変数を設定
4. Next.js デプロイ
   - `APP_BASE_URL` が `https://...` になるよう本番URLを設定
5. Discord Interactions Endpoint
   - `APP_BASE_URL/api/discord/interactions` を登録
6. Slash Commands 登録
   - Guild コマンドで `/unite` サブコマンド（`ping`, `add`, `list`）を登録（手動 or API）

### 環境変数
`env.sample` を参照。主なキー:
- DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_DEFAULT_CHANNEL_ID, DISCORD_GUILD_ID
- APP_BASE_URL, UNITEAPI_BASE, POLL_WINDOW_MINUTES, INTERNAL_SHARED_SECRET
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE

### データベース
`supabase/schema.sql` を実行。

### エンドポイント
- POST `/api/friends`
  - body: `{ friend_unite_id: string, friend_label?: string, notify_channel_id?: string }`
  - 認証必須（Supabase Auth、Bearer トークン）
  - `friend_links` へ UPSERT
- GET `/api/friends`
  - ログインユーザーの `friend_links` を返却
- POST `/api/unite/ping`
  - 内部専用（`x-internal-secret` 必須）
  - body: `{ owner_discord_id?: string, owner_user_id?: string }`
  - 対象フレンドの最終ログインを取得し、条件一致でDiscordへ送信、送信ログ記録（2時間の再送抑止）
- POST `/api/discord/interactions`
  - 署名検証、PING/COMMAND/COMPONENT に応答
  - `/unite ping` → 内部エンドポイント呼び出し→エフェメラル返信
  - `/unite add` → 現状はダッシュボード案内（安全のためBotから直接UPSERTしない）
  - `/unite list` → ボタン（`unite:check_now`）付き案内
  - `unite:check_now` → 内部エンドポイント呼び出し→エフェメラル返信

### ライブラリ
- `lib/unite.ts` UniteAPI から最終ログイン（UTC）を抽出
- `lib/discord.ts` Discordへメッセージ/フォローアップ送信
- `lib/verify.ts` Interactions 署名検証（tweetnacl）
- `lib/db.ts` Supabase クライアント（サービスロール/ユーザRLS）
- `lib/unitePing.ts` ポーリング本体（通知/重複抑止/記録）

### 動作確認
- `/unite add <ID>` → ダッシュボードで登録
- `/unite list` → ボタンから「今チェック」
- `/unite ping` → 即時チェック・通知

### 備考
- 2時間以内に同一フレンドへの重複通知を避けます
- `POLL_WINDOW_MINUTES` で「アクティブ」の閾値を調整します
