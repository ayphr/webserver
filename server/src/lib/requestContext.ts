const clientIpByRequest = new WeakMap<Request, string>();

export function setClientIp(request: Request, ip: string | null): void {
  if (ip) clientIpByRequest.set(request, ip);
}

export function getClientIp(request: Request): string {
  return clientIpByRequest.get(request) ?? 'unknown';
}
