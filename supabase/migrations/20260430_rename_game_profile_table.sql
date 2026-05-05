BEGIN;

-- discord_unite_registrations -> discord_user_game_profiles へ移行
ALTER TABLE IF EXISTS public.discord_unite_registrations
  RENAME TO discord_user_game_profiles;

-- サーバー単位登録からユーザー単位登録へ変更
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP CONSTRAINT IF EXISTS discord_user_game_profiles_pkey;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP CONSTRAINT IF EXISTS discord_unite_registrations_pkey;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP CONSTRAINT IF EXISTS discord_unite_registrations_fetch_status_check;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  ADD CONSTRAINT discord_user_game_profiles_fetch_status_check
  CHECK (fetch_status IN ('pending', 'ok', 'failed'));

DROP INDEX IF EXISTS public.idx_dur_discord_user_id;
DROP INDEX IF EXISTS public.idx_dur_guild_id;
DROP INDEX IF EXISTS public.idx_dur_discord_user_ref_id;
DROP INDEX IF EXISTS public.idx_dur_guild_player_id;
DROP INDEX IF EXISTS public.idx_dur_fetch_status;

ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP COLUMN IF EXISTS guild_id;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  ADD CONSTRAINT discord_user_game_profiles_pkey PRIMARY KEY (discord_user_id);

CREATE INDEX IF NOT EXISTS idx_dugp_discord_user_ref_id
  ON public.discord_user_game_profiles (discord_user_ref_id);
CREATE INDEX IF NOT EXISTS idx_dugp_unite_player_id
  ON public.discord_user_game_profiles (unite_player_id);
CREATE INDEX IF NOT EXISTS idx_dugp_fetch_status
  ON public.discord_user_game_profiles (fetch_status, profile_fetched_at DESC);

ALTER TABLE IF EXISTS public.discord_user_game_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dur_deny_all ON public.discord_user_game_profiles;
DROP POLICY IF EXISTS dugp_deny_all ON public.discord_user_game_profiles;
CREATE POLICY dugp_deny_all ON public.discord_user_game_profiles
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMIT;
