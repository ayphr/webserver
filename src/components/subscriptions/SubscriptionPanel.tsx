import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IconAlertCircle,
  IconCheck,
  IconCreditCard,
  IconExternalLink,
  IconRefresh,
} from '@tabler/icons-react';
import type {
  BillingInterval,
  ResolvedSubscription,
  SubscriptionMePayload,
  SubscriptionPlan,
  SubscriptionTier,
} from '../../../common';
import { BADGES, BILLING_INTERVALS, SUBSCRIPTION_TIERS } from '../../../common';
import { getBadgeIcon } from '../../lib/badges';
import { api } from '../../lib/api';
import { Button, Checkbox } from '../common';
import './SubscriptionPanel.css';

const TIER_DESCRIPTIONS: Record<SubscriptionTier, string> = {
  lite: 'The essentials to get started with Ayphr.',
  plus: 'More features and higher limits for everyday use.',
  ultra: 'Everything in Plus, with the highest personal limits.',
  'team-lite': 'Shared access and collaboration for small teams.',
  'team-plus': 'Advanced collaboration and higher team limits.',
  'team-ultra': 'The complete package for large teams.',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trialing: 'Free trial',
  past_due: 'Payment past due',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  paused: 'Paused',
};

function getTierName(tier: SubscriptionTier): string {
  return BADGES.find((badge) => badge.id === tier)?.name ?? tier;
}

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.amount === null || !plan.currency) return 'Unavailable';
  const value = plan.amount / 100;
  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
  }).format(value);
  return `${formatted} / ${plan.interval === 'year' ? 'year' : 'month'}`;
}

