import type {
  ProfileCountriesPayload,
  ProfileMePayload,
  PublicUser,
  SocialLinks,
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
