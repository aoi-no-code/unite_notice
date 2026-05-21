-- =============================================================================
-- Pokemon UNITE Notice — public スキーマ（Auth 以外）
-- Supabase の SQL Editor に貼り付けて実行してください。
-- auth.users / auth.identities は Supabase が管理するため、このファイルでは触りません。
--
-- アプリの前提:
-- - Discord利用者は public.discord_users / public.discord_guild_members で管理します
-- =============================================================================

-- -----------------------------------------------------------------------------
-- テーブル
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'player')),
  plan_tier text NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
  max_friend_slots integer NOT NULL DEFAULT 5 CHECK (max_friend_slots > 0),
  discord_id text UNIQUE,
  trainer_name text,
  unite_trainer_id text CHECK (unite_trainer_id IS NULL OR unite_trainer_id ~ '^[A-Za-z0-9]+$'),
  unite_api_uid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Discordユーザーの正規化テーブル（auth.users 非依存）
CREATE TABLE IF NOT EXISTS public.discord_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free';
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS max_friend_slots integer NOT NULL DEFAULT 5;
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_plan_tier_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_tier_check CHECK (plan_tier IN ('free', 'pro'));
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_max_friend_slots_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_max_friend_slots_check CHECK (max_friend_slots > 0);

-- フレンド申請（誰→誰、承認/拒否状態）
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  addressee_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_user_id <> addressee_user_id)
);

-- 承認済みフレンド関係（稼働中かどうかを管理）
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_from_request_id uuid REFERENCES public.friend_requests (id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_low_id < user_high_id)
);

-- 通知（申請到着・承認・拒否など）
CREATE TABLE IF NOT EXISTS public.notifications (
  id bigserial PRIMARY KEY,
  recipient_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('friend_request_received', 'friend_request_approved', 'friend_request_rejected')),
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- トレーナーネーム変更履歴
CREATE TABLE IF NOT EXISTS public.trainer_name_histories (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  unite_trainer_id text NOT NULL,
  old_trainer_name text,
  new_trainer_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('login', 'set_trainer_id')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Discord サーバー情報（Botが導入されているGuild）
CREATE TABLE IF NOT EXISTS public.discord_guilds (
  id text PRIMARY KEY,
  name text,
  icon text,
  owner_id text,
  preferred_locale text,
  features jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Discord サーバー内のBot利用メンバー情報
CREATE TABLE IF NOT EXISTS public.discord_guild_members (
  guild_id text NOT NULL REFERENCES public.discord_guilds (id) ON DELETE CASCADE,
  discord_user_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, discord_user_id)
);

ALTER TABLE public.discord_guild_members
  DROP CONSTRAINT IF EXISTS discord_guild_members_user_id_fkey;
ALTER TABLE public.discord_guild_members
  DROP CONSTRAINT IF EXISTS discord_guild_members_pkey;
ALTER TABLE public.discord_guild_members
  DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.discord_guild_members
  ALTER COLUMN discord_user_id SET NOT NULL;
ALTER TABLE public.discord_guild_members
  ADD CONSTRAINT discord_guild_members_pkey PRIMARY KEY (guild_id, discord_user_id);

-- DM中心フロー用: Discordユーザー単位のゲーム内プロフィール
CREATE TABLE IF NOT EXISTS public.discord_user_game_profiles (
  discord_user_id text NOT NULL,
  discord_user_ref_id uuid REFERENCES public.discord_users (id) ON DELETE SET NULL,
  unite_player_id text NOT NULL CHECK (unite_player_id ~ '^[A-Za-z0-9]+$'),
  unite_api_uid text,
  trainer_name text,
  fetch_status text NOT NULL DEFAULT 'pending' CHECK (fetch_status IN ('pending', 'ok', 'failed')),
  profile_fetched_at timestamptz,
  last_fetch_error text,
  notify_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_user_id)
);

ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS trainer_name text;
ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS discord_user_ref_id uuid REFERENCES public.discord_users (id) ON DELETE SET NULL;
ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS fetch_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.discord_user_game_profiles
  DROP CONSTRAINT IF EXISTS discord_user_game_profiles_fetch_status_check;
ALTER TABLE public.discord_user_game_profiles
  ADD CONSTRAINT discord_user_game_profiles_fetch_status_check CHECK (fetch_status IN ('pending', 'ok', 'failed'));
ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS profile_fetched_at timestamptz;
ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS last_fetch_error text;

-- Discord DMフロー用: フレンド関係（discord user id同士）
CREATE TABLE IF NOT EXISTS public.discord_friendships (
  user_low_discord_id text NOT NULL,
  user_high_discord_id text NOT NULL,
  source text NOT NULL DEFAULT 'same_guild' CHECK (source IN ('same_guild', 'invite_link')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_low_discord_id < user_high_discord_id),
  PRIMARY KEY (user_low_discord_id, user_high_discord_id)
);

