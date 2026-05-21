import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchUniteProfile } from '@/lib/unite';

type SyncSource = 'login' | 'set_trainer_id';

type SyncOptions = {
  supabase: SupabaseClient;
  userId: string;
  uniteTrainerId: string;
  currentTrainerName: string | null;
  source: SyncSource;
};

export async function syncTrainerNameIfChanged(options: SyncOptions): Promise<string | null> {
  const { supabase, userId, uniteTrainerId, currentTrainerName, source } = options;
  const uniteProfile = await fetchUniteProfile(uniteTrainerId);
  const latestTrainerName = uniteProfile?.profile?.playerName?.trim() || null;
  const uniteApiUid = uniteProfile?.profile?.uid?.trim() || null;

  if (!latestTrainerName || latestTrainerName === currentTrainerName) {
    return currentTrainerName;
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      trainer_name: latestTrainerName,
      ...(uniteApiUid ? { unite_api_uid: uniteApiUid } : {}),
    })
    .eq('id', userId);
  if (updateError) throw updateError;

  const { error: historyError } = await supabase.from('trainer_name_histories').insert({
    user_id: userId,
    unite_trainer_id: uniteTrainerId,
    old_trainer_name: currentTrainerName,
    new_trainer_name: latestTrainerName,
    source,
  });
  if (historyError) throw historyError;

  return latestTrainerName;
}
