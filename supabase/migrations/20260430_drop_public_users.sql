BEGIN;

-- 1) users参照を持つ列・制約を先に除去
ALTER TABLE IF EXISTS public.discord_unite_registrations
  DROP CONSTRAINT IF EXISTS discord_unite_registrations_app_user_id_fkey;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP CONSTRAINT IF EXISTS discord_user_game_profiles_app_user_id_fkey;
DROP INDEX IF EXISTS public.idx_dur_app_user_id;
DROP INDEX IF EXISTS public.uq_dur_guild_app_user;
ALTER TABLE IF EXISTS public.discord_unite_registrations
  DROP COLUMN IF EXISTS app_user_id;
ALTER TABLE IF EXISTS public.discord_user_game_profiles
  DROP COLUMN IF EXISTS app_user_id;

-- 2) users依存の旧アプリ用テーブルを削除
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.trainer_name_histories CASCADE;
DROP TABLE IF EXISTS public.friendships CASCADE;
DROP TABLE IF EXISTS public.friend_requests CASCADE;

-- 3) usersのRLSポリシーを明示的に落としてから本体削除
DROP POLICY IF EXISTS users_select_self ON public.users;
DROP POLICY IF EXISTS users_update_self ON public.users;
DROP POLICY IF EXISTS users_insert_self ON public.users;

DROP TABLE IF EXISTS public.users CASCADE;

COMMIT;
