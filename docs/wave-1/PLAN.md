# Wave 1 — Customer-Facing FadeUp — Implementation Plan

## 1. Repository findings (Phase 0 audit)

### Customer / booking model
- `public.customers` (`20260809180000_customers.sql`): shop-owned CRM row — `organization_id, name, phone, email, notes, ...`. RLS: any org member SELECT, owner/manager/receptionist write. **No `auth.users` link.**
- Separate, unlinked auth flow: `/customer/signup`, `/customer/login` create real `auth.users` accounts landing at `/app/customer` (`app-customer-page.tsx`), which explicitly says "FadeUp does not yet link a customer's account to their bookings." **This is the core Wave 1 gap.**
- `public.appointments` (`20260809140000_appointments.sql`): full booking engine with GiST exclusion constraints preventing double-booking, `status enum (pending, confirmed, completed, cancelled, no_show)`, `customer_id` FK (auto-linked by `link_customer_from_contact_info()` trigger matching phone→email). Public booking via `book_public_appointment` RPC (anon+authenticated, SECURITY DEFINER, re-validates everything server-side). Authenticated availability via `get_available_slots`.
- `public.queue_entries`: walk-in queue, `join_public_queue`/`get_public_queue_status` RPCs (anon+authenticated), realtime-enabled. Position derived from `created_at`, not stored. No `locations.walk_in_enabled` flag exists — walk-in availability is implicit (a location either has an active queue or it doesn't; nothing to gate a filter on beyond "does this location have any recent queue activity," which isn't a real capability flag). **Decision: no fabricated "walk-ins available" filter; Join Queue CTA appears only when a real queue exists for that location, consistent with "never display a filter that cannot affect results."**
- "Barber Passport" (LOT 12) is **not a customer-owned passport** — it's just `get_public_barber`/`list_public_barber_services`, a public read view over `staff_profiles`/`services`. No notes field, no separation problem there. This confirms Fade Passport is wholly new, not a rename of an existing table.
- No favorites/rebook functionality exists anywhere.

### Marketplace / acquisition boundary
- `search_public_organizations` (`20260811160000_marketplace_discovery.sql`): anon SECURITY DEFINER RPC, gated by `organizations.marketplace_visible` (explicit opt-in, default false). Org+location only — **no individual barbers in search results**, no service filter, "open now" filtered client-side only.
- `prospects` (Worker V2) is **structurally sealed off already**: the only link to `organizations` is a nullable one-way `prospects.converted_organization_id`. `prospects` has no `organization_id`/`marketplace_visible`/`slug` column; all `prospect_*` RLS is platform-staff/`prospect_worker`-only, zero anon grant. `search_public_organizations` never references `prospects`. **Leakage is already structurally impossible — Wave 1 adds a regression test proving it, not a new boundary.**
- Per-barber public page already exists at `/s/:slug/barbers/:barberId` (`public_barber_profile` migration + `public-barber-page.tsx`) but is nested under a known org slug — not independently searchable/discoverable, and not restyled for the marketplace pass.
- Route trees are disconnected today: marketplace (`/`, `/search`) under `MarketingLayout`; per-org booking (`/s/:slug/*`) under `PublicBookingLayout`. Wave 1 links them (search result → shop/barber profile → booking).

### RLS / storage
- Standard pattern: `enable + force row level security`, `private.is_org_member()` / `private.has_org_role()` / `private.is_platform_admin()` SECURITY DEFINER helpers (schema `private`, never PostgREST-exposed), always wrapped `(select private.fn(...))`.
- **No Supabase Storage bucket exists anywhere in this codebase.** `staff_profiles.avatar_url` is a plain pasted URL, no upload flow. Passport photos will be the first real Storage usage — built from scratch per the `supabase`/`rls-security` skill conventions (private bucket + `storage.objects` RLS keyed on `(storage.foldername(name))[1] = auth.uid()::text`).
- `pgcrypto` already enabled and already used for `sha256` token hashing (`platform_owner_bootstrap_tokens`, `platform_invitations` — `encode(extensions.digest(token,'sha256'),'hex')`, zero plaintext, zero client SELECT). **Reused verbatim for Passport share tokens.**
- Reusable authorization template: `RequirePlatformRole` / `usePlatformRole()` (`require-platform-role.tsx`) — Wave 1's customer-side equivalent is a new `RequireCustomer` / `useCustomerProfile()`.
- `db/tests/verify_*.sql` convention confirmed and will be followed exactly (see below).

