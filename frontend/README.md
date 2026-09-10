# Frontend structure

The frontend is a React/Vite SPA. It always calls the backend through relative
`/api` URLs: Vite proxies them in development and Nginx proxies them in the
production-like stack.

## Where to make changes

- `src/app/` — application shell, routing composition, and shared service instances.
- `src/pages/` — whole screens. Pages compose components and connect them to hooks.
- `src/components/request/` — presentational panels of the request screen.
- `src/hooks/use-request-data.ts` — initial request loading, local state sync, and polling hookup.
- `src/hooks/use-request-polling.ts` — polling lifecycle, retry backoff, focus/online recovery.
- `src/hooks/use-request-report.ts` — report loading and safe Markdown rendering.
- `src/hooks/use-recording-session.ts` — microphone selection, recorder lifecycle, and timer.
- `src/request-api.ts` — HTTP contract with the backend.
- `src/request-store.ts` — IndexedDB persistence and cleanup policy.
- `src/visit-recorder.ts` and `src/audio-meter.ts` — browser media primitives.
- `src/shared/` — formatting, status labels, downloads, and user-facing error mapping.

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
