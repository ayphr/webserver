import { Sidebar } from '../../components/layout';
import './DashboardPage.css';

type DashboardLoadingSkeletonProps = {
  activeTab?: string;
};

const getPanelClassName = (activeTab: string) => {
  if (activeTab === 'users' || activeTab === 'games') {
    return 'dashboard-panel--full';
  }

  if (activeTab === 'overview' || activeTab === 'locations' || activeTab === 'profile' || activeTab === 'settings' || activeTab === 'account-settings' || activeTab === 'credits') {
    return 'dashboard-panel--wide';
  }

  if (activeTab === 'devices') {
    return 'dashboard-panel--devices';
  }

  return '';
};

export const DashboardContentSkeleton = () => (
  <div className="dashboard-skeleton" aria-hidden="true">
    <div className="dashboard-skeleton__line dashboard-skeleton__line--title" />
    <div className="dashboard-skeleton__line" />
    <div className="dashboard-skeleton__line" />
    <div className="dashboard-skeleton__block" />
  </div>
);

export const DashboardLoadingSkeleton = ({ activeTab = 'overview' }: DashboardLoadingSkeletonProps) => (
  <div
    className={`dashboard-layout${localStorage.getItem('ayphr-pref-compact') === '1' ? ' dashboard-layout--compact' : ''}`}
  >
    <Sidebar
      activeTab={activeTab}
      onChange={() => undefined}
      username="..."
      isDeveloper={false}
      pinned={localStorage.getItem('ayphr-pref-sidebar-pinned') === '1'}
      credits={null}
    />
    <main className="dashboard-main">
      <section className={`dashboard-panel ${getPanelClassName(activeTab)}${activeTab === 'devices' ? ' dashboard-panel--devices-skeleton' : ''}`} aria-busy="true">
        <header className="dashboard-panel__header">
          <div className="dashboard-skeleton__line dashboard-skeleton__line--header" aria-hidden="true" />
        </header>
        <div className="dashboard-panel__content">
          <DashboardContentSkeleton />
        </div>
      </section>
    </main>
  </div>
);