### Design / i18n
- 24 reusable UI primitives in `components/ui/*` (Button, Card, Badge, Dialog, Drawer, EmptyState, ErrorState, Skeleton, Spinner, Switch, Tabs, TextField, Toast, Tooltip, etc.) — no new primitives needed, Wave 1 composes existing ones.
- Design tokens (Tailwind v4 `@theme` in `index.css`): ink/paper/accent(emerald)/success/warning/danger/info scales, dark mode via `[data-theme]`, already matches CLAUDE.md's emerald/forest/ivory direction.
- i18n: 10 locales confirmed (`en fr es de it pt ar zh-CN ja ru`), namespace-per-locale-folder, only `common`+`marketplace` exist today. RTL already globally handled via `isRtl()`/`dir` attribute — no new RTL work needed, just correctly-flowing layouts.
- Layout shells: `MarketingLayout`, `PlatformLayout`, `AppLayout` all follow `Navbar{brand,links,actions}` + `AppNavLink` + `ThemeToggle`/`LanguageSwitcher`. New `CustomerAppLayout` follows the same shape, replacing the `app-customer-page.tsx` stub.
- Testing: Vitest + jsdom, real i18next in tests (no mock provider), `MemoryRouter` + mocked `useNavigate` pattern.

## 2. Existing functionality reused as-is
Appointment engine (GiST exclusion, status machine, no-show rule), public booking RPCs, availability RPC, queue_entries + public queue RPCs + Realtime, `search_public_organizations` (extended, not replaced), `get_public_barber`/`list_public_barber_services`, all 24 UI primitives, i18n/RTL infra, `private.is_org_member`/`has_org_role` pattern, pgcrypto sha256-hash pattern, `db/tests/verify_*.sql` fixture convention, `MarketingLayout`/`PublicBookingLayout` route trees (extended with cross-links).

## 3. Missing functionality to build
1. **Customer identity bridge** — the load-bearing fix. `public.customer_profiles` (1:1 with `auth.users`, canonical portable customer identity: display name, phone, locale, onboarding answers) + `customers.user_id` bridging column (per-org CRM contact optionally linked to an auth identity) + auto-link-on-booking logic.
2. Marketplace: individual barbers as first-class search results (union shops+barbers, tagged `entity_type`), service-name filter, server-side open-now filter, price-range filter.
3. Public Shop Profile page (team roster → barber drill-down → service → book), reusing `get_public_organization`/`list_public_locations`/`list_public_barbers`/`list_public_services`.
4. Public Barber Profile restyle/completion — favorite button, booking CTA preselecting barber, queue CTA when real.
5. Customer onboarding (3 questions) writing to `customer_profiles`.
6. Customer App: `CustomerAppLayout`, contextual home, Appointments (upcoming/past, cancel where policy allows), Favorites, Rebook.
7. `customer_favorites` table + RLS + UI.
8. Fade Passport: `customer_passports`, `customer_passport_photos` (+ Storage bucket), `customer_passport_shares` (hashed token), share-viewer public route, QR generation (new minimal dependency: `qrcode`).
9. Centralized, tested date-math module for "days since last cut vs. preferred interval" (no LLM, deterministic).
10. RLS/regression tests proving: prospect non-leakage, cross-customer isolation, passport share scoping/expiry/revocation, favorites ownership.

## 4. Data changes required (new migrations, in order)
1. `20260813100000_customer_identity.sql` — `customer_profiles` table (RLS: owner-only via `user_id = (select auth.uid())`), `customers.user_id` nullable FK + partial unique `(organization_id, user_id)`, `private.get_or_create_customer_profile()` helper, RPC `public.upsert_customer_onboarding(...)`.
2. `20260813100100_customer_appointments_access.sql` — `private.current_customer_org_ids(...)`-style curated RPCs: `public.get_my_appointments()`, `public.get_my_queue_status()`, `public.cancel_my_appointment(id)` (reuses existing cancellation semantics, does not invent new rules). No broad RLS opened on `appointments`/`customers`/`barbers`/`services` for the `authenticated` role — narrow RPCs only, consistent with the codebase's established philosophy.
3. `20260813100200_customer_favorites.sql` — `customer_favorites(user_id, organization_id, barber_id nullable)`, direct owner-only RLS (safe: only opaque public ids), `public.get_my_favorites()` curated RPC for display.
4. `20260813100300_marketplace_professionals.sql` — `search_public_professionals` RPC unioning shop+barber rows with `entity_type`, service-name filter, server-side open-now, price range; keeps `search_public_organizations` for backward compat / shop-only use.
5. `20260813100400_fade_passport.sql` — `customer_passports`, `customer_passport_photos`, `customer_passport_shares` (`token_hash`, `expires_at`, `revoked_at`), owner-only RLS on all three, RPCs `public.upsert_my_passport`, `public.create_passport_share`, `public.revoke_passport_share`, `public.get_shared_passport(token)` (SECURITY DEFINER, sha256-verifies, checks expiry/revocation, returns curated fields only — never phone/email/notes, never internal shop data since none exists in these tables by construction).
6. Storage: `passport-photos` bucket (private) + `storage.objects` policies scoped to `auth.uid()` folder prefix, created via a migration executing `storage.buckets`/policy inserts (mirrors the "no manual production edits" rule).

