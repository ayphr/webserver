import { promises as dns } from 'node:dns';

export const DOMAIN_TXT_PREFIX = '_ayphr';

export function getTxtRecordNames(domain: string): string[] {
  const normalized = domain.trim().toLowerCase();
  return [`${DOMAIN_TXT_PREFIX}.${normalized}`];
}

export async function resolveTxtRecords(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((entry) => entry.join(''));
  } catch {
    return [];
  }
}

export async function resolveDomainTxt(domain: string): Promise<string[]> {
  const names = getTxtRecordNames(domain);
  const results: string[] = [];
  for (const name of names) {
    results.push(...(await resolveTxtRecords(name)));
  }
  return results;
}