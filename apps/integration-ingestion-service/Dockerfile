FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/integration-ingestion-service/package.json apps/integration-ingestion-service/package.json
RUN npm install
COPY packages packages
COPY apps/integration-ingestion-service apps/integration-ingestion-service
RUN npm run prisma:generate --workspace @cdep/integration-ingestion-service
RUN npm run build:packages
RUN npm run build --workspace @cdep/integration-ingestion-service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10003 cdep && useradd --system --uid 10003 --gid cdep cdep
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/integration-ingestion-service/dist ./apps/integration-ingestion-service/dist
COPY --from=build /app/apps/integration-ingestion-service/prisma ./apps/integration-ingestion-service/prisma
COPY --from=build /app/apps/integration-ingestion-service/package.json ./apps/integration-ingestion-service/package.json
USER cdep
EXPOSE 3003
CMD ["node", "apps/integration-ingestion-service/dist/src/main.js"]
