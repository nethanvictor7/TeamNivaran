FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/identity-access-service/package.json apps/identity-access-service/package.json
RUN npm install

COPY packages packages
COPY apps/identity-access-service apps/identity-access-service
RUN npm run prisma:generate --workspace @cdep/identity-access-service
RUN npm run build:packages
RUN npm run build --workspace @cdep/identity-access-service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10001 cdep && useradd --system --uid 10001 --gid cdep cdep

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/identity-access-service/dist ./apps/identity-access-service/dist
COPY --from=build /app/apps/identity-access-service/prisma ./apps/identity-access-service/prisma
COPY --from=build /app/apps/identity-access-service/package.json ./apps/identity-access-service/package.json

USER cdep
EXPOSE 3001
CMD ["node", "apps/identity-access-service/dist/src/main.js"]
