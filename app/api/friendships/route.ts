import { NextRequest } from 'next/server';
import { getServiceClient, getUserClientFromRequest } from '@/lib/db';

type FriendshipRow = {
  id: string;
  user_low_id: string;
  user_high_id: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const { user } = await getUserClientFromRequest(req as unknown as Request);
    const svc = getServiceClient();
    const { data: me, error: meError } = await svc
      .from('users')
      .select('max_friend_slots, plan_tier')
      .eq('id', user.id)
      .maybeSingle();
    if (meError) return new Response(JSON.stringify({ error: meError.message }), { status: 400 });

    const { data: rows, error } = await svc
      .from('friendships')
      .select('id, user_low_id, user_high_id, created_at')
      .or(`user_low_id.eq.${user.id},user_high_id.eq.${user.id}`)
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

    const friendshipRows = (rows ?? []) as FriendshipRow[];
    const maxFriendSlots = me?.max_friend_slots ?? 5;
    const usedFriendSlots = friendshipRows.length;
    const friendIds = friendshipRows.map((row) => (row.user_low_id === user.id ? row.user_high_id : row.user_low_id));

    if (friendIds.length === 0) {
      return new Response(JSON.stringify({ friends: [], slot: { used: usedFriendSlots, max: maxFriendSlots, plan: me?.plan_tier ?? 'free' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: profiles, error: profileError } = await svc
      .from('users')
      .select('id, unite_trainer_id, discord_id')
      .in('id', friendIds);
    if (profileError) return new Response(JSON.stringify({ error: profileError.message }), { status: 400 });

    const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    const friends = friendshipRows.map((row) => {
      const friendUserId = row.user_low_id === user.id ? row.user_high_id : row.user_low_id;
      const profile = profileMap.get(friendUserId);
      return {
        friendship_id: row.id,
        friend_user_id: friendUserId,
        friend_trainer_id: profile?.unite_trainer_id ?? null,
        friend_discord_id: profile?.discord_id ?? null,
        since: row.created_at,
      };
    });

    return new Response(JSON.stringify({ friends, slot: { used: usedFriendSlots, max: maxFriendSlots, plan: me?.plan_tier ?? 'free' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}
