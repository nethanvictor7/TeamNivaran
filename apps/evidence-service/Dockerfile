FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/evidence-service/package.json apps/evidence-service/package.json
RUN npm ci
COPY packages packages
COPY apps/evidence-service apps/evidence-service
RUN npm run prisma:generate --workspace @cdep/evidence-service
RUN npm run build:packages
RUN npm run build --workspace @cdep/evidence-service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10004 cdep && useradd --system --uid 10004 --gid cdep cdep
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/evidence-service/dist ./apps/evidence-service/dist
COPY --from=build /app/apps/evidence-service/prisma ./apps/evidence-service/prisma
COPY --from=build /app/apps/evidence-service/package.json ./apps/evidence-service/package.json
USER cdep
EXPOSE 3004
CMD ["node", "apps/evidence-service/dist/src/main.js"]
