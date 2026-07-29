FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/audit-query-service/package.json apps/audit-query-service/package.json
RUN npm ci
COPY packages packages
COPY apps/audit-query-service apps/audit-query-service
RUN npm run prisma:generate --workspace @cdep/audit-query-service
RUN npm run build:packages
RUN npm run build --workspace @cdep/audit-query-service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10008 cdep && useradd --system --uid 10008 --gid cdep cdep
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/audit-query-service/dist ./apps/audit-query-service/dist
COPY --from=build /app/apps/audit-query-service/prisma ./apps/audit-query-service/prisma
COPY --from=build /app/apps/audit-query-service/package.json ./apps/audit-query-service/package.json
USER cdep
EXPOSE 3008
CMD ["node", "apps/audit-query-service/dist/src/main.js"]
