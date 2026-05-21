-- 月額サブスクリプション用カラム

ALTER TABLE public.discord_user_billing
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

CREATE INDEX IF NOT EXISTS idx_dub_subscription ON public.discord_user_billing (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
