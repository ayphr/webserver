import type { LookupAddress } from 'dns';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export type WebhookUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export type WebhookTarget = {
  /** Original, validated URL (never rewritten by hostname resolution). */
  url: string;
  /** Normalized hostname used for TLS SNI and the Host header. */
  hostname: string;
  hostHeader: string;
  protocol: 'http:' | 'https:';
  port: number;
  path: string;
  /** IP address validated at send time; the connection is pinned to it. */
  address: string;
  addressFamily: 4 | 6;
  isIpLiteral: boolean;
};

type ResolvedWebhookTarget =
  | { ok: true; target: WebhookTarget }
  | { ok: false; reason: string };

export type PinnedRequestOptions = {
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  path: string;
  method: 'POST';
  headers: Record<string, string>;
  /** Original hostname: TLS uses it for SNI/cert checks even while connecting to the pinned IP. */
  servername?: string;
};

export type PinnedRequestFn = (
  options: PinnedRequestOptions,
  body: string,
  timeoutMs: number,
) => Promise<{ status: number }>;

export type PinnedWebhookResult =
  | { ok: true; status: number }
  | { ok: false; reason: string; status?: number };

const MAX_URL_LENGTH = 2048;
const DNS_LOOKUP_TIMEOUT_MS = 5000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.invalid',
  '.test',
  '.example',
];

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  const [a = 0, b = 0, c = 0] = octets;
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  // Loopback, private, link-local (including cloud metadata), CGNAT,
  // reserved/test networks, multicast and unspecified.
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseIpv6Groups(address: string): number[] | null {
  let normalized = address.toLowerCase();
  const ipv4Tail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split('.').map(Number);
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const high = ((a << 16) | b).toString(16);
    const low = ((c << 16) | d).toString(16);
    normalized = `${normalized.slice(0, -ipv4Tail.length)}${high}:${low}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ?? '';
  const tail = halves[1] ?? '';
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  if (halves.length === 1 && headGroups.length !== 8) return null;
  if (halves.length === 2 && headGroups.length + tailGroups.length >= 8) return null;

  const groups = [
    ...headGroups,
    ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'),
    ...tailGroups,
  ];
  if (groups.length !== 8) return null;

  const values: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffff) return null;
    values.push(value);
  }
  return values;
}

function isBlockedIpv6(address: string): boolean {
  const groups = parseIpv6Groups(address);
  if (!groups) return true;

  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.every((group, index) => (index === 7 ? group === 1 : group === 0));
  if (isUnspecified || isLoopback) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    const mapped = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isBlockedIpv4(mapped);
  }

  const firstByte = g0 >> 8;
  if ((firstByte & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (firstByte === 0xfe || firstByte === 0xff) return true; // link-local/site-local, multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo / reserved
  if (g0 === 0x2002) return true; // 6to4
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function resolveWithTimeout(hostname: string): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns lookup timed out')), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validates and resolves a webhook destination in one step. All DNS answers
 * are checked (so a single private record cannot slip through) and the chosen
 * IP is returned so the caller can pin the connection to it.
 */
export async function resolveWebhookTarget(
  value: unknown,
  lookupFn: (hostname: string) => Promise<LookupAddress[]> = resolveWithTimeout,
): Promise<ResolvedWebhookTarget> {
  if (typeof value !== 'string') return { ok: false, reason: 'webhook url must be a string' };

  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return { ok: false, reason: 'invalid webhook url' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid webhook url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'webhook url must use http or https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'webhook url must not contain credentials' };
  }

  const hostname = parsed.hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (!hostname || isBlockedHostname(hostname)) {
    return { ok: false, reason: 'webhook url host is not allowed' };
  }

  const ipVersion = isIP(hostname);
  let addresses: LookupAddress[];
  if (ipVersion !== 0) {
    if (isBlockedAddress(hostname, ipVersion)) {
      return { ok: false, reason: 'webhook url points to a restricted IP address' };
    }
    addresses = [{ address: hostname, family: ipVersion as 4 | 6 }];
  } else {
    try {
      addresses = await lookupFn(hostname);
    } catch {
      return { ok: false, reason: 'webhook url host could not be resolved' };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: 'webhook url host could not be resolved' };
    }
    if (addresses.some(({ address, family }) => isBlockedAddress(address, family))) {
      return { ok: false, reason: 'webhook url resolves to a restricted IP address' };
    }
  }

  const pinned = addresses[0]!;
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'invalid webhook url port' };
  }

  return {
    ok: true,
    target: {
      url,
      hostname,
      hostHeader: parsed.host,
      protocol: parsed.protocol as 'http:' | 'https:',
      port,
      path: `${parsed.pathname}${parsed.search}`,
      address: pinned.address,
      addressFamily: pinned.family === 6 ? 6 : 4,
      isIpLiteral: ipVersion !== 0,
    },
  };
}

/** Validates a webhook destination against SSRF-prone addresses and hostnames. */
export async function validateWebhookUrl(value: unknown): Promise<WebhookUrlResult> {
  const resolved = await resolveWebhookTarget(value);
  return resolved.ok ? { ok: true, url: resolved.target.url } : resolved;
}

/** Builds the connection options for a revalidated, IP-pinned webhook request. */
export function buildPinnedRequestOptions(
  target: WebhookTarget,
  headers: Record<string, string> = {},
): PinnedRequestOptions {
  return {
    protocol: target.protocol,
    hostname: target.address,
    port: target.port,
    path: target.path,
    method: 'POST',
    servername: target.isIpLiteral ? undefined : target.hostname,
    headers: {
      ...headers,
      Host: target.hostHeader,
    },
  };
}

async function defaultPinnedRequest(
  options: PinnedRequestOptions,
  body: string,
  timeoutMs: number,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport(options, (response) => {
      // Drain the response; redirects are intentionally not followed.
      response.resume();
      resolve({ status: response.statusCode ?? 0 });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('webhook request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Revalidates the URL immediately before delivery and connects to the
 * validated IP, closing the DNS-rebinding TOCTOU window. Redirects are never
 * followed (Node's http/https clients do not follow them automatically).
 */
export async function postToPinnedWebhook(
  value: unknown,
  body: string,
  options: {
    timeoutMs: number;
    headers?: Record<string, string>;
    lookup?: (hostname: string) => Promise<LookupAddress[]>;
    request?: PinnedRequestFn;
  },
): Promise<PinnedWebhookResult> {
  const resolved = await resolveWebhookTarget(value, options.lookup);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const requestOptions = buildPinnedRequestOptions(resolved.target, options.headers);
  try {
    const request = options.request ?? defaultPinnedRequest;
    const { status } = await request(requestOptions, body, options.timeoutMs);
    if (status >= 200 && status < 300) return { ok: true, status };
    return { ok: false, status, reason: `webhook returned status ${status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'webhook request failed' };
  }
}
