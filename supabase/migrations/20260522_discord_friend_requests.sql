-- DM フレンド申請フロー用（コード発行 → 申請 → 承認）

CREATE TABLE IF NOT EXISTS public.discord_friend_codes (
  code text PRIMARY KEY,
  owner_discord_user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dfc_owner ON public.discord_friend_codes (owner_discord_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dfc_expires ON public.discord_friend_codes (expires_at DESC);

CREATE TABLE IF NOT EXISTS public.discord_friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL REFERENCES public.discord_friend_codes (code) ON DELETE CASCADE,
  requester_discord_user_id text NOT NULL,
  owner_discord_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_discord_user_id <> owner_discord_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dfr_pending_pair
  ON public.discord_friend_requests (requester_discord_user_id, owner_discord_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_dfr_owner_pending
  ON public.discord_friend_requests (owner_discord_user_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.discord_friend_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dfc_deny_all ON public.discord_friend_codes;
CREATE POLICY dfc_deny_all ON public.discord_friend_codes FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS dfr_deny_all ON public.discord_friend_requests;
CREATE POLICY dfr_deny_all ON public.discord_friend_requests FOR ALL USING (false) WITH CHECK (false);

ALTER TABLE public.discord_friendships
  DROP CONSTRAINT IF EXISTS discord_friendships_source_check;
ALTER TABLE public.discord_friendships
  ADD CONSTRAINT discord_friendships_source_check
  CHECK (source IN ('same_guild', 'invite_link', 'friend_code'));
