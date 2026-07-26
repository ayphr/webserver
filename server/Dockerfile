FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=8080
ENV TCP_PORT=4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src

EXPOSE 8080 4000

CMD ["bun", "run", "src/index.ts"]
