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
    PartyType?: string;
    partyType?: string;
    GroupType?: string;
    [key: string]: unknown;
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

const UNITE_NOT_FOUND_TITLE_MARKERS = ['プレイヤーが見つかりません', 'Player Not Found'] as const;

/** UniteAPI のプレイヤーページ HTML から表示名を抽出（旧 | UniteApi / 新 - UniteAPI 両対応） */
function parsePlayerNameFromPageHtml(html: string, identifier: string): string | null {
  const plainTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
  if (UNITE_NOT_FOUND_TITLE_MARKERS.some((m) => plainTitle.includes(m))) {
    return null;
  }

  const brandedTitle = html.match(
    /<title>([^<]+?)\s*(?:\|\s*UniteApi|-\s*UniteAPI)\s*<\/title>/i
  );
  if (!brandedTitle?.[1]) return null;

  const name = decodeHtml(brandedTitle[1]).trim();
  if (!name || name.toLowerCase() === identifier.toLowerCase()) return null;
  return name;
}

/** プロフィールページが「未掲載 / 非公開」か（短縮IDが UniteAPI に無い場合など） */
export async function isUnitePlayerNotIndexed(identifier: string, locale = 'jp'): Promise<boolean> {
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const sourceUrl = `${base}/${locale}/p/${encodeURIComponent(identifier)}`;
  const res = await fetch(sourceUrl, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) return false;
  const html = await res.text();
  const plainTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
  const directNotFound = UNITE_NOT_FOUND_TITLE_MARKERS.some((m) => plainTitle.includes(m));
  if (!directNotFound) return false;
  const hit = await resolveUniteApiUidFromSearch(identifier, locale);
  return hit === null;
}

async function resolveBuildId(base: string, locale: string): Promise<string | null> {
  const res = await fetch(`${base}/${locale}`, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) return null;
  const html = await res.text();
  const classic = html.match(/"buildId":"([^"]+)"/)?.[1];
  if (classic) return classic;
  // Next.js 15+ (Turbopack): RSC payload 内の b フィールド
  const nextB =
    html.match(/\\"b\\":\\"([A-Za-z0-9_-]{8,})\\"/)?.[1] ?? html.match(/"b":"([A-Za-z0-9_-]{8,})"/)?.[1];
  return nextB ?? null;
}

type UniteSearchHit = { uid: string; name: string };

/** 検索結果 RSC に埋め込まれた players 配列をパース */
function parsePlayersFromSearchHtml(html: string): UniteSearchHit[] {
  const players: UniteSearchHit[] = [];
  const re = /\\"uid\\":\\"(\d+)\\",\\"name\\":\\"([^\\"]*)\\"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[2].replace(/\\u0023/g, '#').replace(/\\\\/g, '\\').trim();
    if (name) players.push({ uid: m[1], name });
  }
  return players;
}

/**
 * ゲーム内短縮ID (例: RM5KXPT) → UniteAPI プロフィール用の数値 uid (例: 14724770799654291999)
 * 直接 /p/{短縮ID} は 404 だが、/search?q={短縮ID} ではヒットするケースがある。
 */
export async function resolveUniteApiUidFromSearch(
  identifier: string,
  locale = 'jp'
): Promise<UniteSearchHit | null> {
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const sourceUrl = `${base}/${locale}/search?q=${encodeURIComponent(identifier)}`;
  const res = await fetch(sourceUrl, { cache: 'no-store', headers: browserLikeHeaders });
  if (!res.ok) return null;
  const html = await res.text();
  const players = parsePlayersFromSearchHtml(html);
  // 短縮ID検索で 1 件だけ返るときだけ採用（複数ヒット時に誤った名前を拾わない）
  if (players.length !== 1) return null;
  return players[0];
}

async function fetchPlayerNameFromPage(
  base: string,
  identifier: string,
  locale: string
): Promise<{ playerName: string | null; sourceUrl: string; notIndexed: boolean }> {
  const paths = [`/${locale}/p/${encodeURIComponent(identifier)}`, `/p/${encodeURIComponent(identifier)}`];
  for (const path of paths) {
    const sourceUrl = `${base}${path}`;
    const res = await fetch(sourceUrl, { cache: 'no-store', headers: browserLikeHeaders });
    if (!res.ok) continue;
    const html = await res.text();
    const plainTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
    const notIndexed = UNITE_NOT_FOUND_TITLE_MARKERS.some((m) => plainTitle.includes(m));
    if (notIndexed) {
      return { playerName: null, sourceUrl, notIndexed: true };
    }
    const playerName = parsePlayerNameFromPageHtml(html, identifier);
    if (playerName) {
      return { playerName, sourceUrl, notIndexed: false };
    }
  }
  return {
    playerName: null,
    sourceUrl: `${base}/p/${encodeURIComponent(identifier)}`,
    notIndexed: false,
  };
}

