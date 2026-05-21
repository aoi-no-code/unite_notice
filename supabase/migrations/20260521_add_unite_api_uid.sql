-- UniteAPI プロフィール URL 用の数値 uid（短縮ID RM5KXPT とは別）
ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS unite_api_uid text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS unite_api_uid text;

CREATE INDEX IF NOT EXISTS idx_dugp_unite_api_uid
  ON public.discord_user_game_profiles (unite_api_uid)
  WHERE unite_api_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_unite_api_uid
  ON public.users (unite_api_uid)
  WHERE unite_api_uid IS NOT NULL;
