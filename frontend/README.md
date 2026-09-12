# Frontend

The frontend is a React/Vite SPA. It always calls the backend through relative
`/api` URLs. Vite proxies them in development; in production the external
gateway routes `/api/*` directly to the backend.

## Run modes

For hot reload, start the API and Vite from `../local-stack`:

```sh
make frontend-dev
```

The Vite server listens on `http://localhost:5173`. Copy
`.env.development.example` to `.env.development` only when the default API
proxy target or dev port needs to change. These settings are development-only;
the application code always uses relative `/api` paths.

The production image is self-contained: it builds the Vite application and
serves the resulting files with its own unprivileged Nginx on port `8080`.

```sh
docker build --build-arg APP_VERSION="$(git rev-parse HEAD)" \
  -t overtone-frontend:local .
docker run --rm --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -p 8080:8080 overtone-frontend:local
# http://localhost:8080
```

No environment variables or shared volumes are required. `/tmp` is the only
writable path and should be mounted as `tmpfs` when the root filesystem is read
only. The container runs as the image user `nginx` and exposes:

- `GET`/`HEAD /frontend-health` — container health, `200` with `ok`;
- `/`, `/login`, `/requests`, `/profile`, `/admin`, and other extensionless
  history routes — the SPA entry document;
- `/assets/*` — fingerprinted Vite assets.

`index.html`, history fallbacks, and `version.json` use `Cache-Control:
no-store`. Fingerprinted files under `/assets/` use `Cache-Control: public,
max-age=31536000, immutable`. A missing path with a file extension is a real
`404` and is never rewritten to `index.html`.

This Nginx is only the frontend's internal static origin. It has no TLS, API
proxying, admin IP filtering, or BFF behavior. The external gateway must proxy
`/` to this container, route `/api/*` directly to the backend, and enforce any
network restriction for `/admin`.

## Where to make changes

- `src/app/` — application shell, routing composition, and shared service instances.
- `src/auth/` — session context, login/profile/admin API clients, and auth types.
- `src/pages/` — whole screens. Pages compose components and connect them to hooks.
- `src/pages/admin/` — administration screen orchestration.
- `src/components/admin/` — clinic, user, permission, and one-time-password UI.
- `src/components/request/` — presentational panels of the request screen.
- `src/hooks/use-request-data.ts` — initial request loading, local state sync, and polling hookup.
- `src/hooks/use-request-polling.ts` — polling lifecycle, retry backoff, focus/online recovery.
- `src/hooks/use-request-report.ts` — report loading and safe Markdown rendering.
- `src/hooks/use-recording-session.ts` — microphone selection, recorder lifecycle, and timer.
- `src/request-api.ts` — HTTP contract with the backend.
- `src/request-store.ts` — IndexedDB persistence and cleanup policy.
- `src/visit-recorder.ts` and `src/audio-meter.ts` — browser media primitives.
- `src/shared/` — formatting, status labels, downloads, and user-facing error mapping.
- `src/shared/api-client.ts` — versioned same-origin HTTP transport shared by all modules.

The SPA uses real history paths: `/login`, `/requests`, `/profile`, and
`/admin`. This lets the separate Nginx service restrict the admin page itself;
URL fragments such as `/#/admin` never reach a reverse proxy. Old request hash
links are migrated in the browser for compatibility.

`src/App.tsx` is only a stable public export. New application logic should be
placed in the layer that owns the concern instead of being added there.

## Checks

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
npm run test:image
```

The browser suite uses API interception to test recording and failure paths.
`npm run test:image` builds the production image, runs it without shared
volumes using a read-only root filesystem and `/tmp` tmpfs, verifies the static
origin HTTP contract, and checks SIGTERM shutdown. It needs Docker and the npm
dependencies installed.

Production builds include `/version.json` with the frontend source revision.
This revision is informational and is not coupled to the backend release.

Every frontend API request sends `X-Overtone-API-Version: 1` and validates the
same response header. API compatibility therefore belongs to the HTTP contract,
while backend and frontend images can be built and deployed independently.

Each immutable image contains one complete frontend build, so it can run on any
Swarm node without shared filesystem state.
