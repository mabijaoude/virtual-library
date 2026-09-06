FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY books ./books
COPY examples ./examples
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY index.html tsconfig.json vite.config.ts ./

RUN pnpm build

FROM nginx:1.30.4-alpine3.24 AS web

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
