import { NextRequest, NextResponse } from 'next/server';
import { getFriendInvitePreview } from '@/lib/discordFriendInvite';
import { buildDiscordAuthorizeUrl } from '@/lib/discordOAuth';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim();
  if (!token || !/^[a-f0-9]{24}$/i.test(token)) {
    return NextResponse.redirect(new URL('/friend/invalid', req.url));
  }

  const preview = await getFriendInvitePreview(token);
  if (!preview || preview.used || preview.expired) {
    return NextResponse.redirect(new URL(`/friend/${token}?error=invalid`, req.url));
  }

  try {
    const url = buildDiscordAuthorizeUrl(token);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL(`/friend/${token}?error=config`, req.url));
  }
}
