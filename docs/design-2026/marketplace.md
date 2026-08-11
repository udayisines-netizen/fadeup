# FadeUp 2026 — public marketplace (Flagship #1)

Status: **built and verified against the live dev stack**. This is the
first flagship experience of the FadeUp 2026 rebuild (see the product
hierarchy brief) — the public consumer marketplace at `/`, plus its search
results page. Every other phase of that brief (customer app, barber app,
shop operations, `/for-business` motion pass, platform command center
redesign, i18n beyond what's needed here, SEO city pages, accessibility/
responsive QA across all breakpoints) is deliberately **not** attempted in
this pass — see "What's next" below.

## Why this needed schema changes, not just new pages

Before this work, FadeUp had **no marketplace/discovery data model at
all**: `organizations`/`locations` granted zero anonymous access (RLS:
`authenticated` only), and the only public surface was a direct-link
booking page (`/s/{known-slug}`) — nothing crawlable or searchable. See
`db/migrations/20260811160000_marketplace_discovery.sql`.

## What changed

**Database** (`20260811160000_marketplace_discovery.sql`):
- `organizations.marketplace_visible boolean default false` — explicit
  opt-in. An org existing is not enough to be listed; an owner/manager
  must publish it via `set_organization_marketplace_visible()`.
- `locations.latitude/longitude` (nullable — no geocoding pipeline exists
  yet; set manually until one does).
- `search_public_organizations(...)` — the one new anon-readable RPC.
  `SECURITY DEFINER`, narrowly-scoped, same pattern as the existing
  `get_public_organization`/`list_public_*` booking RPCs — **not** a broad
  anon SELECT policy on the underlying tables. Uses the already-enabled
  `earthdistance`/`cube`/`unaccent` extensions (no new dependency; Prospect
  Worker V2 already uses the same extensions for its own radius search).

  Every returned field is real, currently-computable data or `null` —
  nothing fabricated:
  - `starting_price_cents` — `min()` of active services actually offered
    at that location.
  - `is_open_now` — today's `location_hours` row evaluated in the
    location's own timezone.
  - `queue_waiting_count` — a live `count(*)` of `queue_entries` in
    `'waiting'` status. This is the real-time differentiator ("2 people
    waiting" on a search result) that most booking-marketplace
    competitors don't have, because most don't have a live queue at all.
  - `distance_km` — only computed when the caller supplies coordinates
    *and* the location has been geocoded; `null` otherwise, never a
    placeholder.
  - No rating/review field — no reviews table exists in this schema yet,
    so nothing is shown for it.

**Dev seed data** (`db/seeds/marketplace_demo.sql`, NOT part of the
migration chain): 5 real organizations (via real `organizations`/
`locations`/`memberships`/`staff_profiles`/`barbers`/`services` rows, not
fake marketplace-only records) — 3 in Paris, 1 in Lyon, 1 in Marseille —
so the marketplace has genuine results end-to-end in this sandbox. The 8
backing `auth.users` rows (owners + employed barbers) were created via the
GoTrue admin API, not this SQL file. To remove: `delete from
organizations where slug like 'demo-%'` (cascades), then delete those 8
users via the admin API.

**Frontend**:
- `/` is now `MarketplaceHomePage` (hero + search — "find a barber," not a
  SaaS pitch). The previous SaaS homepage moved to `/for-business`
  (`ForBusinessPage`, renamed from `home-page.tsx`) — see spec section 51's
  "two different experiences" requirement.
- `/search` — `MarketplaceSearchPage`. Search state lives in the URL
  (`?q=&city=&lat=&lng=`) for shareable links and correct back/forward.
  Deterministic ordering only (nearest-first when coordinates are known,
  else alphabetical) — no hidden ranking.
- `apps/web/src/lib/queries/marketplace.ts` — the one query hook,
  `useSearchPublicOrganizations`.
- `apps/web/src/lib/geolocation.ts` — thin `navigator.geolocation`
  wrapper. Only ever called from the "Use my location" button's explicit
  click handler (`components/marketplace/search-form.tsx`) — never
  requested on page load.
- `apps/web/src/components/marketplace/` — `MarketplaceSearchForm`,
  `MarketplaceResultCard`. No cover photos on cards (no image column
  exists on `organizations`/`locations`) — a monogram stands in rather
  than a fabricated/stock photo.
- New i18n namespace `marketplace` (all 10 locales) — see
  `design-system.md`.

## Deliberate scope cuts (and why)

- **No map / split-view.** No map library exists in this codebase yet;
  adding one is a real dependency decision (bundle size, licensing) that
  deserves its own scoping, not a rushed addition here. Results are
  list-first everywhere, matching the mobile-first requirement anyway.
- **"Open now" filters client-side**, not via a new RPC parameter. Result
  sets per city are small at marketplace-launch scale. Move server-side
  (`p_open_now` param on `search_public_organizations`) if/when that stops
  being true — noted in the RPC's own comment.
- **No public barber/shop profile redesign.** `/s/{slug}` and
  `/s/{slug}/barbers/{id}` already exist and already work (LOT 9/12) —
  result cards link straight into them. Restyling those pages to the full
  spec (hero/gallery, sticky mobile CTA, live queue widget) is real,
  separate work for the next flagship pass, not bundled in here.
- **No SEO city-page architecture** (`/fr/barbiers/paris`-style indexable
  routes, sitemap, structured data). `/search?city=Paris` works and is
  shareable, but isn't yet a dedicated crawlable route per city/service.

## Testing performed

- `db/tests/verify_prospect_worker_v2.sql` re-run clean against the live
  Postgres container (unaffected by this change, checked for regressions).
- `search_public_organizations` exercised directly via HTTP against the
  live Supabase/PostgREST stack with real seeded data — confirmed correct
  `starting_price_cents`, `is_open_now` (timezone-correct), live
  `queue_waiting_count`, and distance-sorted radius search.
- Full `apps/web` vitest suite (18 files / 58 tests, including 2 new
  marketplace page test files), `tsc -b --noEmit`, and `vite build` all
  pass clean.
- **Not done**: an actual browser render. Playwright's Chromium is
  installed in this sandbox but is missing ~12 system shared libraries
  (`libatk`, `libcups`, `libgbm`, ...) and there's no passwordless sudo
  available to install them — visual/console verification was not
  possible here. The vitest suite exercises the real component tree
  (jsdom), and the served build was smoke-checked via curl (200s, correct
  asset references, SPA fallback), but neither substitutes for an actual
  rendered screenshot. Flag this to a human before calling the visual QA
  gate (spec section 82) satisfied.

## What's next

In spec order: public barber/shop profile polish → public booking/live
queue conversion polish → customer application → barber application →
shop operations → `/for-business` motion pass → platform command center
redesign → SEO city pages → full responsive/accessibility QA. Each is its
own flagship-quality pass, not a shared sprint across all of them at once.
