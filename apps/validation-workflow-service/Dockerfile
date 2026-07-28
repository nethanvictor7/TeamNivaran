FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/validation-workflow-service/package.json apps/validation-workflow-service/package.json
RUN npm ci
COPY packages packages
COPY apps/validation-workflow-service apps/validation-workflow-service
RUN npm run prisma:generate --workspace @cdep/validation-workflow-service
RUN npm run build:packages
RUN npm run build --workspace @cdep/validation-workflow-service

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10005 cdep && useradd --system --uid 10005 --gid cdep cdep
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/validation-workflow-service/dist ./apps/validation-workflow-service/dist
COPY --from=build /app/apps/validation-workflow-service/prisma ./apps/validation-workflow-service/prisma
COPY --from=build /app/apps/validation-workflow-service/package.json ./apps/validation-workflow-service/package.json
USER cdep
EXPOSE 3005
CMD ["node", "apps/validation-workflow-service/dist/src/main.js"]
