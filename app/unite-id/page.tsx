import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { UniteIdForm } from './UniteIdForm';

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function normalizeNextPath(raw: string | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  return raw;
}

export default async function UniteIdPage({ searchParams }: Props) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('unite_trainer_id')
    .eq('id', user.id)
    .maybeSingle();

  const nextRaw = typeof searchParams?.next === 'string' ? searchParams.next : undefined;
  const nextPath = normalizeNextPath(nextRaw);

  if (profile?.unite_trainer_id) {
    redirect(nextPath);
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <UniteIdForm nextPath={nextPath} />
    </main>
  );
}
