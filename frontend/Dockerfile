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

FROM nginx:1.30.4-alpine3.24@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.revision=$APP_VERSION

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/frontend-health"]

ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
