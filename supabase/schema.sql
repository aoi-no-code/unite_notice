-- public schema for Pokemon UNITE notice app

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('admin','player')),
  discord_id text UNIQUE,
  unite_trainer_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.friend_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_unite_id text NOT NULL,
  friend_label text,
  notify_channel_id text,
  last_seen_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(owner_user_id, friend_unite_id)
);

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id bigserial PRIMARY KEY,
  friend_link_id uuid NOT NULL REFERENCES public.friend_links(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  channel_id text NOT NULL,
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_fl_owner ON public.friend_links(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_fl_active ON public.friend_links(active);
CREATE INDEX IF NOT EXISTS idx_nlog_time ON public.notification_logs(sent_at DESC);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_self ON public.users
  FOR SELECT USING (auth.uid() = id OR EXISTS(SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role='admin'));
CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY fl_select_own ON public.friend_links
  FOR SELECT USING (owner_user_id = auth.uid() OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='admin'));
CREATE POLICY fl_ins_own ON public.friend_links
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY fl_upd_own ON public.friend_links
  FOR UPDATE USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY fl_del_own ON public.friend_links
  FOR DELETE USING (owner_user_id = auth.uid());

CREATE POLICY nlog_select_own ON public.notification_logs
  FOR SELECT USING (EXISTS(
    SELECT 1 FROM public.friend_links fl
    WHERE fl.id = notification_logs.friend_link_id
      AND (fl.owner_user_id = auth.uid()
           OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='admin'))
));


