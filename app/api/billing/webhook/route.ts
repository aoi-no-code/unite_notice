import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { handleStripeCheckoutCompleted } from '@/lib/billing';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    return new Response('Stripe is not configured', { status: 500 });
  }

  const stripe = new Stripe(secret, { apiVersion: '2025-02-24.acacia' });
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return new Response(message, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleStripeCheckoutCompleted(session);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    console.error('[billing/webhook]', message);
    return new Response(message, { status: 500 });
  }
}
