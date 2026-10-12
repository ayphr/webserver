import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { PublicUser } from '../../../common';
import { Card, CardBody, CardHeader, ProfileCard } from '../../components/common';
import { Sidebar } from '../../components/layout';
import './ProfilePage.css';

export const ProfilePage = () => {
  const { userUuid } = useParams<{ userUuid: string }>();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoadingCurrent(true);
      try {
        const { user } = await api.users.me();
        setCurrentUser(user);
      } catch (err) {
        console.error('Failed to load current user:', err);
      } finally {
        setIsLoadingCurrent(false);
      }
    };

    void load();
  }, []);

  const handleTabChange = (id: string) => {
    navigate(`/dashboard?tab=${encodeURIComponent(id)}`);
  };

  if (isLoadingCurrent) {
    return (
      <div className="profile-layout">
        <Sidebar activeTab="profile" onChange={handleTabChange} username="..." />
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
        <Sidebar activeTab="profile" onChange={handleTabChange} username={currentUser?.username ?? '...'} badges={currentUser?.badges} avatarUrl={currentUser?.avatarUrl} />
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

  const isOwnProfile = currentUser?.uuid === userUuid;
  const isStaff = currentUser?.role === 'staff';
  const canEditProfile = isOwnProfile || isStaff;

  return (
    <div className="profile-layout">
      <Sidebar activeTab="profile" onChange={handleTabChange} username={currentUser?.username ?? '...'} badges={currentUser?.badges} avatarUrl={currentUser?.avatarUrl} />
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
              isPunishable={isStaff}
            />
          </CardBody>
        </Card>
      </main>
    </div>
  );
};