function formatRemaining(expiresAt: Date | null, now: number): string {
  if (!expiresAt) return 'Never expires';

  const diff = expiresAt.getTime() - now;
  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const SubscriptionPanel = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState<SubscriptionMePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isAutoRenewPending, setIsAutoRenewPending] = useState(false);
  const [isPortalPending, setIsPortalPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('month');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);
      try {
        const data = await api.subscriptions.me();
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load your subscription');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const checkoutResult = searchParams.get('checkout');
  useEffect(() => {
    if (checkoutResult !== 'success') return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('checkout');
      return next;
    }, { replace: true });
  }, [checkoutResult, setSearchParams]);

  const subscription = payload?.subscription ?? null;
  const paidSubscription = payload?.paidSubscription ?? null;
  const trialDays = payload?.trialDays ?? 7;
  const plans = useMemo(() => payload?.plans ?? [], [payload]);

  const planTiers = useMemo(() => {
    const available = new Set(plans.map((plan) => plan.tier));
    return SUBSCRIPTION_TIERS.filter((tier) => available.has(tier));
  }, [plans]);

  const handleCheckout = async (plan: SubscriptionPlan) => {
    setError(null);
    setPendingKey(`${plan.tier}:${plan.interval}`);
    try {
      const url = await api.subscriptions.checkout(plan.tier, plan.interval);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setPendingKey(null);
    }
  };

  const handleAutoRenew = async (autoRenew: boolean) => {
    setError(null);
    setIsAutoRenewPending(true);
    try {
      const updated = await api.subscriptions.setAutoRenew(autoRenew);
      setPayload((prev) => (prev ? { ...prev, paidSubscription: updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update auto-renew');
    } finally {
      setIsAutoRenewPending(false);
    }
  };

  const handlePortal = async () => {
    setError(null);
    setIsPortalPending(true);
    try {
      const url = await api.subscriptions.portal();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the billing portal');
      setIsPortalPending(false);
    }
  };

  if (isLoading) {
    return <p className="subscription__loading">Loading your subscription...</p>;
  }

  return (
    <div className="subscription">
      {error && (
        <div className="subscription__error">
          <IconAlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {checkoutResult === 'cancel' && (
        <div className="subscription__notice">
          Checkout canceled. You have not been charged.
        </div>
      )}

      {subscription ? (
        <CurrentSubscription
          subscription={subscription}
          paidSubscription={paidSubscription}
          now={now}
          isAutoRenewPending={isAutoRenewPending}
          isPortalPending={isPortalPending}
          onAutoRenew={handleAutoRenew}
          onPortal={handlePortal}
        />
      ) : (
        <div className="subscription__empty">
          <IconCreditCard size={28} strokeWidth={1.5} />
          <h3>No active subscription</h3>
          <p>Choose a plan below to unlock the full Ayphr experience.</p>
        </div>
      )}

      {!paidSubscription && (
        <div className="subscription__plans">
          <div className="subscription__plans-header">
            <h3>Choose a plan</h3>
            <p>
              Start with a {trialDays}-day free trial. You can cancel anytime and won&apos;t be charged
              until the trial ends.
            </p>
            <div className="subscription__interval-toggle" role="group" aria-label="Billing interval">
              {BILLING_INTERVALS.map((interval) => (
                <button
                  key={interval}
                  type="button"
                  className={`subscription__interval-option ${billingInterval === interval ? 'is-active' : ''}`}
                  onClick={() => setBillingInterval(interval)}
                >
                  {interval === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>

          <div className="subscription__plan-grid">
            {planTiers.map((tier) => {
              const plan = plans.find((item) => item.tier === tier && item.interval === billingInterval);
              if (!plan) return null;

              return (
                <PlanCard
                  key={tier}
                  plan={plan}
                  currentTier={subscription?.tier ?? null}
                  isPending={pendingKey === `${tier}:${billingInterval}`}
                  disabled={pendingKey !== null}
                  trialDays={trialDays}
                  onSelect={handleCheckout}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

type CurrentSubscriptionProps = {
  subscription: ResolvedSubscription;
  paidSubscription: SubscriptionMePayload['paidSubscription'];
  now: number;
  isAutoRenewPending: boolean;
  isPortalPending: boolean;
  onAutoRenew: (autoRenew: boolean) => void;
  onPortal: () => void;
};

const CurrentSubscription = ({
  subscription,
  paidSubscription,
  now,
  isAutoRenewPending,
  isPortalPending,
  onAutoRenew,
  onPortal,
}: CurrentSubscriptionProps) => {
  const tier = subscription.tier;
  const isPaid = subscription.source === 'paid';
  const isTrialing = paidSubscription?.status === 'trialing';
  const status = paidSubscription ? STATUS_LABELS[paidSubscription.status] ?? paidSubscription.status : null;

  return (
    <div className={`subscription__current subscription__current--${subscription.source}`}>
      <div className="subscription__current-icon">{getBadgeIcon(tier)}</div>

      <div className="subscription__current-info">
        <div className="subscription__current-heading">
          <h3>{getTierName(tier)}</h3>
          {!isPaid && (
            <span className="subscription__source subscription__source--attached">Granted</span>
          )}
          {status && <span className="subscription__status">{status}</span>}
        </div>

        <dl className="subscription__meta">
          <div className="subscription__meta-row">
            <dt>Time remaining</dt>
            <dd>{formatRemaining(subscription.expiresAt, now)}</dd>
          </div>
          {subscription.expiresAt && (
            <div className="subscription__meta-row">
              <dt>{paidSubscription?.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}</dt>
              <dd>{formatDate(subscription.expiresAt)}</dd>
            </div>
          )}
        </dl>

        {paidSubscription && (
          <div className="subscription__controls">
            <label className="subscription__toggle">
              <Checkbox
                checked={!paidSubscription.cancelAtPeriodEnd}
                disabled={isAutoRenewPending || isTrialing}
                onChange={(event) => onAutoRenew(event.target.checked)}
              />
              <span>
                Auto-renew
                <small>
                  {isTrialing
                    ? 'Auto-renew can\u2019t be turned off during your free trial.'
                    : paidSubscription.cancelAtPeriodEnd
                      ? 'Your subscription will end at the current period.'
                      : 'Your subscription renews automatically.'}
                </small>
              </span>
            </label>

            <Button
              variant="secondary"
              onClick={onPortal}
              isLoading={isPortalPending}
              disabled={isPortalPending}
            >
              <IconExternalLink size={16} />
              Manage billing
            </Button>
          </div>
        )}

        {!paidSubscription && isPaid && (
          <p className="subscription__hint">
            This subscription is managed through Stripe. Use the billing portal to update it.
          </p>
        )}
      </div>
    </div>
  );
};

type PlanCardProps = {
  plan: SubscriptionPlan;
  currentTier: SubscriptionTier | null;
  isPending: boolean;
  disabled: boolean;
  trialDays: number;
  onSelect: (plan: SubscriptionPlan) => void;
};

const PlanCard = ({ plan, currentTier, isPending, disabled, trialDays, onSelect }: PlanCardProps) => {
  const isCurrent = currentTier === plan.tier;
  const isFeatured = plan.tier === 'ultra' || plan.tier === 'team-ultra';
  const isAvailable = plan.priceId !== null && plan.amount !== null;

  return (
    <div className={`subscription__plan ${isFeatured ? 'subscription__plan--featured' : ''} ${isCurrent ? 'subscription__plan--current' : ''}`}>
      {isFeatured && <span className="subscription__plan-tag">Most popular</span>}

      <div className="subscription__plan-head">
        <span className="subscription__plan-icon">{getBadgeIcon(plan.tier)}</span>
        <h4>{getTierName(plan.tier)}</h4>
      </div>

      <p className="subscription__plan-price">{formatPrice(plan)}</p>
      <p className="subscription__plan-description">{TIER_DESCRIPTIONS[plan.tier]}</p>

      <ul className="subscription__plan-features">
        <li>
          <IconCheck size={14} /> {trialDays}-day free trial
        </li>
        <li>
          <IconRefresh size={14} /> Cancel anytime
        </li>
      </ul>

      <Button
        variant={isFeatured ? 'primary' : 'secondary'}
        fullWidth
        disabled={disabled || isCurrent || !isAvailable}
        isLoading={isPending}
        onClick={() => onSelect(plan)}
      >
        {!isAvailable ? 'Unavailable' : isCurrent ? 'Current plan' : `Start ${trialDays}-day trial`}
      </Button>
    </div>
  );
};
