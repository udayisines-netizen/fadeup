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

### Known gap: email delivery is not configured (autoconfirm persisted as an interim fix)

`fadeup-supabase-auth`'s `GOTRUE_MAILER_AUTOCONFIRM` is driven by
`${ENABLE_EMAIL_AUTOCONFIRM}` in `infra/supabase/.env`, and no `supabase-mail` (or any
SMTP) container exists in `docker-compose.yml` — confirmed directly: without this fix,
`POST /auth/v1/signup` 500s with
`{ "error_code": "unexpected_failure", "msg": "Error sending confirmation email" }` for
every signup, and the same applies to password-reset emails.

**Fix, made reproducible without touching secrets:** `infra/supabase/docker-compose.fadeup-auth.yml`
is a small, version-controlled, secret-free override file:

```yaml
services:
  auth:
    environment:
      GOTRUE_MAILER_AUTOCONFIRM: "true"
```

Docker Compose merges the `environment:` map of every file in `COMPOSE_FILE` (or every
`-f` flag), later files winning per key — so this file forces
`GOTRUE_MAILER_AUTOCONFIRM: "true"` regardless of what `infra/supabase/.env`'s
`ENABLE_EMAIL_AUTOCONFIRM` resolves to, without ever reading, editing, or exposing that
file (which holds real secrets and is correctly permission-blocked from direct access in
this environment). It's layered in via Compose's own supported mechanism —
`infra/supabase/run.sh`'s `config add`/`config remove` subcommands, which only rewrite
the `COMPOSE_FILE=` line in `.env`, never a secret:

```bash
sh run.sh config add fadeup-auth      # already applied on this host
sh run.sh config remove fadeup-auth   # to revert, once real SMTP is configured
```

**One-time step on a fresh clone/environment:** `COMPOSE_FILE` lives in
`infra/supabase/.env`, which is git-ignored (contains secrets) — so a new environment
must run `sh run.sh config add fadeup-auth` once after `setup.sh`/first `.env`
generation, or signups will 500 there until it's run. This is the one part of the fix
that isn't automatically reproduced by cloning the repo; everything else (the override
file itself) is.

**Verified, not assumed:** `GOTRUE_MAILER_AUTOCONFIRM=true` was confirmed directly on the
container after `sh run.sh recreate` (single-service) — and then again after a **full**
`sh run.sh recreate` (stops and removes all 11 containers, recreates the network, brings
everything back up), which is the actual scenario this needed to survive. All containers
returned to `healthy` (storage/realtime took ~15s longer than the rest — normal, not
caused by this change), the LOT 2/3 schema and all 19 RLS policies were confirmed intact
(Postgres data lives in a named volume, untouched by `down` without `-v`), and a real,
unauthenticated `POST /auth/v1/signup` after the full recreation still returned a session
immediately with no email step.

Real email delivery (password-reset, invite notifications) is still not configured —
that needs actual SMTP provider credentials (an external value, per `CLAUDE.md` §62) and
is unrelated to this fix. Revisit `docker-compose.fadeup-auth.yml` (remove or restrict to
non-production environments) once SMTP is real.

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
`/app/team` was a minimal invite/roster page at LOT 3 — since LOT 6 it's the full staff
directory backed by `staff_profiles`, see below. Verified: `npm run typecheck`,
`lint`, `test` (10 tests, Supabase mocked — no live network in unit tests), and `build`
all pass; the dev server was also driven end-to-end over real HTTP against the live
Kong/PostgREST/Postgres stack (sign-in, profile read, `complete_organization_onboarding`,
membership read, anon-safe invite lookup, RLS-denied anon org read) — all behaved
correctly and fixtures were cleaned up. Pixel-level browser rendering could not be
verified in this environment: Playwright's Chromium needs `libatk-1.0.so.0` and other
system libraries this sandbox user cannot install (no root) — a genuine environment
limitation, not a skipped step.

## Design system (`apps/web`, LOT 4)

