# ──────────────────────────────────────────────
# Stage 1 — Backend build
# ──────────────────────────────────────────────
FROM node:22-alpine AS backend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev


# ──────────────────────────────────────────────
# Stage 2 — Frontend build
# ──────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_BOT_USERNAME=YourBot
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME

RUN npm run build


# ──────────────────────────────────────────────
# Stage 3 — Backend runtime
# ──────────────────────────────────────────────
FROM node:22-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg

COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/main.js"]


# ──────────────────────────────────────────────
# Stage 4 — Frontend runtime
# ──────────────────────────────────────────────
FROM nginx:alpine AS frontend

COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
