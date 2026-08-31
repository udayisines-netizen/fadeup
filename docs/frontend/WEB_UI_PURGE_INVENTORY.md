# FadeUp — Web UI Purge Inventory

Date: 2026-09-01 · Branch `rebuild/social-first-v2` · Base HEAD `ce9b443`
Safety tag: `backup/pre-web-ui-purge-20260901` (annotated, local, not pushed)

This inventory classifies every frontend file group **before** any deletion.
Nothing is removed that is not listed DELETE here. Anything that could not be
cleanly separated from product infrastructure is marked REVIEW and kept.

## Scope decision recorded

The purge brief lists the customer, professional and public/marketing
surfaces exhaustively. It does **not** name the internal **platform
back-office** (35 `platform-*` pages: acquisition pipeline, prospects,
outreach, data science, application review, audit log, organizations, team).
That console is the operator surface for **Worker / Worker V2**, which the
brief explicitly preserves, and it was never part of the rejected
consumer/pro visual direction.

**Decision (confirmed by the product owner before deletion): the platform
back-office is KEPT and stays routed.** Everything customer-facing,
pro-facing and public/marketing is DELETED. The shared primitives the
platform console genuinely needs (`components/ui`, `components/auth`,
`components/platform`, `components/acquisition`) are therefore KEPT.

Dependency proof for that keep-set: `components/ui`, `components/auth` and
`components/brand` import only from each other; `components/platform` and
`components/acquisition` import only `components/{ui,platform,acquisition}`;
platform pages import only `@/components/{ui,auth,platform,acquisition,
platform-support-view-banner}` and `@/routes/{platform-support-view-context,
require-platform-role}`. No keep-set file imports a DELETE-set file.

---

## A. Pure visual / page code

| Group | Class | Why |
| --- | --- | --- |
| `src/customer-v3/**` (landing, shell, home, marketplace+map, profiles, booking, appointments, queue, profile, passport, book, ui, pages) | **DELETE** | The rejected V3 customer visual product in full. |
| `src/pro-v3/**` (shell, dashboard, calendar, customers, analytics, retention, profile editor) | **DELETE** | The rejected V3 professional visual product in full. |
| `src/pages/` — 44 customer/pro/public/marketing pages (`consumer-landing`, `business-landing`, `features`, `pricing`, `marketplace-search`, `shop-profile`, `public-barber`, `public-booking`, `public-queue-display`, `public-walkin`, `customer-*`, `app-*`, `onboarding-page`, `pro-*`, `workspace-selector`, `auth`/`login`/`register`/`invite`/`reset`/`forgot` screens, `passport-share-view`, `not-found`) | **DELETE** | The canonical (pre-R5R) visible customer + pro + marketing application. The brief removes the visible web application, not only the V3 attempt. |
| `src/pages/customer/`, `src/pages/pro/` | **DELETE** | Sub-pages of the same rejected surfaces. |
| `src/pages/platform-*.tsx` (35) | **KEEP** | Internal Worker V2 / ops console — see scope decision. |
| `src/routes/`: `customer-shell`, `pro-shell`, `marketing-layout`, `public-booking-layout`, `onboarding-route`, `pro-application-route`, `workspace-selector-route`, `require-pro-access` | **DELETE** | Customer/pro shells, navigation and gates for deleted surfaces. |
| `src/routes/`: `root-layout`, `route-error-boundary`, `require-auth`, `platform-layout`, `platform-acquisition-layout`, `platform-data-science-layout`, `platform-outreach-layout`, `platform-support-view-context`, `require-platform-role`, `router` | **KEEP** | Router infrastructure and the platform branch. `router.tsx` is rewritten (not deleted) to point product routes at the placeholder. |

## B. Shared visual primitives

| Group | Class | Why |
| --- | --- | --- |
| `src/ui-v3/ui-v3.css` | **DELETE** | The rejected V3 foundation (tokens, BG system, type voices, primitives). |
| `src/components/{marketing,for-business,marketplace,booking,calendar,customer,pro,profile,passport,notifications}` | **DELETE** | Screen-specific visual components for deleted surfaces only; no keep-set file imports them. |
| `src/components/ui` (43 files) | **KEEP** | Shared design-system primitives (button, dialog, toast, table, form controls…) that the retained platform console depends on — imported by 36/35 platform pages and by `lib`. |
| `src/components/auth` | **KEEP** | Auth forms/guards used by the platform login door. |
| `src/components/{platform,acquisition}` | **KEEP** | Platform console components. |
| `src/components/brand` (`FadeUpMark`/lockup) | **KEEP** | Canonical FadeUp identity, per brief §8. |
| `src/components/{error-boundary,preferences-sync,platform-support-view-banner}` | **KEEP** | App-level infrastructure, not screen design. |

## C–G. Non-visual infrastructure — all KEEP

| Group | Class | Why |
| --- | --- | --- |
| `src/lib/queries/**` (44 modules) | **KEEP** | Query/mutation contracts: marketplace, booking, queue, calendar, customers, analytics, passport, memberships, onboarding, follows, acquisition… Kept even where temporarily unused (brief §12). |
| `src/lib/{auth-context,supabase,query-client,realtime,analytics,theme,commerce,calendar,intl,booking,onboarding,geolocation,locale,errors,…}` | **KEEP** | Auth/session, realtime, pricing/entitlements, timezone maths, formatters, instrumentation, domain utilities. |
| `src/i18n/**`, `src/locales/**` | **KEEP** | Localization architecture, 10 locales, parity/RTL/no-hardcoded-string guards. **Exception:** the `v3` namespace (V3-only copy) is DELETED and de-registered; `v2`/`v2pro` subtrees were already removed. |
| `src/design/**` (token + accessibility gates) | **KEEP** | Enforce theme-token and a11y rules on whatever CSS remains. |
| `src/App.tsx`, `src/main.tsx` | **KEEP** | Boot: providers, i18n init, router mount. Unchanged. |

