FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.base.json tsconfig.base.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web-portal/package.json apps/web-portal/package.json
RUN npm install
COPY packages/contracts packages/contracts
COPY apps/web-portal apps/web-portal
RUN npm run build --workspace @cdep/contracts
RUN npm run build --workspace @cdep/web-portal

FROM nginx:stable-alpine AS runtime
COPY apps/web-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-portal/dist /usr/share/nginx/html
EXPOSE 8080
