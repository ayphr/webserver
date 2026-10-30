import { promises as dns } from 'node:dns';

export const DOMAIN_TXT_PREFIX = '_ayphr';

export function getTxtRecordNames(domain: string): string[] {
  const normalized = domain.trim().toLowerCase();
  return [`${DOMAIN_TXT_PREFIX}.${normalized}`];
}

export async function resolveTxtRecords(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    const normalized = records.map((entry) => entry.join('').trim()).filter(Boolean);
    if (normalized.length > 0) return normalized;
  } catch {
    // fall through
  }

  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    const records = await dns.resolveTxt(name);
    return records.map((entry) => entry.join('').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function resolveDomainTxt(domain: string): Promise<string[]> {
  const names = getTxtRecordNames(domain);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const results: string[] = [];
    for (const name of names) {
      results.push(...(await resolveTxtRecords(name)));
    }
    if (results.length > 0) {
      return results.map((value) => value.trim());
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return [];
}
