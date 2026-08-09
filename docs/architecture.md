# FadeUp — Architecture

This document describes what actually exists in the repository. It is updated as each
build lot lands — it does not describe planned or speculative work.

## Repository layout

```
/opt/fadeup
├── apps/
│   └── web/            React + TypeScript + Vite frontend
├── db/
│   └── migrations/      Versioned SQL migrations (source of truth for schema)
├── infra/
│   └── supabase/        Self-hosted Supabase stack (Docker Compose)
├── backups/              Database backup output
└── docs/                 This documentation set
```

## Frontend (`apps/web`)

- **Framework:** React 19 + TypeScript, built with Vite.
- **Styling:** Tailwind CSS v4, wired in via `@tailwindcss/vite`.
- **Routing:** `react-router-dom`, configured in `src/routes/router.tsx` using
  `createBrowserRouter`. All routes render inside `RootLayout`.
- **Path alias:** `@/*` resolves to `src/*` (configured in both `vite.config.ts` and
  `tsconfig.app.json`).
- **Error handling:** A top-level class-based `ErrorBoundary`
  (`src/components/error-boundary.tsx`) wraps the router so an unhandled render error
  shows a recovery screen instead of a blank page.
- **Config/env:** `src/lib/env.ts` validates `VITE_`-prefixed public env vars with Zod.
  Only browser-safe values are read here — never a secret key. `src/lib/supabase.ts`
  lazily constructs a Supabase client from that config (anon/publishable key only).
- **Testing:** Vitest + Testing Library, jsdom environment, configured directly in
  `vite.config.ts` under the `test` key. Setup file: `src/test/setup.ts`.
- **Health check:** `public/health.json` is a static asset (not a SPA route) so it can
  be checked without executing JS — used by the Docker `HEALTHCHECK` and can be used by
  any external uptime check.

## Frontend container (`fadeup-web`)

`apps/web/Dockerfile` is a two-stage build:

1. `node:22-alpine` installs deps and runs `npm run build`, producing a static
   `dist/`. Public `VITE_*` values are passed as build args — no secret ever enters
   this image, because Vite only ever exposes `VITE_`-prefixed variables to client code,
   and only the Supabase anon/publishable key is used.
2. `nginx:1.27-alpine` serves `dist/` on port `8080` using `apps/web/nginx.conf`
   (SPA fallback to `index.html`, immutable caching for `/assets/`, no-store on
   `/health.json`). Container `HEALTHCHECK` polls `/health.json` every 30s.

Verified: `docker build` succeeds, the container serves `/`, `/health.json`, and an
arbitrary deep route (SPA fallback) all return `200`, and the container reports
`healthy` via `docker inspect`.

## Infrastructure (`infra/supabase`)

Self-hosted Supabase (official `supabase/docker` layout), running as Docker Compose
services named `fadeup-supabase-*` / `fadeup-realtime.supabase-realtime`. Local-only
port bindings:

| Service          | Port                  |
|-------------------|------------------------|
| Kong (API gateway) | `127.0.0.1:18100` (http), `127.0.0.1:18443` (https) |
| Postgres (direct)  | `127.0.0.1:15432`      |
| Supavisor pooler   | `127.0.0.1:16543`      |

PostgreSQL and every internal service is bound to `127.0.0.1` only — nothing here is
reachable from outside the host without going through Nginx/TLS (not yet configured).

## Database (`db/migrations`)

LOT 2 (multi-tenant foundation) is applied: `profiles`, `organizations`, `memberships`,
`locations`, `audit_logs`, `platform_admins`, RLS enabled and forced on all six with
default-deny policies, and a `create_organization()` bootstrap RPC. See
`docs/database.md` for the full schema, migration convention, and RLS model, and
`db/tests/verify_rls.sql` for the tenant-isolation verification script.

## Not yet built

Design system, landing page, auth/onboarding UI, and every product module beyond the
LOT 2 database foundation described in `CLAUDE.md` are not implemented yet
(`staff_profiles`, `services`, `appointments`, `invitations`, public booking pages).
See the project task list / roadmap (LOT 3 onward) for what's next.