-- サーバー外ユーザー向けの招待URLトークン
CREATE TABLE IF NOT EXISTS public.discord_friend_invites (
  token text PRIMARY KEY,
  inviter_discord_user_id text NOT NULL,
  guild_id text REFERENCES public.discord_guilds (id) ON DELETE SET NULL,
  used_by_discord_user_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

-- -----------------------------------------------------------------------------
-- インデックス
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_discord_id ON public.users (discord_id);
CREATE INDEX IF NOT EXISTS idx_users_unite_trainer_id ON public.users (unite_trainer_id);
CREATE INDEX IF NOT EXISTS idx_du_discord_user_id ON public.discord_users (discord_user_id);

CREATE INDEX IF NOT EXISTS idx_fr_requester ON public.friend_requests (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fr_addressee ON public.friend_requests (addressee_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fr_pending_pair
  ON public.friend_requests (requester_user_id, addressee_user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_pair ON public.friendships (user_low_id, user_high_id);
CREATE INDEX IF NOT EXISTS idx_friendships_active ON public.friendships (active);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tnh_user_created
  ON public.trainer_name_histories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dgm_discord_user_id ON public.discord_guild_members (discord_user_id);
CREATE INDEX IF NOT EXISTS idx_dgm_last_seen_at ON public.discord_guild_members (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_dugp_discord_user_ref_id ON public.discord_user_game_profiles (discord_user_ref_id);
CREATE INDEX IF NOT EXISTS idx_dugp_unite_player_id ON public.discord_user_game_profiles (unite_player_id);
CREATE INDEX IF NOT EXISTS idx_dugp_fetch_status ON public.discord_user_game_profiles (fetch_status, profile_fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_df_user_low ON public.discord_friendships (user_low_discord_id);
CREATE INDEX IF NOT EXISTS idx_df_user_high ON public.discord_friendships (user_high_discord_id);
CREATE INDEX IF NOT EXISTS idx_dfi_inviter ON public.discord_friend_invites (inviter_discord_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dfi_expires ON public.discord_friend_invites (expires_at DESC);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_name_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_guild_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_user_game_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_friend_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS du_deny_all ON public.discord_users;
CREATE POLICY du_deny_all ON public.discord_users
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS fr_select_related ON public.friend_requests;
CREATE POLICY fr_select_related ON public.friend_requests
  FOR SELECT
  USING (requester_user_id = auth.uid() OR addressee_user_id = auth.uid());

DROP POLICY IF EXISTS fr_insert_requester ON public.friend_requests;
CREATE POLICY fr_insert_requester ON public.friend_requests
  FOR INSERT
  WITH CHECK (requester_user_id = auth.uid());

DROP POLICY IF EXISTS fr_update_related ON public.friend_requests;
CREATE POLICY fr_update_related ON public.friend_requests
  FOR UPDATE
  USING (requester_user_id = auth.uid() OR addressee_user_id = auth.uid())
  WITH CHECK (requester_user_id = auth.uid() OR addressee_user_id = auth.uid());

DROP POLICY IF EXISTS fs_select_related ON public.friendships;
CREATE POLICY fs_select_related ON public.friendships
  FOR SELECT
  USING (user_low_id = auth.uid() OR user_high_id = auth.uid());

DROP POLICY IF EXISTS fs_insert_related ON public.friendships;
CREATE POLICY fs_insert_related ON public.friendships
  FOR INSERT
  WITH CHECK (user_low_id = auth.uid() OR user_high_id = auth.uid());

DROP POLICY IF EXISTS fs_update_related ON public.friendships;
CREATE POLICY fs_update_related ON public.friendships
  FOR UPDATE
  USING (user_low_id = auth.uid() OR user_high_id = auth.uid())
  WITH CHECK (user_low_id = auth.uid() OR user_high_id = auth.uid());

DROP POLICY IF EXISTS n_select_own ON public.notifications;
CREATE POLICY n_select_own ON public.notifications
  FOR SELECT
  USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS n_insert_own ON public.notifications;
CREATE POLICY n_insert_own ON public.notifications
  FOR INSERT
  WITH CHECK (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS n_update_own ON public.notifications;
CREATE POLICY n_update_own ON public.notifications
  FOR UPDATE
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS tnh_select_own ON public.trainer_name_histories;
CREATE POLICY tnh_select_own ON public.trainer_name_histories
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS tnh_insert_own ON public.trainer_name_histories;
CREATE POLICY tnh_insert_own ON public.trainer_name_histories
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- guild情報はユーザーから直接は触らせず、サーバーサイド（service role）で管理
DROP POLICY IF EXISTS dg_deny_all ON public.discord_guilds;
CREATE POLICY dg_deny_all ON public.discord_guilds
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS dgm_select_own ON public.discord_guild_members;
DROP POLICY IF EXISTS dgm_insert_own ON public.discord_guild_members;
DROP POLICY IF EXISTS dgm_update_own ON public.discord_guild_members;
DROP POLICY IF EXISTS dgm_deny_all ON public.discord_guild_members;
CREATE POLICY dgm_deny_all ON public.discord_guild_members
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS dugp_deny_all ON public.discord_user_game_profiles;
CREATE POLICY dugp_deny_all ON public.discord_user_game_profiles
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS df_deny_all ON public.discord_friendships;
CREATE POLICY df_deny_all ON public.discord_friendships
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS dfi_deny_all ON public.discord_friend_invites;
CREATE POLICY dfi_deny_all ON public.discord_friend_invites
  FOR ALL
  USING (false)
  WITH CHECK (false);

