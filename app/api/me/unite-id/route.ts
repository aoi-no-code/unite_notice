import { NextRequest } from 'next/server';
import { getUserClientFromRequest } from '@/lib/db';
import { syncTrainerNameIfChanged } from '@/lib/trainerName';

function normalizeTrainerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9]+$/.test(normalized)) return null;
  if (normalized.length > 32) return null;
  return normalized;
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await getUserClientFromRequest(req as unknown as Request);
    const body = await req.json().catch(() => ({}));
    const uniteTrainerId = normalizeTrainerId(body?.unite_trainer_id);

    if (!uniteTrainerId) {
      return new Response(JSON.stringify({ error: 'トレーナーIDは英数字で入力してください' }), {
        status: 400,
      });
    }

    const { data: existing } = await supabase.from('users').select('trainer_name').eq('id', user.id).maybeSingle();

    const { error } = await supabase
      .from('users')
      .upsert(
        {
          id: user.id,
          role: 'player',
          unite_trainer_id: uniteTrainerId,
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single();
    if (error) {
      const status = error.code === '23505' ? 409 : 400;
      return new Response(JSON.stringify({ error: error.message }), { status });
    }

    let trainerName = existing?.trainer_name ?? null;
    try {
      trainerName = await syncTrainerNameIfChanged({
        supabase,
        userId: user.id,
        uniteTrainerId,
        currentTrainerName: existing?.trainer_name ?? null,
        source: 'set_trainer_id',
      });
    } catch {
      // 名前同期に失敗してもID登録は成功扱いにする
    }

    return new Response(
      JSON.stringify({ ok: true, unite_trainer_id: uniteTrainerId, trainer_name: trainerName }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}