`src/index.css` has the full token contract, defined once as the single source of truth
(Tailwind v4 `@theme` block) — every component draws from it, no ad hoc hex/shadow/radius
values in component code:

- **Color**: warm `ink-{950,800,700,500,300}` text neutrals and `paper-{0,50,100,200}`
  surface neutrals (deliberately not pure black/white), `border`/`border-strong`, a copper
  `accent-{100,200,600,700,800}` brand color used sparingly (primary actions, links,
  focus), and `success/warning/danger/info-{100,600,700}` kept visually distinct from the
  brand accent so status never gets confused with "this is the primary action."
- **Radii**: `--radius-sm/md/lg/xl` (0.375/0.625/1/1.5rem) — restrained, not
  generic-4px-everywhere or bubbly-rounded.
- **Shadows**: `--shadow-xs/sm/md/lg`, reserved for genuinely elevated surfaces (dialogs,
  dropdowns, toasts) — never decorative on a static card.
- **Spacing**: Tailwind's own default scale, used as-is — no parallel spacing system.
- **Light-only, deliberately**: `color-scheme: light` is explicit. A real dark theme is
  future work, not something half-implemented via `light dark` and OS preference.
- Motion (`index.css`, bottom section) is compositor-friendly (`opacity`/`transform` only)
  and fully gated behind `prefers-reduced-motion: no-preference`.

Component library (`src/components/ui/`): `Button` (+`buttonVariants` for real `<Link>`
anchors — never an anchor nested in a button or vice versa), `TextField`, `SelectField`,
`Alert`, `Spinner`, `EmptyState`, `ErrorState`, `Skeleton`, `Container`, `Badge`, `Card`,
`Table` (semantic markup, CSS-only scroll-shadow affordance, loading/empty/error row
states), `Navbar`/`AppNavLink`. `Tabs`, `Dialog`, `Drawer` (a `Dialog` styled to slide from
an edge), `DropdownMenu`, `Tooltip`, and `Toast` (+`useToast()`) are built on Radix
primitives (`@radix-ui/react-*`) rather than hand-rolled, for correct focus-trapping,
portal rendering, and ARIA — they're unstyled/"headless," so the visual language is still
entirely FadeUp's own tokens. Every LOT 3 page was retrofitted onto this system so the app
reads as one product rather than two visual languages. Verified: `typecheck`/`lint`/
`test`/`build` all pass, all pre-existing tests pass unmodified.

## Marketing site (`apps/web`, LOT 5)

