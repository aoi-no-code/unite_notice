import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

type UserClientResult = { supabase: SupabaseClient; user: User };

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function getUserClientFromRequest(req: Request): Promise<UserClientResult> {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) throw new Error('Unauthorized');

  // ユーザーのRLSを効かせるため、PostgRESTにAuthorizationを伝播
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('Unauthorized');
  return { supabase, user: data.user };
}

export async function getOrCreateUserByDiscordId(discordId: string): Promise<{ id: string }> {
  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('users')
    .select('id')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await svc
    .from('users')
    .insert({ role: 'player', discord_id: discordId })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}


