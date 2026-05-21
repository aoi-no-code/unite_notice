import { NextRequest, NextResponse } from 'next/server';
import { acceptFriendInvite } from '@/lib/discordFriendInvite';
import { fetchDiscordUserIdFromOAuthCode } from '@/lib/discordOAuth';

const ERROR_QUERY: Record<string, string> = {
  not_found: 'invalid',
  used: 'used',
  expired: 'expired',
  self: 'self',
};

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state')?.trim();
  const oauthError = req.nextUrl.searchParams.get('error');

  if (!state || !/^[a-f0-9]{24}$/i.test(state)) {
    return NextResponse.redirect(new URL('/friend/invalid', req.url));
  }

  if (oauthError || !code) {
    return NextResponse.redirect(new URL(`/friend/${state}?error=cancelled`, req.url));
  }

  try {
    const discordUserId = await fetchDiscordUserIdFromOAuthCode(code);
    const result = await acceptFriendInvite(state, discordUserId);
    if (!result.ok) {
      const q = ERROR_QUERY[result.reason] ?? 'failed';
      return NextResponse.redirect(new URL(`/friend/${state}?error=${q}`, req.url));
    }
    return NextResponse.redirect(new URL(`/friend/${state}?ok=1`, req.url));
  } catch {
    return NextResponse.redirect(new URL(`/friend/${state}?error=oauth`, req.url));
  }
}
