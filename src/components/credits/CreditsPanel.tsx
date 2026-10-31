import { useEffect, useState } from 'react';
import {
  IconAlertCircle,
  IconCalendar,
  IconCoin,
  IconLock,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import type { CreditBalance, PlanTier } from '@common';
import { api } from '../../lib/api';
import { formatCreditDateTime, formatCredits } from '../../lib/credits';
import { Button } from '../common';
import './CreditsPanel.css';

const PLAN_NAMES: Record<PlanTier, string> = {
  free: 'Free',
  lite: 'Lite',
  plus: 'Plus',
  ultra: 'Ultra',
  'team-lite': 'Team Lite',
  'team-plus': 'Team Plus',
  'team-ultra': 'Team Ultra',
};

type Props = {
  initialCredits?: CreditBalance | null;
  onCreditsChange?: (credits: CreditBalance) => void;
};

export const CreditsPanel = ({ initialCredits = null, onCreditsChange }: Props) => {
  const [credits, setCredits] = useState<CreditBalance | null>(initialCredits);
  const [isLoading, setIsLoading] = useState(initialCredits === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.credits.me();
        if (cancelled) return;
        setCredits(data);
        onCreditsChange?.(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load your credits');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [onCreditsChange]);

  const refresh = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const data = await api.credits.me();
      setCredits(data);
      onCreditsChange?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your credits');
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading && !credits) {
    return <p className="credits__loading">Loading your credits...</p>;
  }

  if (!credits) {
    return (
      <div className="credits__error">
        <IconAlertCircle size={18} />
        <span>{error ?? 'Could not load your credits.'}</span>
      </div>
    );
  }

  const monthlyPercent = credits.monthlyAllowance > 0
    ? Math.min(100, (credits.monthlyUsed / credits.monthlyAllowance) * 100)
    : 0;

  return (
    <div className="credits">
      {error && (
        <div className="credits__error">
          <IconAlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="credits__hero">
        <div className="credits__hero-icon">
          <IconCoin size={30} strokeWidth={1.5} />
        </div>
        <div className="credits__hero-info">
          <span className="credits__hero-label">Available credits</span>
          <span className="credits__hero-balance">{formatCredits(credits.available)}</span>
          <span className="credits__hero-meta">
            {PLAN_NAMES[credits.plan]} plan · {formatCredits(credits.total)} total owned
          </span>
        </div>
        <Button
          variant="secondary"
          className="credits__refresh"
          onClick={() => void refresh()}
          isLoading={isRefreshing}
          disabled={isRefreshing}
        >
          <IconRefresh size={16} />
          Refresh
        </Button>
      </div>

      <div className="credits__grid">
        <section className="credits__stat">
          <div className="credits__stat-head">
            <span className="credits__stat-icon"><IconCalendar size={18} strokeWidth={1.75} /></span>
            <span className="credits__stat-label">This month</span>
          </div>
          <span className="credits__stat-value">{formatCredits(credits.monthlyRemaining)}</span>
          <span className="credits__stat-detail">
            remaining of {formatCredits(credits.monthlyAllowance)}
          </span>
          <div
            className="credits__bar"
            role="progressbar"
            aria-label="Monthly credits used"
            aria-valuemin={0}
            aria-valuemax={credits.monthlyAllowance}
            aria-valuenow={credits.monthlyUsed}
          >
            <span className="credits__bar-fill" style={{ width: `${monthlyPercent}%` }} />
          </div>
        </section>

        <section className="credits__stat">
          <div className="credits__stat-head">
            <span className="credits__stat-icon"><IconPlus size={18} strokeWidth={1.75} /></span>
            <span className="credits__stat-label">Additional credits</span>
          </div>
          <span className="credits__stat-value">{formatCredits(credits.additional)}</span>
          <span className="credits__stat-detail">
            of {formatCredits(credits.additionalLimit)} plan limit
          </span>
        </section>

        <section className="credits__stat">
          <div className="credits__stat-head">
            <span className="credits__stat-icon"><IconLock size={18} strokeWidth={1.75} /></span>
            <span className="credits__stat-label">On hold</span>
          </div>
          <span className="credits__stat-value">{formatCredits(credits.onHold)}</span>
          <span className="credits__stat-detail">still yours, not spendable</span>
        </section>
      </div>

      <p className="credits__note">
        Monthly credits reset on {formatCreditDateTime(credits.monthlyResetsAt)} local time. Additional credits carry over and do not reset.
      </p>
    </div>
  );
};

export default CreditsPanel;
