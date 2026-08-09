# FadeUp — Testing

Describes the testing setup that actually exists today. Expanded as each lot adds
real workflows to test.

## Frontend (`apps/web`)

Run from `apps/web/`:

| Command                | What it does                                      |
|--------------------------|----------------------------------------------------|
| `npm run typecheck`     | `tsc -b --noEmit` — project-wide type checking     |
| `npm run lint`          | `oxlint`                                            |
| `npm run test`          | `vitest run` — unit/component tests (jsdom)        |
| `npm run test:watch`    | `vitest` in watch mode                             |
| `npm run build`         | Type checks then produces a production `dist/`     |

Test files live next to the code they test (`*.test.tsx`). Setup file:
`src/test/setup.ts` (loads `@testing-library/jest-dom`).

Current coverage is a foundation smoke test only: the app renders its home route, and
the `ErrorBoundary` renders a fallback instead of crashing when a child throws.

## Database / RLS (`db/tests`)

`db/tests/verify_rls.sql` proves tenant isolation for the LOT 2 schema by seeding real
`auth.users` fixtures and simulating their sessions (`set local role authenticated`
plus `request.jwt.claims`, per Supabase's documented RLS testing approach), then running
actual queries and showing the result sets — not just asserting that a policy exists.
See `docs/database.md` ("Verification") for what it checks and its file header for how
to run it against the local stack. There is no automated runner/CI wiring for it yet;
it's invoked manually against `fadeup-supabase-db`.

## Not yet set up

- Playwright end-to-end tests (`@playwright/test` is installed but no config/tests
  exist yet — will be added once there are real flows to exercise: signup, booking,
  queue, etc., per LOT 57 in `CLAUDE.md`).
- Automated/CI execution of `db/tests/verify_rls.sql` (currently a manual script).
