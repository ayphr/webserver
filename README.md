# Ayphr Website + Server

[![CodeQL Advanced](https://github.com/ayphr/webserver/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayphr/webserver/actions/workflows/codeql.yml)

Frontend and backend for Ayphr.

## Prerequisites

- Node.js 20+ and npm 10+ (frontend toolchain, `package-lock.json`)
- Bun **1.4.4** (server toolchain and the test runner, `server/bun.lock`)
- MongoDB and, optionally, Redis (see `.env.example`)

CI installs the same pinned Bun version declared in `.github/workflows/ci.yml`.

## Getting Started

```bash
npm ci                                  # frontend dependencies
cd server && bun install --frozen-lockfile && cd ..
cp .env.example .env                    # then fill in your values
```

### Run in Development

```bash
npm run dev
```

The server runs separately:

```bash
cd server && bun run start
```

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Lint and Typecheck

```bash
npm run lint                            # frontend + shared code
cd server && bun run lint && bun run typecheck
```

## Testing

```bash
npm test                                # full Bun suite: common/, src/ and server/
npm run test:typecheck                  # typecheck root-side test files
cd server && bun test                   # server tests only (what the server CI job runs)
```

The root suite is the gate for PRs: the server job alone only covers the tests under `server/`, so CI also runs `bun run test` from the repository root. `bunfig.toml` and `server/bunfig.toml` load `test-setup.ts` before every run to unset `REDIS_URL` (forcing in-memory rate limits), set `NODE_ENV=test`, and silence expected `LOG_LEVEL` warnings. Tests use Bun's built-in runner; no test framework dependencies are installed.

Frontend coverage currently targets pure helpers (routing, redirects, stream/state helpers) rather than rendered components: adding a DOM environment would require a new dependency (happy-dom/jsdom), so component tests are intentionally out of scope for now.

The legacy `common/tql/tql.test.ts` still runs but is excluded from `tsconfig.test.json` because its assertions rely on loose `QueryResult` narrowing.

## Server configuration

Copy `.env.example` to `.env` and fill in the values for your environment. The server validates configuration on startup: invalid enum values, ports, URLs, TTLs, Stripe price-tier entries, and VAPID key combinations fail fast with a combined error list. Optional integrations that are left unset produce warnings instead of failing startup. See `.env.example` for the complete list and tier examples.

## API versioning and generated client

The API is served only under `/api/v1`; unversioned `/api` paths return a JSON 404. The generated OpenAPI document is available at `GET /api/v1/openapi.json` and lists the live route surface, path parameters, and authentication expectations.

The browser client uses a generated route manifest so new routes cannot silently drift away from the frontend. The generator parses the `ROUTES` array from `server/src/api/router.ts` with the TypeScript AST (no regex scraping):

```bash
# from the repository root (or `cd server && bun run api:generate`)
bun run api:generate
bun run api:check
```

CI runs `bun run api:check` in both the server and root test jobs; it fails if the manifest is stale or if two routes collide on method/path or generated operation id. The manifest generates typed path builders; resource modules still own their bespoke request behavior and payload types.

## Observability

Grafana dashboards live in `monitoring/grafana/dashboards/`. The assistant dashboard includes feedback, error, rate-limit, and context-resume panels backed by server-side counters.

## Lockfile strategy

Both lockfiles are intentional and must stay in sync with their manifests:

- `package-lock.json` — npm, frontend/root toolchain (`npm ci`)
- `server/bun.lock` — Bun, server toolchain (`bun install --frozen-lockfile` in `server/`)

Do not replace one with the other: CI uses npm for the frontend build and Bun for server tests. When changing dependencies, update the relevant manifest **and** its lockfile in the same commit.

## Web Push setup

Browser push needs a secure context: HTTPS in production (localhost works in development) and a registered `/sw.js` service worker. Generate a VAPID keypair in the server directory:

```bash
cd server && npx web-push generate-vapid-keys
```

Then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` address or an `https://` URL) in the server environment; see `.env.example`. Until all three are present, the public-key endpoint returns `null` and the browser-push toggle stays disabled. The private key never leaves the server. Users can manage channel and per-type delivery settings from the Notifications panel. On iOS, web push only works after the site has been added to the Home Screen.

## Trademark Notice

The name, logos, and composite marks associated with this project are either trademarked or are owned by us. While the underlying source code is freely available under the Apache 2.0 license, this license **does not** grant you any rights to use our brand identity, logos, or name for your own distributions or commercial spin-offs.
