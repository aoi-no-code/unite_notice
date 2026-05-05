import { NextRequest } from 'next/server';
import { getServiceClient, getUserClientFromRequest } from '@/lib/db';

function normalizeTrainerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9]+$/.test(normalized)) return null;
  return normalized;
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await getUserClientFromRequest(req as unknown as Request);
    const { data, error } = await supabase
      .from('friend_requests')
      .select('id, requester_user_id, addressee_user_id, status, created_at, responded_at')
      .or(`requester_user_id.eq.${user.id},addressee_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify({ requests: data ?? [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getUserClientFromRequest(req as unknown as Request);
    const body = await req.json().catch(() => ({}));
    const addresseeTrainerId = normalizeTrainerId(body?.addressee_unite_trainer_id);

    if (!addresseeTrainerId) {
      return new Response(JSON.stringify({ error: 'addressee_unite_trainer_id は英数字で指定してください' }), {
        status: 400,
      });
    }

    const { data: requesterProfile, error: requesterProfileError } = await supabase
      .from('users')
      .select('max_friend_slots')
      .eq('id', user.id)
      .maybeSingle();
    if (requesterProfileError) {
      return new Response(JSON.stringify({ error: requesterProfileError.message }), { status: 400 });
    }
    const maxFriendSlots = requesterProfile?.max_friend_slots ?? 5;
    const { count: activeFriendCount, error: friendCountError } = await supabase
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .or(`user_low_id.eq.${user.id},user_high_id.eq.${user.id}`)
      .eq('active', true);
    if (friendCountError) {
      return new Response(JSON.stringify({ error: friendCountError.message }), { status: 400 });
    }
    if ((activeFriendCount ?? 0) >= maxFriendSlots) {
      return new Response(
        JSON.stringify({
          error: `現在のプラン上限（${maxFriendSlots}人）に達しています。課金後に上限を解放してください。`,
        }),
        { status: 402 }
      );
    }

    const { data: addressee, error: addresseeError } = await supabase
      .from('users')
      .select('id, unite_trainer_id')
      .eq('unite_trainer_id', addresseeTrainerId)
      .single();
    if (addresseeError || !addressee) {
      return new Response(JSON.stringify({ error: '指定されたトレーナーIDのユーザーが見つかりません' }), { status: 404 });
    }
    if (addressee.id === user.id) {
      return new Response(JSON.stringify({ error: '自分自身には申請できません' }), { status: 400 });
    }

    const { data: existingPending, error: pendingError } = await supabase
      .from('friend_requests')
      .select('id')
      .or(
        `and(requester_user_id.eq.${user.id},addressee_user_id.eq.${addressee.id},status.eq.pending),and(requester_user_id.eq.${addressee.id},addressee_user_id.eq.${user.id},status.eq.pending)`
      )
      .limit(1);
    if (pendingError) return new Response(JSON.stringify({ error: pendingError.message }), { status: 400 });
    if (existingPending && existingPending.length > 0) {
      return new Response(JSON.stringify({ error: '未処理の申請がすでにあります' }), { status: 409 });
    }

    const lowId = user.id < addressee.id ? user.id : addressee.id;
    const highId = user.id < addressee.id ? addressee.id : user.id;
    const { data: friendship, error: friendshipError } = await supabase
      .from('friendships')
      .select('id')
      .eq('user_low_id', lowId)
      .eq('user_high_id', highId)
      .eq('active', true)
      .maybeSingle();
    if (friendshipError) return new Response(JSON.stringify({ error: friendshipError.message }), { status: 400 });
    if (friendship) {
      return new Response(JSON.stringify({ error: 'すでにフレンドです' }), { status: 409 });
    }

    const { data: created, error: insertError } = await supabase
      .from('friend_requests')
      .insert({
        requester_user_id: user.id,
        addressee_user_id: addressee.id,
      })
      .select('id')
      .single();
    if (insertError) return new Response(JSON.stringify({ error: insertError.message }), { status: 400 });

    const { data: requesterUniteProfile } = await supabase
      .from('users')
      .select('unite_trainer_id')
      .eq('id', user.id)
      .maybeSingle();

    const svc = getServiceClient();
    await svc.from('notifications').insert({
      recipient_user_id: addressee.id,
      type: 'friend_request_received',
      payload: {
        friend_request_id: created.id,
        requester_user_id: user.id,
        requester_unite_trainer_id: requesterUniteProfile?.unite_trainer_id ?? null,
      },
    });

    return new Response(JSON.stringify({ id: created.id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}
