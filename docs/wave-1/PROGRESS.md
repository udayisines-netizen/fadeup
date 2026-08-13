# Wave 1 — Progress (persistent handoff)

Read this + CLAUDE.md + docs/wave-1/PLAN.md + `git status` + `git log` first if context was compacted.

## Completed phases
- Phase 0 — Audit. Findings captured in PLAN.md section 1. No code changes yet.

## Current phase
Phase 1 — Marketplace data boundary + search. Not yet started.

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
