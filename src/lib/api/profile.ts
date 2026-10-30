import type {
  ProfileCountriesPayload,
  ProfileMePayload,
  PublicUser,
  SocialLinks,
  DomainChallengePayload,
} from '@common';
import type { RequestClient } from './client';

export function createProfileApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<ProfileMePayload>('/api/profile/me');
      return {
        user: response.user,
      } satisfies ProfileMePayload;
    },
    async getCountries() {
      const response = await client.requestJson<ProfileCountriesPayload>('/api/profile/countries');
      return {
        countries: response.countries,
      } satisfies ProfileCountriesPayload;
    },
    async updateCountry(input: { country: string }) {
      const response = await client.requestJson<{ user: PublicUser }>('/api/profile/country', {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
    async editUser(userUuid: string, input: { country?: string; bio?: string; socialLinks?: SocialLinks }) {
      const response = await client.requestJson<{ user: PublicUser }>(`/api/profile/${userUuid}`, {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
    async requestDomainChallenge(input: { type?: string; socialType?: string; domain?: string; handle?: string; value?: string }) {
      const response = await client.requestJson<DomainChallengePayload>('/api/profile/domain-challenge', {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async verifyDomain(input: { type?: string; socialType?: string; domain?: string; handle?: string; value?: string; token?: string; code?: string; challenge?: string }) {
      const response = await client.requestJson<{ verified: boolean; user: PublicUser }>('/api/profile/domain-verify', {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async reverifyDomains(input: any = {}) {
      const response = await client.requestJson<any>('/api/profile/domain-reverify', {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async uploadAvatar(file: File, userUuid?: string) {
      const form = new FormData();
      form.append('avatar', file);
      const query = userUuid ? `?userUuid=${encodeURIComponent(userUuid)}` : '';
      const response = await client.requestJson<{ user: PublicUser }>(`/api/profile/avatar${query}`, {
        method: 'POST',
        body: form,
      });
      return response.user;
    },
    async removeAvatar(userUuid?: string) {
      const query = userUuid ? `?userUuid=${encodeURIComponent(userUuid)}` : '';
      const response = await client.requestJson<{ user: PublicUser }>(`/api/profile/avatar${query}`, {
        method: 'DELETE',
      });
      return response.user;
    },
  };
}