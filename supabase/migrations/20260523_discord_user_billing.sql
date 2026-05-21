-- Discord ユーザー単位の課金・フレンド枠

CREATE TABLE IF NOT EXISTS public.discord_user_billing (
  discord_user_id text PRIMARY KEY,
  plan_id text NOT NULL DEFAULT 'free' CHECK (plan_id IN ('free', 'plus')),
  max_friend_slots integer NOT NULL DEFAULT 3 CHECK (max_friend_slots > 0),
  stripe_customer_id text,
  stripe_checkout_session_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dub_plan ON public.discord_user_billing (plan_id);

ALTER TABLE public.discord_user_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dub_deny_all ON public.discord_user_billing;
CREATE POLICY dub_deny_all ON public.discord_user_billing FOR ALL USING (false) WITH CHECK (false);
