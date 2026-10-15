# Ayphr Website + Server

[![CodeQL Advanced](https://github.com/ayphr/webserver/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayphr/webserver/actions/workflows/codeql.yml)

Frontend and backend for Ayphr.

## Prerequisites

- Node.js 20+
- npm 10+

## Getting Started

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## Device data uploads

Devices authenticate with a per-device token rather than a user session.

1. In the dashboard, open **Devices** and click **Add device**. This returns a
   one-time token that is valid for `DEVICE_TOKEN_TTL_MINUTES` (default 60).
   Only one claim token can be pending per account at a time.
2. The device sends its readings to `POST /api/devices/data`. The first request
   that uses a pending token registers the device to the account that generated
   it, using the supplied serial and name.

```http
POST /api/devices/data
Content-Type: application/json

{
  "serial": 12345,
  "name": "Greenhouse sensor",
  "token": "<device token>",
  "data": [
    { "timestamp": "2025-01-01T12:00:00Z", "temperature": 21.4, "humidity": 48.2, "airPressure": 1012 }
  ]
}
```

`timestamp` may be an ISO 8601 string or Unix milliseconds. It is rounded to the
nearest second, and a data point replaces any existing value for the same device
and second. The token may also be sent as `Authorization: Bearer <device token>`.

## Caching & scaling

The server uses Redis as a shared cache so it can handle high request volumes
and many devices, and so several server instances can run behind one load
balancer.

| What | Where | TTL | Invalidated on |
| --- | --- | --- | --- |
| Auth bundle (session + user) | `ayphr:cache:auth:gen` + entry keys | 30s | logout / revoked session / role or profile change / account deletion (generation bump) |
| Active suspension lookup | `suspension:<uuid>` | 15s | punishment created, lifted or deleted |
| User document | `user:<uuid>` | 60s | any user mutation |
| Device document | `device:<serial>` | 60s (5s for misses) | device created/deleted, upload refreshes it |
| Device list + data point stats | `device_list:<owner>`, `device_stats:<owner>` | 30s | device upload, device registration/deletion |
| Rate limits (login/register) | `ayphr:cache:ratelimit:*` | window | fixed window per key |

Every cache operation is fail-soft: if Redis is unreachable the server falls
back to MongoDB (and per-process rate-limit buckets), so Redis is an
optimisation rather than a hard dependency. Set `REDIS_URL` (see
`.env.example`) to enable it; leave it empty to run without Redis.

Cache metrics are exported on the metrics port as
`ayphr_cache_operations_total{cache,result}`.

Additional environment variables:

- `MONGO_MAX_POOL_SIZE` – MongoDB connections per instance (default 100).
- `TRUST_PROXY=true` – use `X-Forwarded-For` for client IPs when running behind
  a reverse proxy (required for accurate rate limiting in that setup).

## Trademark Notice

The name, logos, and composite marks associated with this project are either trademarked or are owned by us. While the underlying source code is freely available under the Apache 2.0 license, this license **does not** grant you any rights to use our brand identity, logos, or name for your own distributions or commercial spin-offs.
