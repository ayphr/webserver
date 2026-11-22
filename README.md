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

## Server configuration

Copy `.env.example` to `.env` and fill in the values for your environment. The server validates configuration on startup: invalid enum values, ports, URLs, TTLs, Stripe price-tier entries, and VAPID key combinations fail fast with a combined error list. Optional integrations that are left unset produce warnings instead of failing startup. See `.env.example` for the complete list and tier examples.

## API versioning and generated client

The API is served only under `/api/v1`; unversioned `/api` paths return a JSON 404. The generated OpenAPI document is available at `GET /api/v1/openapi.json` and lists the live route surface, path parameters, and authentication expectations.

The browser client uses a generated route manifest so new routes cannot silently drift away from the frontend:

```bash
cd server && bun run api:generate
```

CI runs `bun run api:check`, which fails if the manifest is stale. The manifest currently generates typed path builders; resource modules still own their bespoke request behavior and payload types.

## Web Push setup

Browser push needs a secure context: HTTPS in production (localhost works in development) and a registered `/sw.js` service worker. Generate a VAPID keypair in the server directory:

```bash
cd server && npx web-push generate-vapid-keys
```

Then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` address or an `https://` URL) in the server environment; see `.env.example`. Until all three are present, the public-key endpoint returns `null` and the browser-push toggle stays disabled. The private key never leaves the server. Users can manage channel and per-type delivery settings from the Notifications panel. On iOS, web push only works after the site has been added to the Home Screen.

## Trademark Notice

The name, logos, and composite marks associated with this project are either trademarked or are owned by us. While the underlying source code is freely available under the Apache 2.0 license, this license **does not** grant you any rights to use our brand identity, logos, or name for your own distributions or commercial spin-offs.
