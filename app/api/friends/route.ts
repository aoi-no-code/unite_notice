import { NextRequest } from 'next/server';
import { getUserClientFromRequest } from '../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await getUserClientFromRequest(req as unknown as Request);
    const { data, error } = await supabase
      .from('friend_links')
      .select('id, friend_unite_id, friend_label, notify_channel_id, last_seen_at, active, created_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify({ friends: data ?? [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getUserClientFromRequest(req as unknown as Request);
    const body = await req.json();
    const { friend_unite_id, friend_label, notify_channel_id } = body ?? {};
    if (!friend_unite_id || typeof friend_unite_id !== 'string') {
      return new Response(JSON.stringify({ error: 'friend_unite_id is required' }), { status: 400 });
    }
    const { data, error } = await supabase
      .from('friend_links')
      .upsert({
        owner_user_id: user.id,
        friend_unite_id,
        friend_label: friend_label ?? null,
        notify_channel_id: notify_channel_id ?? null,
        active: true,
      }, { onConflict: 'owner_user_id,friend_unite_id' })
      .select('id')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify({ id: data.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}


