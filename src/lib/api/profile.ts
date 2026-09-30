import type {
  BioFormat,
  ProfileCountriesPayload,
  ProfileCountriesResponse,
  ProfileMePayload,
  ProfileMeResponse,
  PublicUser,
  SocialLinks,
} from '../../../common';
import type { RequestClient } from './client';

export function createProfileApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<ProfileMePayload>('/api/profile/me');
      return {
        user: response.user,
      } satisfies ProfileMeResponse;
    },
    async getCountries() {
      const response = await client.requestJson<ProfileCountriesPayload>('/api/profile/countries');
      return {
        countries: response.countries,
      } satisfies ProfileCountriesResponse;
    },
    async updateCountry(input: { country: string }) {
      const response = await client.requestJson<{ user: PublicUser }>('/api/profile/country', {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
    async editUser(userUuid: string, input: { country?: string; bio?: string; bioFormat?: BioFormat; socialLinks?: SocialLinks }) {
      const response = await client.requestJson<{ user: PublicUser }>(`/api/profile/${userUuid}`, {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
  };
}
