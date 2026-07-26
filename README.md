# Ayphr Dashboard Website

[![CodeQL Advanced](https://github.com/ayphr/client/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayphr/client/actions/workflows/codeql.yml)

Frontend web client for Ayphr, built with React, TypeScript, and Vite.

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

## Project Structure

- `src/`: App source code (components, styling, entry points)
- `public/`: Static assets and web manifest
- `index.html`: App HTML template
- `vite.config.ts`: Vite config
- `tsconfig*.json`: TypeScript config
- `eslint.config.js`: ESLint config

## API Client

The client exposes a typed API wrapper in `src/lib/api`, backed by shared types and utilities in `common/`.

- Use `api.auth.login(...)`, `api.auth.register(...)`, and `api.auth.logout()` for session flows.
- Use `api.users.*`, `api.devices.*`, `api.punishments.*`, `api.staff.*`, and `api.market.purchase(...)` for higher-level app actions.
- Set `VITE_API_BASE_URL` if the HTTP server is not reachable through the default `/api` path.
