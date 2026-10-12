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

## Server

The backend lives in `server/` and runs on Node.js (TypeScript is executed with
[`tsx`](https://tsx.is)).

```bash
cd server
npm install

# Start the TCP, API, and metrics listeners
npm start

# Re-run on file changes during development
npm run dev

# Type-check
npm run typecheck
```

### Run the Server with Docker

The full stack (server, MongoDB, Redis, Prometheus, and Grafana) is defined in
`docker-compose.yml`:

```bash
docker compose up --build
```

## Trademark Notice

The name, logos, and composite marks associated with this project are either trademarked or are owned by us. While the underlying source code is freely available under the Apache 2.0 license, this license **does not** grant you any rights to use our brand identity, logos, or name for your own distributions or commercial spin-offs.