## H. Generated visual assets

| Group | Class | Why |
| --- | --- | --- |
| `src/assets/marketing/home/*` (hero-editorial ×10, culture-mirror ×6) | **DELETE** | Generated exclusively for the rejected V3 landing. Masters survive outside the app in `docs/design/artifacts/v3/`, and provenance is retained. |
| `src/assets/hero.png` | **DELETE** | Legacy marketing hero for the deleted landing. |
| `src/assets/brand/*.svg` (mark, loading mark, lockup) | **KEEP** | Canonical identity (brief §8). |
| `public/favicon.svg`, `public/fonts`, `public/marketing`, `robots.txt`, `sitemap.xml`, `health.json` | **REVIEW → KEEP** | Served static/deploy files; `public/marketing` and `sitemap.xml` reference deleted pages but are deploy-surface, not visual code — left for the rebuild rather than silently changing served output. |
| `docs/design/artifacts/v3/`, `docs/frontend/artifacts/**` | **KEEP** | Documentation/provenance and review evidence, not build artifacts (brief §1 last clause, §9). |

## I. Brand assets — KEEP (see above)

## J. Deployment / build infrastructure — KEEP

`Dockerfile*`, `docker-compose*`, `nginx/**`, `.env*`, `package.json`,
`vite.config.ts`, `tsconfig*.json`, `.oxlintrc*`, `vitest` config, CI and
scripts — untouched. `apps/web` must keep building and serving.

## K. Tests tied only to rejected DOM/layout — DELETE

All `*.test.tsx` co-located with deleted pages/components/routes: 34 page
tests (minus 5 platform), `components/{customer,marketing,marketplace,pro}`
tests, `routes/{customer-shell,require-pro-access}` tests,
`customer-v3/ui/result-row.test.tsx`, `src/App.test.tsx` (asserts the
deleted landing renders), and `e2e/v3/**` (browser harness for V3 routes).

## L. Tests enforcing business/product truth — KEEP

- `src/lib/**` (20 files): queries, access rules, service mode, realtime,
  booking maths, calendar time, commerce/pricing, intl/money, analytics,
  onboarding templates.
- `src/customer-v3/marketplace-supply.test.ts` → **KEEP, RELOCATED** to
  `src/lib/marketplace-supply.test.ts`: it enforces the public supply
  vocabulary (Independent/Barbershop only) and bans the internal
  `business_type` enum from client code. Its directory scan is retargeted at
  `src/` so the rule outlives the deleted namespace.
- `src/i18n/**` (7): locale parity, RTL direction, logical properties,
  no-hardcoded-strings, terminology, no-browser-locale.
- `src/design/**` (2): token gate, accessibility gate.
- `src/routes/{require-auth,route-error-boundary}.test.tsx`: authorization
  and error-boundary behavior.
- `src/components/{ui,auth,platform}/**` tests and the 5 platform page tests:
  retained surfaces.

## Dependency candidates (documented, NOT removed — brief §16)

Measured usage in `src/` after the purge:

| Package | Files using it | Verdict |
| --- | --- | --- |
| `lucide-react` | 18 | **in use** (platform console + primitives) |
| `maplibre-gl` | 1 | **in use** (`platform-acquisition-map-page`) |
| `qrcode` / `@types/qrcode` | 0 | candidate — was the Passport QR; expected again in the rebuild |
| `recharts` | 0 | candidate — was analytics charting; expected again in the rebuild |
| `@radix-ui/*`, `react-hook-form`, `zod` | >0 | **in use** by retained platform surfaces and `lib` |

**Nothing was removed** (brief §16). The two zero-usage packages are recorded
as candidates only: both are expected infrastructure for the next frontend,
and removing them now would trade a trivial install-size saving for a
re-install later.

## Post-purge route map (brief §11)

| Path | Before | After |
| --- | --- | --- |
| `/`, `/search`, `/for-business`, `/features`, `/pricing` | marketing pages | **placeholder** |
| `/login`, `/register`, `/signup`, `/pro/login`, `/pro/register`, `/pro/signup`, `/pro/application`, `/customer/*`, `/auth/callback`, `/invite/*`, `/forgot-password`, `/reset-password`, `/workspace` | auth + entry screens | **placeholder** |
| `/app/**` (pro cockpit), `/app/customer/**` | customer + pro product | **placeholder** |
| `/s/:slug**`, `/b/:id`, `/q/:slug`, `/w/:slug`, `/passport/shared/:token`, `/onboarding` | public booking/profile/queue/passport | **placeholder** |
| `/_preview/r5r**` | R5R preview | **removed** (branch already deleted 2026-08-31) |
| `/_preview/v3**` | V3 preview | **removed** (branch deleted here) |
| `/platform/**` | platform back-office | **unchanged** |
| backend API routes | — | **untouched** |

Preview branches are removed rather than redirected: they were explicitly
temporary namespaces, and leaving them as aliases of the placeholder would
preserve the impression that a preview product still exists.
