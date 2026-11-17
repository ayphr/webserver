import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '../env';
import { createLogger } from './logger';

const log = createLogger('stripe');
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;
  if (!STRIPE_SECRET_KEY) {
    log.warn('STRIPE_SECRET_KEY is not set; Stripe features are disabled');
    return null;
  }

  stripeClient = new Stripe(STRIPE_SECRET_KEY);
  return stripeClient;
}