All migrations idempotent (`if not exists` guards), forward-only, following the existing file naming/timestamp convention.

## 5. Frontend changes required
- `apps/web/src/components/marketplace/*`: `professional-result-card.tsx` (shop/barber-aware), extend `search-form.tsx` with service/price/open-now filters.
- `apps/web/src/pages/shop-profile-page.tsx`, `barber-profile-page.tsx` (promoted/restyled from `public-barber-page.tsx`), wired at both `/s/:slug` (existing) and new marketplace-facing routes.
- `apps/web/src/routes/customer-app-layout.tsx` replacing the `app-customer-page.tsx` stub; children: home, appointments, favorites, passport, profile/onboarding.
- `apps/web/src/pages/customer-onboarding-page.tsx` (3-question flow, skippable).
- `apps/web/src/lib/personalization.ts` — centralized deterministic date-math (days-since-last-cut vs preferred interval), unit-tested.
- `apps/web/src/pages/passport-share-view-page.tsx` — public unauthenticated route `/passport/shared/:token`.
- New i18n namespaces: `customer-app`, `passport`, `onboarding` (all 10 locales, wired into `i18n/index.ts` per the documented 4-step process).

## 6. Security / RLS changes required
- `customer_profiles`, `customer_favorites`, `customer_passports`, `customer_passport_photos`, `customer_passport_shares`: strict owner-only (`user_id = (select auth.uid())`), zero anon access.
- `customers.notes` (internal shop notes) is never selected by any customer-facing RPC — enforced structurally (RPCs list explicit columns, never `select *`), verified by a dedicated SQL test.
- Passport share verification is entirely inside one SECURITY DEFINER RPC hashing the incoming token — no table holding `customer_passport_shares` is ever anon-readable directly.
- Storage `passport-photos` bucket: private, per-user-folder RLS, MIME/size validated both client-side (UX) and — since Postgres can't inspect file bytes — via a `storage.objects` insert-time check on `metadata->>'mimetype'` restricted to `image/jpeg|image/png|image/webp` and a reasonable size cap.
- New `db/tests/verify_wave1_marketplace_boundary.sql`, `verify_wave1_customer_identity.sql`, `verify_wave1_favorites.sql`, `verify_wave1_passport.sql` following the exact existing fixture/impersonation convention.

## 7. Test strategy
- SQL: `db/tests/verify_*.sql` (psql, `set local role authenticated` + `request.jwt.claims` impersonation) for every RLS/RPC boundary in section 6, run against the live `fadeup-supabase-db` container.
- Frontend: Vitest + Testing Library for new pages/components (loading/empty/error/success), following the existing `MemoryRouter` + mocked-`useNavigate` pattern; unit tests for `personalization.ts` date math (pure functions, no React).
- Build quality: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` in `apps/web` (exact scripts confirmed from `package.json` — no invented commands).
- Manual/live verification: exercise real RPCs via `docker exec ... psql` against the running Supabase stack for anything a unit test can't reach (Storage policies, cross-connection concurrency N/A here).

## 8. Implementation phases
0. Audit (this document) — **done**.
1. Marketplace data boundary + search (barber-first-class results, filters, prospect non-leakage test).
2. Public Barber + Shop profiles (booking handoff, mobile-barber privacy).
3. Customer identity bridge + onboarding.
4. Customer App (home, appointments, favorites, rebook, queue consumption).
5. Fade Passport (CRUD, photos/Storage, sharing/QR).
6. Full integration pass (cross-flow wiring, i18n completeness, responsive/accessibility polish).
7. Adversarial review (fresh subagent) + fixes.

## 9. Explicit out-of-scope (Wave 2 handoff)
Deep Live Queue engine/ETA/Chair Mode/reception UI, Barber App, Owner Live Floor redesign, Worker V2 changes, Planity Detector, payments/commissions/memberships depth, native apps/push, per-minute rate limiting (already a documented Worker V2 gap), photo signed-URL delivery for **shared** (unauthenticated) Passport viewers — V1 sharing exposes structured preference text only, not photo files, because issuing anon-scoped signed Storage URLs safely needs either an edge function (not present in this infra) or a broader anon storage policy (rejected as unsafe); documented here as a deliberate, disclosed scope cut, not an oversight.
