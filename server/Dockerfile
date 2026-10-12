FROM oven/bun:1 AS deps
WORKDIR /app

COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/bun.lock server/tsconfig.json ./
COPY server/src ./src

COPY common /common

CMD ["bun", "run", "src/index.ts"]
