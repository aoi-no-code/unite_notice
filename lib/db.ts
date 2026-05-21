import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getOrCreateDiscordUser(discordUserId: string): Promise<{ id: string }> {
  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('discord_users')
    .select('id')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await svc
    .from('discord_users')
    .insert({ discord_user_id: discordUserId })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
