# Wave 1 — Progress (persistent handoff)

Read this + CLAUDE.md + docs/wave-1/PLAN.md + `git status` + `git log` first if context was compacted.

## Completed phases
- Phase 0 — Audit. Findings captured in PLAN.md section 1.
- Phase 1 — Marketplace data boundary + search. Commit `2505af4`. `search_public_professionals` RPC (barbers as first-class results, service-name filter, server-side open-now, shop/barber union with `entity_type`). `verify_wave1_marketplace_boundary.sql` proves prospect non-leakage + unpublished-org invisibility + per-barber `is_public` gating, run live against `fadeup-supabase-db`, all assertions PASS, fixtures cleaned (0/0/0 remaining). Frontend: `ProfessionalResultCard` replaces `MarketplaceResultCard` (deleted), `useSearchPublicProfessionals` replaces `useSearchPublicOrganizations` in the search page (old hook/RPC left in place, unused by frontend, for any other caller). i18n: 8 new keys × 10 locales. `npm run typecheck`/`lint`/`test` all clean (60/60 tests, only the 9 pre-existing unrelated lint warnings).

- Phase 2 — Public barber + shop profiles. New `list_public_organization_barbers` RPC (team roster, was genuinely missing — no way to list every public barber for an org existed before) + `get_public_barber` extended with `location_id` (DROP+CREATE, return-shape change). New `ShopProfilePage` at `/s/:slug/profile` (identity, real locations, team grid linking to each barber). Marketplace cards and the Barber Passport page now link "View profile" vs "Book" as distinct actions (previously the card's "View profile" label wrongly linked straight into the booking wizard). Booking wizard (`public-booking-page.tsx`) now reads `?barber=&location=` and preselects them (skips location step; auto-applies the barber once the customer reaches a service that barber offers) — best-effort by design, not a restructure of the existing location→service→barber step order. Live-verified both new/changed RPCs against real seed data (`demo-le-fade-parisien`). `npm run typecheck`/`lint`/`test`/`build` all clean (65/65 tests). Documented, deliberate non-i18n: this whole `/s/:slug/*` subtree (booking wizard, Barber Passport, new Shop Profile) stays plain-English, matching the pre-existing LOT 9/12 convention — retrofitting it is a separate, larger undertaking out of Wave 1 scope.

## Current phase
Phase 3 — Customer account + onboarding. Starting now. This is the highest-risk phase (new canonical customer identity table + bridge to existing `customers` CRM rows) — see PLAN.md section 4, decision 1.

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
