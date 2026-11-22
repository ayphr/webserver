import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { CreditBalance, PublicUser } from '@common';
import { Card, CardBody, CardHeader, ProfileCard } from '../../components/common';
import { Sidebar } from '../../components/layout';
import { tabToPath } from '../../lib/dashboardRoutes';
import './ProfilePage.css';

type Props = {
  initialEditing?: boolean;
};

export const ProfilePage = ({ initialEditing = false }: Props) => {
  const { userUuid } = useParams<{ userUuid: string }>();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoadingCurrent(true);
      try {
        const { user, credits: creditBalance } = await api.users.me();
        setCurrentUser(user);
        setCredits(creditBalance);
      } catch (err) {
        console.error('Failed to load current user:', err);
      } finally {
        setIsLoadingCurrent(false);
      }
    };

    void load();
  }, []);

  const handleTabChange = async (id: string) => {
    await navigate(tabToPath(id));
  };

  const isOwnProfile = Boolean(currentUser && userUuid && currentUser.uuid === userUuid);
  const isStaff = currentUser?.role === 'staff';
  const canEditProfile = isOwnProfile || isStaff;

  // Editing your own profile has one canonical URL; the per-user edit path is
  // only for staff editing someone else.
  useEffect(() => {
    if (initialEditing && isOwnProfile && userUuid) {
      void navigate('/dashboard/profile/edit', { replace: true });
    }
  }, [initialEditing, isOwnProfile, navigate, userUuid]);

  if (isLoadingCurrent) {
    return (
      <div className="profile-layout">
        <Sidebar activeTab="profile" onChange={handleTabChange} username="..." credits={credits} />
        <main className="profile-main">
          <Card className="profile-page__card" elevated>
            <CardBody>
              <p>Loading profile...</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  if (!userUuid) {
    return (
      <div className="profile-layout">
        <Sidebar activeTab="profile" onChange={handleTabChange} username={currentUser?.username ?? '...'} badges={currentUser?.badges} avatarUrl={currentUser?.avatarUrl} credits={credits} />
        <main className="profile-main">
          <Card className="profile-page__card" elevated>
            <CardBody>
              <p>Invalid user ID</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="profile-layout">
      <Sidebar activeTab="profile" onChange={handleTabChange} username={currentUser?.username ?? '...'} badges={currentUser?.badges} avatarUrl={currentUser?.avatarUrl} credits={credits} />
      <main className="profile-main">
        <Card className="profile-page__card" elevated>
          <CardHeader>
            <h2>Profile</h2>
            <p>{isOwnProfile ? 'Your profile' : 'User profile'}</p>
          </CardHeader>
          <CardBody>
            <ProfileCard
              userUuid={userUuid}
              viewerUuid={currentUser?.uuid}
              viewerRole={currentUser?.role}
              canEditProfile={canEditProfile}
              isEditing={initialEditing}
              onEditingChange={(editing) => navigate(
                editing
                  ? (isOwnProfile
                    ? '/dashboard/profile/edit'
                    : `/dashboard/profile/${encodeURIComponent(userUuid)}/edit`)
                  : `/dashboard/profile/${encodeURIComponent(userUuid)}`,
              )}
              isPunishable={isStaff}
            />
          </CardBody>
        </Card>
      </main>
    </div>
  );
};
