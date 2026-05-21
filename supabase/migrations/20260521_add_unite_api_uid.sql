-- UniteAPI プロフィール URL 用の数値 uid（短縮ID RM5KXPT とは別）
-- 本番では public.users は 20260430_drop_public_users で削除済みのため Discord 用テーブルのみ更新

ALTER TABLE public.discord_user_game_profiles
  ADD COLUMN IF NOT EXISTS unite_api_uid text;

CREATE INDEX IF NOT EXISTS idx_dugp_unite_api_uid
  ON public.discord_user_game_profiles (unite_api_uid)
  WHERE unite_api_uid IS NOT NULL;
