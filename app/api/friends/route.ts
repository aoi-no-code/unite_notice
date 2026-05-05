import { NextRequest } from 'next/server';
import { getUserClientFromRequest } from '../../../lib/db';

export async function GET(req: NextRequest) {
  try {
    await getUserClientFromRequest(req as unknown as Request);
    return new Response(JSON.stringify({ error: 'friend_links は廃止されました。/api/friendships を利用してください。' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await getUserClientFromRequest(req as unknown as Request);
    return new Response(JSON.stringify({ error: 'friend_links は廃止されました。フレンド申請/承認フローを利用してください。' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
}


