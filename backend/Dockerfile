# ──────────────────────────────────────────────
# Stage 1 — Backend build
# ──────────────────────────────────────────────
FROM node:22-alpine AS backend-build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig*.json backend/nest-cli.json ./
COPY backend/src ./src

RUN npm run build && npm prune --omit=dev


# ──────────────────────────────────────────────
# Stage 2 — Backend runtime
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
# Stage 3 — Frontend runtime
# ──────────────────────────────────────────────
FROM nginx:alpine AS frontend

COPY frontend/ /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
