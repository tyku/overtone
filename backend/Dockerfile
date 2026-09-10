FROM node:22.22.0-alpine3.23 AS backend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev


FROM node:22.22.0-alpine3.23 AS backend
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.revision=$APP_VERSION

RUN apk add --no-cache ffmpeg

COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/main.js"]
