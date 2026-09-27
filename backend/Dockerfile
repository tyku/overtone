FROM node:22.22.0-alpine3.23 AS backend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev


FROM alpine:3.23 AS beget-ca
RUN apk add --no-cache ca-certificates curl openssl
# Pass a fresh value for manual builds to bypass Docker's cached download layer.
ARG BEGET_CA_REFRESH=manual
RUN : "$BEGET_CA_REFRESH" \
    && curl --fail --location --show-error --silent --proto '=https' --tlsv1.2 \
      https://beget.com/cloud-ca.crt --output /beget-cloud-ca.crt \
    && openssl x509 -in /beget-cloud-ca.crt -noout -checkend 0


FROM node:22.22.0-alpine3.23 AS backend
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/beget-cloud-ca.crt
LABEL org.opencontainers.image.revision=$APP_VERSION

RUN apk add --no-cache ffmpeg

COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/package.json ./package.json
COPY --from=beget-ca /beget-cloud-ca.crt /etc/ssl/certs/beget-cloud-ca.crt

EXPOSE 3000
CMD ["node", "dist/main.js"]
