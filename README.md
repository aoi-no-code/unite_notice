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
4. Supabase Auth（Discord ログイン）
   - Authentication → Providers で **Discord** を有効化し、Discord Developer Portal の Client ID / Secret を設定
   - Authentication → URL Configuration に次を追加（本番ドメインに置き換え）
     - `http://localhost:3000/auth/callback`
     - `https://<あなたのドメイン>/auth/callback`
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を `.env.local` に設定（未設定の場合は `SUPABASE_URL` / `SUPABASE_ANON_KEY` と同じ値で可）
5. Next.js デプロイ
   - `APP_BASE_URL` が `https://...` になるよう本番URLを設定
6. Discord Interactions Endpoint
   - `APP_BASE_URL/api/discord/interactions` を登録
7. Slash Commands 登録
   - Guild コマンド（`/setup`, `/register`, `/play`, `/notify`）を登録（手動 or API）

### 環境変数
`env.sample` を参照。主なキー:
- DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_DEFAULT_CHANNEL_ID, DISCORD_GUILD_ID
- APP_BASE_URL, UNITEAPI_BASE, POLL_WINDOW_MINUTES, INTERNAL_SHARED_SECRET
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY（ブラウザからの Discord OAuth 用）

### データベース
`supabase/schema.sql` を実行。
- Discord サーバー情報は `discord_guilds`、サーバー内利用ユーザーは `discord_guild_members` に保存されます（Interactions受信時に更新）。

### Web ログイン（Discord のみ）
- `GET /login` … Discord のみのログインページ
- `GET /auth/callback` … Supabase OAuth コールバック（セッション確立後、`public.users` を同期）
- `GET /auth/signout` … ログアウト

### 通知先の優先順位
- ログインユーザーの Discord ID に DM 送信
- 送信できない場合: `DISCORD_DEFAULT_CHANNEL_ID` があればそこへ送信（フォールバック）

### エンドポイント
- POST `/api/friends` / GET `/api/friends`
  - `friend_links` 廃止に伴い現在は `410 Gone` を返却
- POST `/api/unite/ping`
  - 内部専用（`x-internal-secret` 必須）
  - body: `{ owner_discord_id?: string, owner_user_id?: string }`
  - 対象フレンドの最終ログインを取得し、条件一致でDiscordへ送信、送信ログ記録（2時間の再送抑止）
- POST `/api/discord/interactions`
  - 署名検証、PING/COMMAND/COMPONENT に応答
  - `/setup`（サーバー内専用） → DM中心運用の案内Embedを投稿
  - `/register`（DM専用） → ゲーム内IDをサーバーに紐づけて登録
  - `/play`（DM専用） → 同一サーバー内の候補を検索して通知
  - `/notify on|off`（DM専用） → 通知可否を切替

### ライブラリ
- `lib/unite.ts` UniteAPI からプロフィール情報/最終ログイン（UTC）を抽出
- `lib/discord.ts` Discordへメッセージ/フォローアップ送信
- `lib/verify.ts` Interactions 署名検証（tweetnacl）
- `lib/db.ts` Supabase クライアント（サービスロール/ユーザRLS）
- `lib/unitePing.ts` ポーリング本体（`friendships` ベースで通知）

### Uniteプロフィール取得（IDをあとで渡せる）
`lib/unite.ts` の `fetchUniteProfile(identifier)` で、プレイヤー名 or 短縮ID を渡してプロフィールを取得できます。

```ts
import { fetchUniteProfile, fetchLastOnline } from '@/lib/unite';
import { fetchLatestBattleAt } from '@/lib/unite';

const profile = await fetchUniteProfile('shingpyí'); // 例: プレイヤー名
// const profile = await fetchUniteProfile('MRC2LQT'); // 例: 短縮ID

if (profile) {
  console.log(profile.profile.uid);
  console.log(profile.profile.playerName);
  console.log(profile.profile.lastLogoutTime);
}

const { lastOnline } = await fetchLastOnline('shingpyí');
console.log(lastOnline?.toISOString());

const { latestBattleAt } = await fetchLatestBattleAt('shingpyí');
console.log(latestBattleAt?.toISOString()); // バトル記録の最新日時
```

補足:
- 内部で `/_next/data/.../p/{identifier}.json` を取得し、暗号化ペイロードを復号して利用します
- 先方仕様変更で取得できなくなる可能性があるため、呼び出し側で `null` を許容してください

### 動作確認
- `/setup` → サーバー内に案内Embedを投稿
- DMで `/register <ID>` → サーバー選択して登録
- DMで `/play` → 最近プレイ候補を表示し通知
- DMで `/notify off` → 通知停止

### Slash Commands 登録コマンド
- `.env.local` に `DISCORD_BOT_TOKEN` / `DISCORD_APPLICATION_ID` / `DISCORD_GUILD_ID` を設定
- 実行: `npm run discord:register-commands`

### 備考
- 2時間以内に同一フレンドへの重複通知を避けます
- `POLL_WINDOW_MINUTES` で「アクティブ」の閾値を調整します
- `users.max_friend_slots` でフレンド枠の上限を管理できます（将来の課金プラン解放向け）
