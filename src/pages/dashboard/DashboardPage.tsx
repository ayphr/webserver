import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Punishment, PublicUser } from '../../../common';
import { Card, CardBody, CardHeader, UsernameDisplay, ProfileCard, Button } from '../../components/common';
import { Sidebar } from '../../components/layout';
import './DashboardPage.css';

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function getRelativeTime(date: Date | string): string {
  const resolvedDate = toDate(date);
  const now = new Date();
  const diffMs = now.getTime() - resolvedDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatDisplayDate(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-GB');
}

function getTimeRemaining(date: Date | string): string {
  const resolvedDate = toDate(date);
  const now = new Date();
  const diffMs = resolvedDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'Expired';
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `in ${diffYears} year${diffYears > 1 ? 's' : ''}`;
  if (diffMonths > 0) return `in ${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
  if (diffWeeks > 0) return `in ${diffWeeks} week${diffWeeks > 1 ? 's' : ''}`;
  if (diffDays > 0) return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  if (diffHours > 0) return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  if (diffMins > 0) return `in ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
  return 'in less than a minute';
}

function PunishmentCountdown({ endsAt, isPermanent }: Readonly<{ endsAt: Date | null; isPermanent: boolean }>) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      if (isPermanent) {
        setTimeLeft('Permanent');
        return;
      }

      const now = Date.now();
      const end = endsAt!.getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
    };

    update();
    const interval = setInterval(update, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [endsAt, isPermanent]);

  return <span className="dashboard-page__countdown">{timeLeft}</span>;
}

export const DashboardPage = () => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [activeSuspension, setActiveSuspension] = useState<Punishment | null>(null);
  const [activePage, setActivePage] = useState<string>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isLiftingPunishment, setIsLiftingPunishment] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);

      try {
        const userData = await api.users.me();
        setUser(userData.user);
        setActiveSuspension(userData.activeSuspension);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
        console.error(message);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const isSuspended = activeSuspension !== null;
  const isStaffOrOwner = user?.role === 'staff' || user?.role === 'owner';

  const handleSelfPunishment = async () => {
    // Refresh user data to get updated suspension status
    try {
      const userData = await api.users.me();
      setActiveSuspension(userData.activeSuspension);
      setActivePage('overview');
    } catch (err) {
      console.error('Failed to refresh user data after punishment:', err);
    }

    if (!activeSuspension) return;

    setIsLiftingPunishment(true);
    try {
      await api.staff.punishments.lift(activeSuspension.id);
      setActiveSuspension(null);
      setActivePage('overview');
    } catch (err) {
      console.error('Failed to lift suspension:', err);
    } finally {
      setIsLiftingPunishment(false);
    };
  };

  const handleLiftSuspension = async () => {
    if (!activeSuspension) return;

    setIsLiftingPunishment(true);
    try {
      await api.staff.punishments.lift(activeSuspension.id);
      setActiveSuspension(null);
      setActivePage('overview');
    } catch (err) {
      console.error('Failed to lift suspension:', err);
    } finally {
      setIsLiftingPunishment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="dashboard-layout">
        <Sidebar activeTab={activePage} onChange={setActivePage} username={user?.username ?? '...'} />
        <main className="dashboard-main">
          <Card className="dashboard-page__card" elevated>
            <CardBody>
              <p>Loading dashboard...</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="dashboard-layout">
        <Sidebar activeTab={activePage} onChange={setActivePage} username={'guest'} />
        <main className="dashboard-main">
          <Card className="dashboard-page__card" elevated>
            <CardBody>
              <p>Could not load user profile.</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      <Sidebar activeTab={activePage} onChange={setActivePage} username={user.username} role={user.role} country={user.country} isSuspended={isSuspended} />
      <main className="dashboard-main">
        {isSuspended && activePage !== 'profile' && activePage !== 'account-settings' && activePage !== 'settings' ? (
          <Card className="dashboard-page__card" elevated>
            <CardHeader>
              <h2>Account Suspended</h2>
              <p>You are currently under a suspension</p>
            </CardHeader>
            <CardBody>
              <div className="dashboard-page__punishment-info">
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Reason:</span>
                  <span className="dashboard-page__punishment-value">{activeSuspension.reason}</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Issued by:</span>
                  <span className="dashboard-page__punishment-value">{activeSuspension.issuedByUsername}</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Issued:</span>
                  <span className="dashboard-page__punishment-value">{getRelativeTime(activeSuspension.issuedAt)} ({formatDisplayDate(activeSuspension.issuedAt)})</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Ends:</span>
                  <span className="dashboard-page__punishment-value">
                    {activeSuspension.endsAt ? (
                      <>
                        {getTimeRemaining(activeSuspension.endsAt)} ({formatDisplayDate(activeSuspension.endsAt)})
                      </>
                    ) : (
                      'Permanent'
                    )}
                  </span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Time remaining:</span>
                  <PunishmentCountdown
                    endsAt={activeSuspension.endsAt}
                    isPermanent={activeSuspension.endsAt === null}
                  />
                </div>
              </div>
              {isStaffOrOwner && (
                <Button
                  onClick={handleLiftSuspension}
                  isLoading={isLiftingPunishment}
                  disabled={isLiftingPunishment}
                  variant="danger"
                  className="dashboard-page__lift-button"
                >
                  Lift Suspension
                </Button>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {activePage === 'overview' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Dashboard</h2>
                  <p>Profile summary</p>
                </CardHeader>

                <CardBody>
                  <UsernameDisplay
                    username={user.username}
                    role={user.role}
                    country={user.country}
                    className="dashboard-page__user-row"
                  />
                  <p>Welcome to your dashboard!</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'devices' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Devices</h2>
                  <p>Ayphr devices registered to your account</p>
                </CardHeader>
                <CardBody>
                  <p>No devices registered.</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'data' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Data</h2>
                  <p>Buy data</p>
                </CardHeader>
                <CardBody>
                  <p>No data available.</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'credits' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Credits</h2>
                  <p>Buy credits</p>
                </CardHeader>
                <CardBody>
                  <p>You cannot buy credits at this time.</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'profile' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Profile</h2>
                  <p>Your profile information</p>
                </CardHeader>
                <CardBody>
                  <ProfileCard
                    userUuid={user.uuid}
                    viewerUuid={user.uuid}
                    viewerRole={user.role}
                    canEditProfile
                    onPunishSelf={handleSelfPunishment}
                  />
                </CardBody>
              </Card>
            )}

            {activePage === 'settings' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Settings</h2>
                </CardHeader>
                <CardBody>
                  <p>Application settings go here.</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'account-settings' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Account Settings</h2>
                </CardHeader>
                <CardBody>
                  <p>Account-specific settings go here.</p>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
};