async function fetchNicknameFallbacks(
  base: string,
  identifier: string,
  locale: string
): Promise<UniteProfileData | null> {
  const page = await fetchPlayerNameFromPage(base, identifier, locale);
  if (page.playerName) {
    const profile: UnitePlayerProfile = { playerName: page.playerName, userShort: identifier };
    return { profile, rawPlayer: { profile }, sourceUrl: page.sourceUrl };
  }

  if (!page.notIndexed) return null;

  const hit = await resolveUniteApiUidFromSearch(identifier, locale);
  if (!hit) return null;

  const uidPage = await fetchPlayerNameFromPage(base, hit.uid, locale);
  const playerName = uidPage.playerName ?? hit.name;
  const profile: UnitePlayerProfile = {
    uid: hit.uid,
    userShort: identifier,
    playerName,
  };
  return {
    profile,
    rawPlayer: { profile },
    sourceUrl: uidPage.sourceUrl,
  };
}

/** 短縮ID → UniteAPI が参照するプロフィールキー（多くは数値 uid） */
export async function resolveUniteProfileLookupKey(
  shortId: string,
  storedApiUid?: string | null,
  locale = 'jp'
): Promise<string> {
  if (storedApiUid) return storedApiUid;
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const page = await fetchPlayerNameFromPage(base, shortId, locale);
  if (!page.notIndexed) return shortId;
  const hit = await resolveUniteApiUidFromSearch(shortId, locale);
  return hit?.uid ?? shortId;
}