Public routes `/`, `/features`, `/pricing` share `MarketingLayout`
(`src/routes/marketing-layout.tsx`: `MarketingHeader` + `Outlet` + `MarketingFooter`),
kept as a separate layout route from auth/`/app` so this nav/footer never leaks into
`/login`, `/signup`, `/invite/:token`, or anything authenticated. `MarketingHeader` has a
responsive mobile menu built from the design system's `Drawer`. `src/components/
marketing/product-previews.tsx` has illustrative UI mockups (booking, live queue,
walk-ins, Chair Mode, Barber Passport, customer timeline, memberships, multi-location,
analytics) built from real design-system components (`Card`/`Badge`/etc.) — not stock
imagery, and not screenshots of features that don't exist yet, since none of those are
built past auth/onboarding. Pricing describes an illustrative tier *structure* (Starter/
Growth/Multi-Location, grouped by location count and feature set) with explicit "early
access, not final pricing" framing — no invented dollar amounts presented as real,
committed pricing, and per `CLAUDE.md` §14: no fabricated testimonials, customer logos,
customer counts, or awards anywhere on the site.

### SEO — what's actually achieved, stated plainly

This is a client-rendered Vite SPA with **no SSR/prerendering**. That genuinely limits
what "SEO" can mean here:

- `src/lib/use-document-meta.ts` (`useDocumentMeta`) sets `document.title` and the meta
  description per route at runtime. This helps the visible browser tab/history entry and
  any crawler that executes JavaScript before indexing (Google generally does) — it does
  **not** help non-JS-executing crawlers or social-media link unfurlers (Slack, iMessage,
  X/Twitter, etc.), which fetch raw HTML and never run this code.
- `index.html` has static base `<title>`/description/Open Graph/Twitter-card tags — this
  is the only thing an unfurler or non-JS crawler will ever see, for every route, since
  there's no per-route server-rendered HTML. Domain in the OG `url` tag is a placeholder
  (RFC 2606 `.example`) pending a real production domain.
- `public/robots.txt` allows everything (nothing here needs blocking — `/app` is
  auth-gated regardless). `public/sitemap.xml` is **hand-written**, listing the five known
  public routes — it must become generated once dynamic public routes exist
  (per-organization public booking pages at `/s/{slug}`, a later lot), since a static file
  can't enumerate those.

Correct per-page Open Graph previews for social unfurling, and guaranteed indexing by
non-JS-executing crawlers, would require real SSR or prerendering — not implemented, and
not silently claimed to be.

## Organization admin: locations, team, chairs (`apps/web`, LOT 6)

Frontend on top of the LOT 6 database layer (`staff_profiles`, `barbers`, `chairs` — see
`docs/database.md`). All three pages read `organizationId`/`role` from `useCurrentOrg()`
(the caller's real membership, never a client-supplied value) and rely on RLS to enforce
write access server-side regardless of what the client sends — the frontend's
owner/manager gating is a UX convenience, not the security boundary.

- **`/app/locations`** (`pages/app-locations-page.tsx`, `lib/queries/locations.ts`): list +
  create/edit dialog (name, address, IANA timezone, active toggle). Any org member can
  read; create/edit requires owner/manager (matches `locations` RLS).
- **`/app/team`** (`pages/app-team-page.tsx`) now shows each member's real
  `staff_profiles.display_name` instead of the LOT 3 `Member <8 chars>` placeholder —
  `profiles` stays account-identity-only and is intentionally not org-readable (LOT 2
  design), so `staff_profiles` (org-scoped, auto-provisioned by a DB trigger on membership
  creation) is what makes rosters actually readable across a team. Owner/manager can edit a
  teammate's display name, title, bio, and primary location, and toggle "bookable barber"
  status per row. Toggling barber status is a **soft state change** (`barbers.is_bookable`
  flips, the row is never deleted) rather than a hard delete — documented in
  `lib/queries/barbers.ts`: later lots (service eligibility in LOT 7, commissions in LOT
  17) attach data to a barber row's `id`, so deleting it the moment someone comes off the
  schedule would orphan that state and lose history; this also matches the `is_active`-style
  soft-state convention already used by `locations`, `chairs`, and `staff_profiles`.
- **`/app/chairs`** (`pages/app-chairs-page.tsx`, `lib/queries/chairs.ts`): chair inventory
  grouped by location via tabs, create/edit dialog (name, active toggle). Structural
  inventory only — no occupancy/session state, that's a later lot.

New shared UI primitives: `components/ui/switch.tsx` (native checkbox styled as a track/
thumb, `role="switch"`, real keyboard/AT semantics), `components/ui/textarea.tsx` (same
label/hint/error contract as `TextField`). `lib/timezone.ts` centralizes the
`Intl.DateTimeFormat().resolvedOptions().timeZone` best-effort guess shared by onboarding
and the location form (previously duplicated).

Verified: `npm run typecheck`, `lint`, `test` (14 tests, including a new
`app-locations-page.test.tsx` covering loaded/error/empty states and role-based action
visibility), and `build` all pass.

## Service catalog + availability (`apps/web`, LOT 7)

Frontend on top of the LOT 7 database layer (`service_categories`, `services`,
`service_locations`, `barber_services`, `location_hours`, `barber_working_hours`,
`barber_availability_exceptions` — see `docs/database.md`). Same conventions as LOT 6:
`organizationId`/`role` from `useCurrentOrg()`, RLS is the actual write boundary, the
frontend's owner/manager gating is UX only.

- **`/app/services`** (`pages/app-services-page.tsx`): categories (name, display order,
  active toggle, create/edit/delete) and the service catalog (name, description, category,
  duration, buffer before/after, price, active toggle) in one page. Price is entered as a
  dollar amount (`priceDollars`, `z.coerce.number()`) and converted to/from
  `services.price_cents` right at the form boundary (`dollarsToCents`/
  `centsToDollarsInput` in `app-services-page.tsx`) — nothing below that boundary (query
  hooks, DB) ever handles a float dollar amount. Editing a service exposes Locations/
  Barbers tabs backed by `service_locations`/`barber_services` — explicit-join checklists
  (a `Switch` per row) that mutate immediately on toggle, matching the LOT 7 explicit-join
  philosophy (each assignment is its own real, auditable row, not a batched "save"). The
  services table shows a "N locations · N barbers eligible" subtitle per row so assignment
  state is visible without opening the dialog.
- **`/app/availability`** (`pages/app-availability-page.tsx`): a shared `WeeklyHoursTable`/
  `WeeklyHoursRow` (structurally identical for location hours and barber hours — only the
  closed/off label differs) renders one editable week (Sunday..Saturday, matching the DB's
  `day_of_week` convention) per selected location (tabs) or barber (a dropdown, since
  barber rosters scale higher than location counts). Each day upserts independently against
  the DB's own `(location_id, day_of_week)`/`(barber_id, day_of_week)` unique constraints
  (`useUpsertLocationHours`/`useUpsertBarberWorkingHours`), so there's no create-vs-update
  branching in the UI, and client-side `start < end` validation runs before the DB
  constraint would reject it. Below a selected barber's weekly table,
  `barber_availability_exceptions` (one-off time off or adjusted hours) is a simple
  upcoming list with add/remove — no `AlertDialog` component exists yet in the design
  system, so removal uses `window.confirm` rather than building new UI infrastructure for
  one delete action.

Verified: `npm run typecheck`, `lint`, `test` (18 tests), and `build` all pass.

## Staff scheduling (`apps/web`, LOT 8)

`/app/appointments` (`pages/app-appointments-page.tsx`, `lib/queries/appointments.ts`) —
a per-location, per-date schedule list on top of the LOT 8 database layer (`appointments`,
`get_available_slots`). Uses its own `MANAGING_ROLES = ['owner', 'manager', 'receptionist']`
— distinct from the `['owner', 'manager']` set used everywhere else in this app, because
`appointments` RLS also allows `receptionist` to write (front-of-house books the schedule).
Barbers get read-only access to the schedule here; self-service status updates from the
chair are LOT 11.

Booking a new appointment steps through service (filtered to what's actually offered at the
selected location via `service_locations`) → barber (filtered to who's actually eligible
via `barber_services`) → date → an open-slot grid from `get_available_slots` → customer
details, and is a plain `insert` (not an RPC — staff already pass through RLS as an
authenticated org member, unlike LOT 9's anon-facing `book_public_appointment`), created as
`status: 'confirmed'` since it's staff-initiated, not a public request. `bufferBeforeMinutes`/
`bufferAfterMinutes` are snapshotted from the selected service at submit time, matching the
DB's own snapshot design. A concurrent double-booking (the LOT 8 GiST exclusion constraint
firing) is caught and shown as "That time was just booked by someone else — pick another
slot," not a raw Postgres error string. Status changes (confirm/complete/cancel/no-show) use
a `DropdownMenu`, hidden entirely for non-managing viewers (including barbers, in this lot).

Verified: `npm run typecheck`, `lint`, `test`, and `build` all pass.

## Public booking (`apps/web`, LOT 9)

A fully anonymous, unauthenticated flow at `/s/:slug` (`routes/public-booking-layout.tsx`,
`pages/public-booking-page.tsx`, `lib/queries/public-booking.ts`) on top of the LOT 9
anon-callable RPCs — deliberately its own minimal layout, not `MarketingLayout` or
`AppLayout`/`RequireAuth`: a customer lands here from a shared link to complete one focused
task. Every read/write goes through `supabase.rpc(...)`, never `.from(...)` — there is no
anon RLS access to `organizations`/`locations`/`services`/`barbers`/`appointments` at all,
so these RPCs are the *only* client-side surface for this page.

A step wizard (location → service → barber → date/time → details → confirm) biases toward
fewer taps: a single-location shop skips the location step entirely, and a service with
exactly one eligible barber skips the barber step — both verified directly. Since a public
booking creates a `status = 'pending'` request (not an instant confirmation — see the LOT 9
database docs), the copy says so explicitly throughout ("Request appointment," "Your
appointment request has been sent — they'll confirm it shortly") rather than implying an
instant "Booking confirmed." `friendlyBookingError()` pattern-matches the RPC's raw Postgres
error messages (including the GiST exclusion-constraint race message) into user-facing copy,
falling back to the raw message for anything unrecognized rather than silently swallowing an
error. A barber's `avatar_url` fails gracefully to an initials circle, never a broken-image
icon. Zero fabricated content anywhere — every screen renders real data from the RPCs or an
honest loading/empty/error state, per `CLAUDE.md`.

Verified: `npm run typecheck`, `lint`, `test`, and `build` all pass, **and** independently
over real HTTP against the live Kong/PostgREST gateway using the actual anon key (not just
through the Postgres test scripts, which exercise a different code path than PostgREST's own
JSON serialization and RPC grant-checking layer) — `get_public_organization`,
`list_public_locations`, and `list_public_services` all returned correctly shaped JSON for a
real seeded shop, while a direct `GET /rest/v1/organizations?slug=eq....` for the same shop
returned `[]` (RLS blocking anon table access exactly as designed). Fixture cleaned up
afterward.

## Live queue (`apps/web`, LOT 10)

`/app/queue` (`pages/app-queue-page.tsx`, `lib/queries/queue.ts`) — a per-location live
walk-in board on top of the LOT 10 database layer (`queue_entries`). `useOrgQueue` is the
first use of Supabase Realtime Postgres Changes in this codebase: it subscribes to a
`postgres_changes` channel filtered to `organization_id=eq.<org>` on `queue_entries` and
invalidates the TanStack Query cache on any insert/update/delete, so the board updates live
with no polling or manual refresh — cleaned up via `removeChannel` on unmount. The
`organization_id` filter is purely to avoid re-fetching on every other org's events; RLS
(not this filter) is what actually makes the subscription tenant-safe, since Realtime is
RLS-aware for authenticated subscribers.

Position in line is never trusted from the server as a stored value — it's derived
client-side the same way `get_public_queue_status` derives it in the database: arrival
order (`created_at`) among `status: 'waiting'` entries only. Since LOT 11 phase 1's
self-service DB layer, a barber-role viewer sees status-update controls on entries where
they are the assigned `barber_id` (`isOwnBarber`, resolved via their own `staff_profiles`
row → `barbers` row), in addition to the existing full control for
owner/manager/receptionist — the server-side trigger is what actually restricts which
columns a barber's update can touch, this UI only decides whether to show the control at
all.

As part of this same self-service change, `/app/appointments` (LOT 8) was loosened to
match: a barber-role viewer now sees status-update controls on their own assigned
appointments too (previously read-only for any barber), via the identical `isOwnBarber`
pattern threaded down to `AppointmentRow`.

Verified: `npm run typecheck`, `lint`, `test` (including a barber-role fixture that owns
one entry and not another, asserting status controls show only on the owned row), and
`build` all pass.

## Chair Mode phase 1: kiosk check-in + TV display (`apps/web`, LOT 11 phase 1)

Two more anon-facing surfaces nested under the existing `/s/:slug` route, on top of the LOT
11 `join_public_queue`/`get_public_queue_status` RPCs (`lib/queries/public-queue.ts`):

- **`/s/:slug/walk-in`** (`pages/public-walkin-page.tsx`) — a shared physical kiosk's
  check-in form: name (required) + phone (optional), auto-skipping the location step for a
  single-location shop exactly like public booking (LOT 9). Deliberately a single short
  form, not a wizard — a walk-in should be fast. The success screen offers "Check in
  another customer," not just a static confirmation, because the device stays mounted and
  serves a stream of different customers, not one person finishing a personal flow.
- **`/s/:slug/display`** (`pages/public-queue-display-page.tsx`) — an unattended TV/kiosk
  board: full-bleed dark surface, oversized type, zero interactive controls (nothing here
  assumes anyone is holding the device). "Now serving" (`called`/`in_service`) and "Up
  next" (`waiting`, ordered by the RPC's derived `queue_position`) sections. Polls via
  `refetchInterval` (6s) rather than subscribing to Realtime — Realtime is RLS-aware and
  does **not** deliver events to `anon` subscribers, so a polling fallback is required for
  any anon-facing display, unlike the authenticated `/app/queue` board above. The location
  is resolved from a `?location=` query param (falling back to the shop's first location),
  since a mounted TV/kiosk is permanently associated with one location rather than letting
  a customer pick.

Both routes render inside the existing minimal `PublicBookingLayout` rather than a new
chromeless layout — its header is small enough not to compete with the TV display, and a
second public layout for one route wasn't worth the added routing surface for this first
pass.

Verified: `npm run typecheck`, `lint`, `test`, and `build` all pass.

## Customer CRM + Barber Passport (`apps/web`, LOT 12)

`/app/customers` (`pages/app-customers-page.tsx`, `lib/queries/customers.ts`) — a searchable
directory over the LOT 12 `customers` table. Search is a client-side filter over the full
org list (name/phone/email substring match), not a server query — a deliberate trade-off
given shops run in the hundreds to low thousands of customers, not a scale where that
matters. Any org member can view; `owner`/`manager`/`receptionist` can add/edit, matching
`customers` RLS exactly. A customer's detail dialog shows their recent appointment history
(`useCustomerAppointments`, capped at 25 rows, most recent first) — proof that the LOT 12
auto-link trigger is actually wiring bookings back to a real customer record, not just
storing one. A raw duplicate phone/email save is caught (the `customers_org_*_unique`
partial indexes) and shown as friendly copy ("Another customer already has this phone
number"), same pattern as `isBookingConflictError` in `app-appointments-page.tsx`.

**Barber Passport**: a shareable public profile at `/s/:slug/barbers/:barberId`
(`pages/public-barber-page.tsx`, `lib/queries/public-barber.ts`), on top of the new
`get_public_barber`/`list_public_barber_services` RPCs. This surfaced two `staff_profiles`
fields that existed since LOT 6 but had no UI: `avatar_url` and `is_public` are now editable
on `/app/team`'s existing edit-profile dialog (`isPublic` defaults to `true` — a shop opts a
barber *out* of public visibility, not in). The profile page shows only real data: name,
title, bio, photo (falling back to an initials circle, same graceful-degradation pattern as
`BarberAvatar` in public booking), and the barber's actual active services — never a
fabricated "specialties" list, rating, or review count, per `CLAUDE.md`. "Book with
[name]" links to the shop's general `/s/:slug` booking flow rather than deep-linking a
pre-selected barber (documented simplification — the booking wizard has no pre-selection
param yet).

Verified: `npm run typecheck`, `lint`, `test` (42 tests total, including a barber-role
read-only detail-view case for customers, and both a public and a private/unknown barber
case for the Passport page), and `build` all pass.

## Not yet built

Beyond the design system, marketing site, auth/onboarding, organization admin, and the
service/availability catalog, staff scheduling, public booking, live queue, chair mode phase
1 (kiosk check-in + TV display), customer CRM, and Barber Passport are now built (LOT 8–12).
Still pending: a real chair-occupancy state machine, barber "claiming" an unassigned queue
entry, deep-linking a pre-selected barber into the public booking wizard, and LOT 13 onward.
See the project task list / roadmap for what's next.
