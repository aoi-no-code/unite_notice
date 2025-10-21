export async function fetchLastOnline(trainerId: string): Promise<{ lastOnline: Date | null }> {
  const base = process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev';
  const res = await fetch(`${base}/p/${encodeURIComponent(trainerId)}`, { cache: 'no-store' });
  if (!res.ok) return { lastOnline: null };
  const html = await res.text();
  const m = html.match(/Last\s*online:\s*([0-9]{2}-[0-9]{2}-[0-9]{4}\s+[0-9]{2}:[0-9]{2})/i);
  if (!m) return { lastOnline: null };
  const [d, M, y, hh, mm] = m[1].split(/[- :]/).map(Number);
  // UniteAPIはUTC想定で扱う
  return { lastOnline: new Date(Date.UTC(y, M - 1, d, hh, mm)) };
}


