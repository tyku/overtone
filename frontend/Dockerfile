FROM node:22.22.0-alpine3.23 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY styles.css ./styles.css

RUN npm run build

FROM alpine:3.23.3 AS artifacts
COPY --from=build /app/dist /dist
RUN mkdir /output

CMD ["sh", "-c", "find /output -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && cp -a /dist/. /output/"]
