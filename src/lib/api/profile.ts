import type {
  ProfileCountriesPayload,
  ProfileMePayload,
  PublicUser,
  SocialLinks,
  DomainChallengePayload,
} from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createProfileApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<ProfileMePayload>(apiPath(API_PATHS.getProfileMe));
      return {
        user: response.user,
      } satisfies ProfileMePayload;
    },
    async getCountries() {
      const response = await client.requestJson<ProfileCountriesPayload>(apiPath(API_PATHS.getProfileCountries));
      return {
        countries: response.countries,
      } satisfies ProfileCountriesPayload;
    },
    async updateCountry(input: { country: string }) {
      const response = await client.requestJson<{ user: PublicUser }>(apiPath(API_PATHS.patchProfileCountry), {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
    async editUser(userUuid: string, input: { country?: string; bio?: string; socialLinks?: SocialLinks }) {
      const response = await client.requestJson<{ user: PublicUser }>(apiPath(API_PATHS.patchProfileUuid, { uuid: userUuid }), {
        method: 'PATCH',
        body: input,
      });
      return response.user;
    },
    async requestDomainChallenge(input: { type?: string; socialType?: string; domain?: string; handle?: string; value?: string }) {
      const response = await client.requestJson<DomainChallengePayload>(apiPath(API_PATHS.postProfileDomainChallenge), {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async verifyDomain(input: { type?: string; socialType?: string; domain?: string; handle?: string; value?: string; token?: string; code?: string; challenge?: string }) {
      const response = await client.requestJson<{ verified: boolean; user: PublicUser }>(apiPath(API_PATHS.postProfileDomainVerify), {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async reverifyDomains() {
      const response = await client.requestJson<{ user: PublicUser }>(apiPath(API_PATHS.postProfileDomainReverify), {
        method: 'POST',
      });
      return response;
    },
    async uploadAvatar(file: File, userUuid?: string) {
      const form = new FormData();
      form.append('avatar', file);
      const query = userUuid ? `?userUuid=${encodeURIComponent(userUuid)}` : '';
      const response = await client.requestJson<{ user: PublicUser }>(apiPath(API_PATHS.postProfileAvatar, {}, query), {
        method: 'POST',
        body: form,
      });
      return response.user;
    },
    async removeAvatar(userUuid?: string) {
      const query = userUuid ? `?userUuid=${encodeURIComponent(userUuid)}` : '';
      const response = await client.requestJson<{ user: PublicUser }>(apiPath(API_PATHS.deleteProfileAvatar, {}, query), {
        method: 'DELETE',
      });
      return response.user;
    },
  };
}
