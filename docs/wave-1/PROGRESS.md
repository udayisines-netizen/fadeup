# Wave 1 — Progress (persistent handoff)

Read this + CLAUDE.md + docs/wave-1/PLAN.md + `git status` + `git log` first if context was compacted.

## Completed phases
- Phase 0 — Audit. Findings captured in PLAN.md section 1.
- Phase 1 — Marketplace data boundary + search. Commit `2505af4`. `search_public_professionals` RPC (barbers as first-class results, service-name filter, server-side open-now, shop/barber union with `entity_type`). `verify_wave1_marketplace_boundary.sql` proves prospect non-leakage + unpublished-org invisibility + per-barber `is_public` gating, run live against `fadeup-supabase-db`, all assertions PASS, fixtures cleaned (0/0/0 remaining). Frontend: `ProfessionalResultCard` replaces `MarketplaceResultCard` (deleted), `useSearchPublicProfessionals` replaces `useSearchPublicOrganizations` in the search page (old hook/RPC left in place, unused by frontend, for any other caller). i18n: 8 new keys × 10 locales. `npm run typecheck`/`lint`/`test` all clean (60/60 tests, only the 9 pre-existing unrelated lint warnings).

- Phase 2 — Public barber + shop profiles. New `list_public_organization_barbers` RPC (team roster, was genuinely missing — no way to list every public barber for an org existed before) + `get_public_barber` extended with `location_id` (DROP+CREATE, return-shape change). New `ShopProfilePage` at `/s/:slug/profile` (identity, real locations, team grid linking to each barber). Marketplace cards and the Barber Passport page now link "View profile" vs "Book" as distinct actions (previously the card's "View profile" label wrongly linked straight into the booking wizard). Booking wizard (`public-booking-page.tsx`) now reads `?barber=&location=` and preselects them (skips location step; auto-applies the barber once the customer reaches a service that barber offers) — best-effort by design, not a restructure of the existing location→service→barber step order. Live-verified both new/changed RPCs against real seed data (`demo-le-fade-parisien`). `npm run typecheck`/`lint`/`test`/`build` all clean (65/65 tests). Documented, deliberate non-i18n: this whole `/s/:slug/*` subtree (booking wizard, Barber Passport, new Shop Profile) stays plain-English, matching the pre-existing LOT 9/12 convention — retrofitting it is a separate, larger undertaking out of Wave 1 scope.

- Phase 3 — Customer account + onboarding. `customer_profiles` (1:1 auth.users, owner-only RLS) + `customers.user_id` bridge + `claim_customer_records(phone, email)` RPC (retroactively links past anonymous bookings to a real account, phone-then-email, never steals an already-linked row, idempotent). `verify_wave1_customer_identity.sql` live-verified: claim links correctly, re-claim is a no-op, Customer B cannot steal Customer A's link, Customer B cannot read/update Customer A's `customer_profiles` row, anon has zero access to `customer_profiles`/`customers`/the RPC — all PASS, fixtures cleaned (0/0/0). Frontend: `/app/customer` rebuilt as a real `CustomerAppLayout` (bottom tab bar, not the staff top-nav — deliberately different chrome) replacing the old honest-stub `AppCustomerPage` (removed); `CustomerHomePage` (onboarding nudge or welcome + Discover CTA — intentionally minimal, no fabricated appointment/queue awareness until Phase 4 wires real data), `CustomerOnboardingPage` (3 chip-select questions, skippable, doubles as the "edit habits" screen), `CustomerProfilePage` (edit name/phone/email, habit badges, sign out). Booking wizard and the profile-save flow both call `claim_customer_records` best-effort after providing contact info. New `customer-app` i18n namespace × 10 locales; `i18n/index.ts` refactored to a `NAMESPACES` list so adding Phase 5's `passport` namespace is a one-line change. `npm run typecheck`/`lint`/`test`/`build` all clean (75/75 tests, 15 new).

- Phase 4 — Customer app (home, appointments, favorites, rebook). New RPCs `get_my_appointments`, `cancel_my_appointment` (reuses the existing pending/confirmed status machine, no new cancellation rule), `get_my_queue_status` (accurate position computed over the full location line, then filtered to the caller's own row — never exposes other customers), `get_my_favorites`; new `customer_favorites` table (owner-only direct RLS — safe, holds only opaque public org/barber ids). `verify_wave1_customer_app.sql` live-verified: cross-customer isolation on appointments/queue/favorites, cancel only own pending/confirmed, favorites uniqueness (shop and barber both), anon zero access — all PASS, fixtures cleaned. **Real bug found while writing this test**: psql's `:'var'` substitution never reaches inside `do $$ ... $$` bodies (dollar-quoted spans are opaque to it) — worked around via `set_config`/`current_setting` runtime bridging; noted here since it'll bite the next SQL test file that follows this repo's do-block convention with a `\gset` variable.

  Frontend: `CustomerHomePage` rewritten with the real priority stack (active queue > upcoming appointment > rebook-with-freshness > discover), backed by a new centralized `lib/personalization.ts` (`computeFreshness`, pure/tested, no LLM — never fabricates a freshness fact when there's no completed appointment or the customer answered "depends"). `CustomerAppointmentsPage` (upcoming/past tabs, cancel with a confirm dialog, rebook links preselecting barber+service). `CustomerFavoritesPage`. New shared `FavoriteButton` (signed-out → login link with redirect; signed-in → toggle) wired into marketplace cards, Shop Profile, and Barber Passport. Booking wizard now also accepts `?service=` preselection (rebook). Nav gained an "Appointments" tab; Favorites lives inside Profile (deliberately no 5th tab yet — Queue has no persistent tab either, it's contextual on Home).

  Real jsdom/Radix gotcha found while testing: Radix's `Tabs.Trigger` activates on `mousedown`, not `click` — `fireEvent.click` alone never switches tabs in jsdom (no synthesized mousedown), so tab-interaction tests must use `fireEvent.mouseDown`.

  `npm run typecheck`/`lint`/`test`/`build` all clean (93/93 tests, 28 new).

## Current phase
Phase 5 — Fade Passport. Starting now. New tables (`customer_passports`, `customer_passport_photos`, `customer_passport_shares`), first real Supabase Storage bucket in this codebase (`passport-photos`, private, per-user-folder RLS), sha256-hashed share tokens (same pattern as `platform_invitations`), QR code generation (new minimal dependency: `qrcode`). Passport photo delivery through an unauthenticated share link is deliberately out of V1 scope — see PLAN.md section 9.

## Important architectural decisions (see PLAN.md for full rationale)
- Customer identity: new `customer_profiles` (1:1 auth.users, portable) is the canonical customer identity; per-org `customers` CRM rows get an optional `user_id` bridge. Do NOT merge these into one table — org-owned CRM contacts (walk-ins, no login) must keep existing.
- All customer-app reads/writes go through narrowly-scoped SECURITY DEFINER RPCs (`get_my_appointments`, `get_my_favorites`, `upsert_my_passport`, etc.), mirroring the existing public-booking RPC philosophy — NOT broad new RLS SELECT policies on internal shop tables (`customers.notes` must never be selectable by a customer).
- Passport share tokens: sha256-hashed (`extensions.digest`), same pattern as `platform_invitations`. Never store/return plaintext after creation-time response.
- Passport photo sharing via unauthenticated share link is OUT of V1 scope (structured text only) — no edge-function infra exists to safely issue anon-scoped signed Storage URLs. Documented as deliberate cut.
- No fabricated "walk-in available" marketplace filter — no real capability flag exists (`locations` has no such column); Join Queue CTA only shown when real queue data supports it.
- New dependency: `qrcode` (small, justified — no QR capability exists, feature explicitly required).

## Migrations created
(none yet — planned list in PLAN.md section 4)

## Files substantially modified
(none yet)

## Tests run and results
(none yet)

## Remaining blockers
None — all decisions resolvable from spec + existing code. No credentials required for Phase 1-2 (marketplace/profiles use existing anon RPCs pattern). Passport photo Storage (Phase 5) needs no new external credential either (self-hosted Supabase Storage already running per docker-compose).

## Next exact action
Start Phase 1: write migration `20260813100300_marketplace_professionals.sql` (barber-first-class search), then extend frontend search UI, then write `db/tests/verify_wave1_marketplace_boundary.sql` proving prospect non-leakage.
