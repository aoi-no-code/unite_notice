import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

export async function syncPublicUserFromAuthUser(user: User): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE が未設定のため public.users を同期できません');
  }

  const discordIdentity = user.identities?.find((i) => i.provider === 'discord');
  const discordId =
    discordIdentity?.identity_id ??
    (discordIdentity?.identity_data as { sub?: string } | undefined)?.sub ??
    null;

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: existing } = await svc.from('users').select('unite_trainer_id').eq('id', user.id).maybeSingle();

  const { error } = await svc.from('users').upsert(
    {
      id: user.id,
      role: 'player',
      discord_id: discordId,
      unite_trainer_id: existing?.unite_trainer_id ?? null,
    },
    { onConflict: 'id' }
  );

  if (error) throw error;
}
