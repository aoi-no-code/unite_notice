import { NextRequest } from 'next/server';
import { processExpiredPremiums } from '@/lib/premium';

export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.INTERNAL_SHARED_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-internal-secret');
  if (header === secret) return true;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await processExpiredPremiums();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'expire job failed';
    console.error('[cron/premium-expire]', message);
    return new Response(message, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
