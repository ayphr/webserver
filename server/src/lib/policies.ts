import { POLICIES_VERSIONS_URL } from '@common';
import type { PolicyKey, PolicyStatus, PolicyVersions, User } from '@common';
import { createLogger } from './logger';

const log = createLogger('policies');

const CACHE_TTL_MS = 5 * 60 * 1000;

type PolicyVersionsFile = {
  policies: Record<PolicyKey, { version: number }>;
};

let cached: { versions: PolicyVersions; fetchedAt: number } | null = null;
let inflight: Promise<PolicyVersions | null> | null = null;

async function fetchPolicyVersions(): Promise<PolicyVersions> {
  const response = await fetch(POLICIES_VERSIONS_URL);
  if (!response.ok) {
    throw new Error(`unexpected status ${response.status}`);
  }

  const data = await response.json() as PolicyVersionsFile;

  return {
    tos: data.policies.tos.version,
    privacy: data.policies.privacy.version,
  };
}

export async function getPolicyVersions(): Promise<PolicyVersions | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.versions;
  }

  inflight ??= (async () => {
    try {
      const versions = await fetchPolicyVersions();
      cached = { versions, fetchedAt: Date.now() };
      return versions;
    } catch (error) {
      log.error({ error }, 'failed to fetch policy versions');
      if (cached) {
        cached = { versions: cached.versions, fetchedAt: Date.now() };
        return cached.versions;
      }
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getPolicyStatus(user: User): Promise<PolicyStatus | null> {
  const versions = await getPolicyVersions();
  if (!versions) return null;

  const accepted = user.policyAgreements ?? {};
  const pending: PolicyKey[] = [];

  if (accepted.tos !== versions.tos) pending.push('tos');
  if (accepted.privacy !== versions.privacy) pending.push('privacy');

  return {
    upToDate: pending.length === 0,
    pending,
    current: versions,
    accepted: {
      tos: accepted.tos,
      privacy: accepted.privacy,
    },
  };
}
