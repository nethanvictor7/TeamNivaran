FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY apps/api-gateway/package.json apps/api-gateway/package.json
RUN npm install

COPY packages packages
COPY apps/api-gateway apps/api-gateway
RUN npm run build:packages
RUN npm run build --workspace @cdep/api-gateway

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 cdep && useradd --system --uid 10001 --gid cdep cdep
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api-gateway/dist ./apps/api-gateway/dist
USER cdep
EXPOSE 3000
CMD ["node", "apps/api-gateway/dist/main.js"]
