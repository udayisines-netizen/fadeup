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

## Not yet set up

- Playwright end-to-end tests (`@playwright/test` is installed but no config/tests
  exist yet — will be added once there are real flows to exercise: signup, booking,
  queue, etc., per LOT 57 in `CLAUDE.md`).
- Database/RLS tests (arrive with LOT 2 — tenant isolation tests are mandatory there).