export async function fetchUniteProfile(identifier: string, locale = 'jp'): Promise<UniteProfileData | null> {
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const directPage = await fetchPlayerNameFromPage(base, identifier, locale);
  let lookupId = identifier;
  if (directPage.notIndexed) {
    const hit = await resolveUniteApiUidFromSearch(identifier, locale);
    if (hit) lookupId = hit.uid;
  }

  const buildId = await resolveBuildId(base, locale);
  if (!buildId) {
    const fb = (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
    if (fb?.profile) fb.profile.userShort = identifier;
    return fb;
  }

  const dataUrl = `${base}/_next/data/${buildId}/${locale}/p/${encodeURIComponent(lookupId)}.json`;
  const res = await fetch(dataUrl, { cache: 'no-store', headers: browserLikeHeaders });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('application/json')) {
    const fb = (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
    if (fb?.profile) fb.profile.userShort = identifier;
    return fb;
  }

  const data = (await res.json()) as NextDataPayload;
  const encrypted = data.pageProps?.a;
  if (!encrypted) {
    const fb = (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
    if (fb?.profile) fb.profile.userShort = identifier;
    return fb;
  }

  const decrypted = decryptPayload(encrypted);
  const player = (decrypted.player ?? null) as UnitePlayerPayload | null;
  const profile = (player?.profile ?? null) as UnitePlayerProfile | null;
  if (!player || !profile) {
    const fb = (await fetchNicknameFallbacks(base, identifier, locale)) ?? null;
    if (fb?.profile) fb.profile.userShort = identifier;
    return fb;
  }

  profile.userShort = identifier;
  if (lookupId !== identifier) profile.uid = lookupId;

  const trimmedName = profile.playerName?.trim();
  if (!trimmedName) {
    const fb = await fetchNicknameFallbacks(base, identifier, locale);
    if (fb?.profile?.playerName?.trim()) {
      return {
        profile: { ...profile, playerName: fb.profile.playerName, uid: fb.profile.uid ?? lookupId, userShort: identifier },
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

export type LatestMatchSummary = {
  latestBattleAt: Date | null;
  timeAgoLabel: string;
  partyLabel: string | null;
};

const PARTY_LABEL_JA: Record<string, string> = {
  Solo: 'ソロ',
  Duo: 'デュオ',
  Trio: 'トリオ',
};

export function formatPartyLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return PARTY_LABEL_JA[trimmed] ?? trimmed;
}

export function formatTimeAgoFromDate(date: Date): string {
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const totalMin = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0 && mins > 0) return `${hours}時間${mins}分前`;
  if (hours > 0) return `${hours}時間前`;
  return `${mins}分前`;
}

function pickLatestMatchRow(
  matchResults: NonNullable<UnitePlayerPayload['MatchResults']>
): NonNullable<UnitePlayerPayload['MatchResults']>[number] | null {
  let latest: (typeof matchResults)[number] | null = null;
  let latestSec = 0;
  for (const row of matchResults) {
    const sec = Number(row?.GameStartTime ?? 0);
    if (!Number.isFinite(sec) || sec <= 0) continue;
    if (sec > latestSec) {
      latestSec = sec;
      latest = row;
    }
  }
  return latest;
}

function extractPartyFromMatchRow(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const raw =
    (row.PartyType as string | undefined) ??
    (row.partyType as string | undefined) ??
    (row.GroupType as string | undefined) ??
    (row.groupType as string | undefined);
  return formatPartyLabel(typeof raw === 'string' ? raw : null);
}

function stripHtmlToLines(html: string): string[] {
  const withoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const text = withoutScripts.replace(/<[^>]+>/g, '\n');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseLatestMatchFromPlayerHtml(html: string): LatestMatchSummary | null {
  const lines = stripHtmlToLines(html);
  for (let i = 0; i < lines.length; i++) {
    const timeMatch = lines[i].match(/^約(\d+)(時間|分)前$/);
    if (!timeMatch) continue;
    const amount = Number(timeMatch[1]);
    const unit = timeMatch[2];
    let partyLabel: string | null = null;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (lines[j] === 'Solo' || lines[j] === 'Duo' || lines[j] === 'Trio') {
        partyLabel = formatPartyLabel(lines[j]);
        break;
      }
    }
    const approxMs = unit === '時間' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    const latestBattleAt = new Date(Date.now() - approxMs);
    return { latestBattleAt, timeAgoLabel: formatTimeAgoFromDate(latestBattleAt), partyLabel };
  }
  return null;
}

async function fetchPlayerPageHtml(identifier: string, locale = 'jp'): Promise<string | null> {
  const base = normalizeBaseUrl(process.env.UNITEAPI_BASE ?? 'https://uniteapi.dev');
  const paths = [`/${locale}/p/${encodeURIComponent(identifier)}`, `/p/${encodeURIComponent(identifier)}`];
  for (const path of paths) {
    const res = await fetch(`${base}${path}`, { cache: 'no-store', headers: browserLikeHeaders });
    if (!res.ok) continue;
    const html = await res.text();
    const plainTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
    if (UNITE_NOT_FOUND_TITLE_MARKERS.some((m) => plainTitle.includes(m))) continue;
    return html;
  }
  return null;
}

export async function fetchLatestMatchSummary(
  identifier: string,
  options?: { uniteApiUid?: string | null; locale?: string }
): Promise<LatestMatchSummary | null> {
  const locale = options?.locale ?? 'jp';
  const lookupKey = await resolveUniteProfileLookupKey(identifier, options?.uniteApiUid, locale);

  const profileData = await fetchUniteProfile(lookupKey, locale);
  const matchResults = profileData?.rawPlayer?.MatchResults;
  if (matchResults && matchResults.length > 0) {
    const latest = pickLatestMatchRow(matchResults);
    const sec = Number(latest?.GameStartTime ?? 0);
    if (Number.isFinite(sec) && sec > 0) {
      const latestBattleAt = new Date(sec * 1000);
      return {
        latestBattleAt,
        timeAgoLabel: formatTimeAgoFromDate(latestBattleAt),
        partyLabel: extractPartyFromMatchRow(latest as Record<string, unknown>),
      };
    }
  }

  const html = await fetchPlayerPageHtml(lookupKey, locale);
  if (!html) return null;
  return parseLatestMatchFromPlayerHtml(html);
}

export async function fetchLatestBattleAt(
  identifier: string
): Promise<{ latestBattleAt: Date | null }> {
  const summary = await fetchLatestMatchSummary(identifier);
  return { latestBattleAt: summary?.latestBattleAt ?? null };
}

export async function fetchLastOnline(trainerId: string): Promise<{ lastOnline: Date | null }> {
  const profileData = await fetchUniteProfile(trainerId);
  if (!profileData?.profile?.lastLogoutTime) return { lastOnline: null };
  const sec = Number(profileData.profile.lastLogoutTime);
  if (!Number.isFinite(sec) || sec <= 0) return { lastOnline: null };
  return { lastOnline: new Date(sec * 1000) };
}


