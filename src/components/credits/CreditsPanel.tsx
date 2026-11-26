import { useEffect } from 'react';
import {
  IconAlertCircle,
  IconCalendar,
  IconCoin,
  IconLock,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { PLAN_NAMES, type CreditBalance } from '@common';
import { formatCreditDateTime, formatCredits } from '../../lib/credits';
import { Button } from '../common';
import { useCreditsMe } from '../../lib/query/hooks/useCredits';
import './CreditsPanel.css';

type Props = {
  initialCredits?: CreditBalance | null;
  onCreditsChange?: (credits: CreditBalance) => void;
};

export const CreditsPanel = ({ initialCredits = null, onCreditsChange }: Props) => {
  const creditsQuery = useCreditsMe(initialCredits);
  const credits = creditsQuery.data ?? initialCredits;
  const isLoading = !credits && creditsQuery.isPending;
  const isRefreshing = creditsQuery.isFetching && !!credits;
  const error = creditsQuery.error instanceof Error ? creditsQuery.error.message : creditsQuery.error ? 'Failed to load your credits' : null;

  useEffect(() => {
    if (creditsQuery.data) onCreditsChange?.(creditsQuery.data);
  }, [creditsQuery.data, onCreditsChange]);

  const refresh = async () => {
    await creditsQuery.refetch();
  };

  if (isLoading && !credits) {
    return <p className="credits__loading">Loading your credits...</p>;
  }

  if (!credits) {
    return (
      <div className="credits__error" role="alert">
        <IconAlertCircle aria-hidden="true" size={18} />
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
        <div className="credits__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="credits__hero">
        <div className="credits__hero-icon">
          <IconCoin aria-hidden="true" size={30} strokeWidth={1.5} />
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
          <IconRefresh aria-hidden="true" size={16} />
          Refresh
        </Button>
      </div>

      <div className="credits__grid">
        <section className="credits__stat">
          <div className="credits__stat-head">
            <span className="credits__stat-icon"><IconCalendar aria-hidden="true" size={18} strokeWidth={1.75} /></span>
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
            <span className="credits__stat-icon"><IconPlus aria-hidden="true" size={18} strokeWidth={1.75} /></span>
            <span className="credits__stat-label">Additional credits</span>
          </div>
          <span className="credits__stat-value">{formatCredits(credits.additional)}</span>
          <span className="credits__stat-detail">
            of {formatCredits(credits.additionalLimit)} plan limit
          </span>
        </section>

        <section className="credits__stat">
          <div className="credits__stat-head">
            <span className="credits__stat-icon"><IconLock aria-hidden="true" size={18} strokeWidth={1.75} /></span>
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
