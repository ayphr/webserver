FROM node:22-slim AS deps
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/package-lock.json server/tsconfig.json ./
COPY server/src ./src

COPY common /common

CMD ["npm", "start"]
