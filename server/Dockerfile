FROM oven/bun:1 AS deps
WORKDIR /app

COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=7233
ENV TCP_PORT=7232

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/bun.lock server/tsconfig.json ./
COPY server/src ./src

# Shared contract package. server/tsconfig.json maps the "@common" alias to
# ../../common, which resolves to /common given WORKDIR /app.
COPY common /common

EXPOSE 7232 7233

CMD ["bun", "run", "src/index.ts"]
