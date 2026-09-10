# Frontend structure

The frontend is a React/Vite SPA. It always calls the backend through relative
`/api` URLs: Vite proxies them in development and Nginx proxies them in the
production-like stack.

## Run modes

For hot reload, start the API and Vite from `../local-stack`:

```sh
make frontend-dev
```

The Vite server listens on `http://localhost:5173`. Copy
`.env.development.example` to `.env.development` only when the default API
proxy target or dev port needs to change. These settings are development-only;
the application code always uses relative `/api` paths.

For the production-like build, use Docker and the separate Nginx service:

```sh
make frontend
# http://localhost:8080
```

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
```

The browser suite uses API interception to test recording and failure paths.
The full Nginx stack smoke test is started from `../local-stack` with
`make smoke-overtone`.

Production builds include `/version.json` with the frontend source revision.
This revision is informational and is not coupled to the backend release.

Every frontend API request sends `X-Overtone-API-Version: 1` and validates the
same response header. API compatibility therefore belongs to the HTTP contract,
while backend and frontend images can be built and deployed independently.

The artifact container copies hashed assets first and then atomically replaces
`index.html`; old hashed assets are retained for seven days to protect
already-open browser tabs.
