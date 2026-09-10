FROM node:22.22.0-alpine3.23 AS build
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY styles.css ./styles.css

RUN npm run build

FROM alpine:3.23.3 AS artifacts
ARG APP_VERSION=dev
LABEL org.opencontainers.image.revision=$APP_VERSION
COPY --from=build /app/dist /dist
COPY scripts/publish-assets.sh /usr/local/bin/publish-assets
RUN chmod +x /usr/local/bin/publish-assets && mkdir /output

CMD ["/usr/local/bin/publish-assets"]
