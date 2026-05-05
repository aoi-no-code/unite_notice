import { createDecipheriv, createHash } from 'crypto';

type UnitePlayerProfile = {
  uid?: string;
  userShort?: string;
  playerName?: string;
  lastLogoutTime?: string;
  isOnline?: boolean;
  guild?: string;
  currentRank?: string;
  masterPoints?: number;
};

type UnitePlayerPayload = {
  profile?: UnitePlayerProfile;
  MatchResults?: Array<{
    GameStartTime?: string;
    MapID?: number;
    MapSubMode?: number;
  }>;
  [key: string]: unknown;
};

export type UniteProfileData = {
  profile: UnitePlayerProfile;
  rawPlayer: UnitePlayerPayload;
  sourceUrl: string;
};

type NextDataPayload = {
  pageProps?: {
    a?: string;
  };
};

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/+$/, '');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decryptPayload(encrypted: string): Record<string, unknown> {
  // UniteAPI payload format:
  // - encryptedBase64 + keySuffix(21 chars)
  // - key = sha256(keySuffix), algo = aes-256-ctr, iv = first 16 bytes
  const keyStart = encrypted.length - 21;
  const keySource = encrypted.slice(keyStart);
  const encryptedBase64 = encrypted.slice(0, keyStart);
  const buffer = Buffer.from(encryptedBase64, 'base64');
  if (buffer.length < 17) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = buffer.subarray(0, 16);
  const ciphertext = buffer.subarray(16);
  const key = createHash('sha256').update(keySource).digest();
  const decipher = createDecipheriv('aes-256-ctr', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, unknown>;
}

const browserLikeHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
} as const;

async function resolveBuildId(base: string, locale: string): Promise<string | null> {
  const res = await fetch(`${base}/${locale}`, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/"buildId":"([^"]+)"/);
  return match?.[1] ?? null;
}

async function fetchPlayerNameFromPage(base: string, identifier: string, locale: string): Promise<{ playerName: string | null; sourceUrl: string }> {
  const paths = [`/${locale}/p/${encodeURIComponent(identifier)}`, `/p/${encodeURIComponent(identifier)}`];
  for (const path of paths) {
    const sourceUrl = `${base}${path}`;
    const res = await fetch(sourceUrl, { cache: 'no-store', headers: browserLikeHeaders });
    if (!res.ok) continue;
    const html = await res.text();

    const titleMatch = html.match(/<title>([^<]+)\s\|\sUniteApi<\/title>/i);
    if (titleMatch?.[1]) {
      const name = decodeHtml(titleMatch[1]).trim();
      if (name && name.toLowerCase() !== identifier.toLowerCase()) {
        return { playerName: name, sourceUrl };
      }
    }
  }
  return { playerName: null, sourceUrl: `${base}/p/${encodeURIComponent(identifier)}` };
}

/** dev.uniteapi.dev の検索ページ（RSC）に埋め込まれた players JSON から表示名を取る */
async function fetchPlayerNameFromDevSearch(
  identifier: string,
  locale: string
): Promise<{ playerName: string | null; sourceUrl: string }> {
  const searchBase = normalizeBaseUrl(process.env.UNITEAPI_SEARCH_BASE ?? 'https://dev.uniteapi.dev');
  const sourceUrl = `${searchBase}/${locale}/search?q=${encodeURIComponent(identifier)}`;
  const res = await fetch(sourceUrl, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) return { playerName: null, sourceUrl };
  const html = await res.text();
  const m = html.match(/\\"players\\":\[{\\"uid\\":\\"[^"]+\\",\\"name\\":\\"([^"]+)\\"/);
  if (!m?.[1]) return { playerName: null, sourceUrl };
  const name = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  if (!name) return { playerName: null, sourceUrl };
  return { playerName: name, sourceUrl };
}

async function fetchNicknameFallbacks(
  base: string,
  identifier: string,
  locale: string
): Promise<UniteProfileData | null> {
  const page = await fetchPlayerNameFromPage(base, identifier, locale);
  if (page.playerName) {
    const profile: UnitePlayerProfile = { playerName: page.playerName };
    return { profile, rawPlayer: { profile }, sourceUrl: page.sourceUrl };
  }
  const dev = await fetchPlayerNameFromDevSearch(identifier, locale);
  if (dev.playerName) {
    const profile: UnitePlayerProfile = { playerName: dev.playerName };
    return { profile, rawPlayer: { profile }, sourceUrl: dev.sourceUrl };
  }
  return null;
}

export async function fetchUniteProfile(identifier: string, locale = 'jp'): Promise<UniteProfileData | null> {
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const buildId = await resolveBuildId(base, locale);
  if (!buildId) {
    return (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
  }

  const dataUrl = `${base}/_next/data/${buildId}/${locale}/p/${encodeURIComponent(identifier)}.json`;
  const res = await fetch(dataUrl, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) {
    return (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
  }

  const data = (await res.json()) as NextDataPayload;
  const encrypted = data.pageProps?.a;
  if (!encrypted) {
    return (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
  }

  const decrypted = decryptPayload(encrypted);
  const player = (decrypted.player ?? null) as UnitePlayerPayload | null;
  const profile = (player?.profile ?? null) as UnitePlayerProfile | null;
  if (!player || !profile) {
    return (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
  }

  const trimmedName = profile.playerName?.trim();
  if (!trimmedName) {
    const fb = await fetchNicknameFallbacks(base, identifier, locale);
    if (fb?.profile?.playerName?.trim()) {
      return {
        profile: { ...profile, playerName: fb.profile.playerName },
        rawPlayer: player,
        sourceUrl: dataUrl,
      };
    }
  }

  return {
    profile,
    rawPlayer: player,
    sourceUrl: dataUrl,
  };
}

export async function fetchLatestBattleAt(
  identifier: string
): Promise<{ latestBattleAt: Date | null }> {
  const profileData = await fetchUniteProfile(identifier);
  const matchResults = profileData?.rawPlayer?.MatchResults;
  if (!matchResults || matchResults.length === 0) {
    return { latestBattleAt: null };
  }

  let latestSec = 0;
  for (const row of matchResults) {
    const sec = Number(row?.GameStartTime ?? 0);
    if (Number.isFinite(sec) && sec > latestSec) latestSec = sec;
  }
  if (latestSec <= 0) return { latestBattleAt: null };
  return { latestBattleAt: new Date(latestSec * 1000) };
}

export async function fetchLastOnline(trainerId: string): Promise<{ lastOnline: Date | null }> {
  const profileData = await fetchUniteProfile(trainerId);
  if (!profileData?.profile?.lastLogoutTime) return { lastOnline: null };
  const sec = Number(profileData.profile.lastLogoutTime);
  if (!Number.isFinite(sec) || sec <= 0) return { lastOnline: null };
  return { lastOnline: new Date(sec * 1000) };
}


