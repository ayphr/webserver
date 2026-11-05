import { Sidebar } from '../../components/layout';
import './DashboardPage.css';

export const DashboardContentSkeleton = () => (
  <div className="dashboard-skeleton" aria-hidden="true">
    <div className="dashboard-skeleton__line dashboard-skeleton__line--title" />
    <div className="dashboard-skeleton__line" />
    <div className="dashboard-skeleton__line" />
    <div className="dashboard-skeleton__block" />
  </div>
);

export const DashboardLoadingSkeleton = () => (
  <div className="dashboard-layout">
    <Sidebar activeTab="overview" onChange={() => undefined} username="..." isDeveloper={false} pinned={false} credits={null} />
    <main className="dashboard-main">
      <section className="dashboard-panel">
        <header className="dashboard-panel__header">
          <h2>Dashboard</h2>
        </header>
        <div className="dashboard-panel__content">
          <DashboardContentSkeleton />
        </div>
      </section>
    </main>
  </div>
);
