import { POLICIES_VERSIONS_URL } from '@common';
import type { PolicyKey, PolicyStatus, PolicyVersions, PolicyVersionsData, User } from '@common';
import { createLogger } from './logger';

const log = createLogger('policies');

const CACHE_TTL_MS = 5 * 60 * 1000;

type PolicyVersionsFile = {
  policies: Record<PolicyKey, { version: number; updated_date_formatted?: string }>;
};

let cached: { data: PolicyVersionsData; fetchedAt: number } | null = null;
let inflight: Promise<PolicyVersionsData | null> | null = null;

async function fetchPolicyData(): Promise<PolicyVersionsData> {
  const response = await fetch(POLICIES_VERSIONS_URL);
  if (!response.ok) {
    throw new Error(`unexpected status ${response.status}`);
  }

  const data = await response.json() as PolicyVersionsFile;

  return {
    versions: {
      tos: data.policies.tos.version,
      privacy: data.policies.privacy.version,
    },
    updatedDates: {
      tos: data.policies.tos.updated_date_formatted,
      privacy: data.policies.privacy.updated_date_formatted,
    },
  };
}

export async function getPolicyData(): Promise<PolicyVersionsData | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  inflight ??= (async () => {
    try {
      const data = await fetchPolicyData();
      cached = { data, fetchedAt: Date.now() };
      return data;
    } catch (error) {
      log.error({ error }, 'failed to fetch policy versions');
      if (cached) {
        cached = { data: cached.data, fetchedAt: Date.now() };
        return cached.data;
      }
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getPolicyVersions(): Promise<PolicyVersions | null> {
  const data = await getPolicyData();
  return data?.versions ?? null;
}

export async function getPolicyStatus(user: User): Promise<PolicyStatus | null> {
  const data = await getPolicyData();
  if (!data) return null;

  const accepted = user.policyAgreements ?? {};
  const pending: PolicyKey[] = [];

  if (accepted.tos !== data.versions.tos) pending.push('tos');
  if (accepted.privacy !== data.versions.privacy) pending.push('privacy');

  return {
    upToDate: pending.length === 0,
    pending,
    current: data.versions,
    updatedDates: data.updatedDates,
    accepted: {
      tos: accepted.tos,
      privacy: accepted.privacy,
    },
  };
}