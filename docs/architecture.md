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

### Known gap: email delivery is not configured (autoconfirm enabled as an interim fix)

`fadeup-supabase-auth` originally had `GOTRUE_MAILER_AUTOCONFIRM=false` and
`GOTRUE_SMTP_HOST=supabase-mail`, but no `supabase-mail` (or any SMTP) container exists
in `docker-compose.yml` — confirmed directly: `POST /auth/v1/signup` 500'd with
`{ "error_code": "unexpected_failure", "msg": "Error sending confirmation email" }` for
every signup, and the same would apply to password-reset emails.

Per an explicit decision, this was unblocked by recreating the `auth` container with
`ENABLE_EMAIL_AUTOCONFIRM=true` (`docker compose`'s shell-environment override takes
precedence over the `.env` file's stored value, so this did not require editing
`infra/supabase/.env`, which is permission-blocked from direct reads/edits in this
environment). **This override is not persisted** — `ENABLE_EMAIL_AUTOCONFIRM` in
`infra/supabase/.env` itself is still `false` (or unset), so any future full stack
recreation (`docker compose up -d` after a reboot, `run.sh recreate` without the
override, etc.) reverts to requiring email confirmation, at which point signups will
500 again until either the `.env` value is updated directly or real SMTP is configured.
Verified: a real, unauthenticated `POST /auth/v1/signup` now returns a session
immediately with no email step, exactly as the `/signup` page expects.

Real email delivery (password-reset, invite notifications) is still not configured —
that needs actual SMTP provider credentials (an external value, per `CLAUDE.md` §62) and
is unrelated to this autoconfirm fix.

## Database (`db/migrations`)

LOT 2 (multi-tenant foundation) and LOT 3 (auth + onboarding) are applied: `profiles`,
`organizations`, `memberships`, `locations`, `audit_logs`, `platform_admins`,
`invitations`, RLS enabled and forced on all seven tables with default-deny policies,
and bootstrap/invitation RPCs (`create_organization`, `complete_organization_onboarding`,
`get_invitation_by_token`, `accept_invitation`, `revoke_invitation`). See
`docs/database.md` for the full schema, migration convention, and RLS model, and
`db/tests/verify_rls.sql` / `db/tests/verify_onboarding_and_invitations.sql` for the
verification scripts.

## Frontend auth + onboarding (`apps/web`, LOT 3)

`lib/auth-context.tsx` (`AuthProvider`/`useAuth`) wraps Supabase session state;
`lib/current-org-context.tsx` resolves "the organization the user is currently working
in" from their memberships (never from anything client-trusted) and remembers the
choice in `localStorage`. Routes: `/login`, `/signup`, `/forgot-password`,
`/reset-password`, `/invite/:token` (public — previews an invitation via the anon-callable
`get_invitation_by_token` RPC before requiring a session), `/onboarding` and `/app`,
`/app/team` (protected via `RequireAuth`, redirecting to `/login?redirect=...`).
`/app/team` is a minimal invite/roster page, not the full staff directory (that's LOT 6);
it can only show the signed-in user's own display name for now because `profiles` has no
org-scoped read policy yet (documented gap from LOT 2). Verified: `npm run typecheck`,
`lint`, `test` (10 tests, Supabase mocked — no live network in unit tests), and `build`
all pass; the dev server was also driven end-to-end over real HTTP against the live
Kong/PostgREST/Postgres stack (sign-in, profile read, `complete_organization_onboarding`,
membership read, anon-safe invite lookup, RLS-denied anon org read) — all behaved
correctly and fixtures were cleaned up. Pixel-level browser rendering could not be
verified in this environment: Playwright's Chromium needs `libatk-1.0.so.0` and other
system libraries this sandbox user cannot install (no root) — a genuine environment
limitation, not a skipped step.

## Not yet built

Design system and landing page (LOT 4/5) are not implemented yet. Beyond auth/onboarding,
every product module described in `CLAUDE.md` is still pending (`staff_profiles` beyond
the minimal roster above, `services`, `appointments`, public booking pages, etc.). See the
project task list / roadmap (LOT 4 onward) for what's next.
