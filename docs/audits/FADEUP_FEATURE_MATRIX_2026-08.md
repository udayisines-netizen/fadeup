# FadeUp — Feature Matrix

**Date:** 2026-08-17 (revised with live-database evidence) · **Commit:** `fa87b18`
**Companion to:** `FADEUP_FULL_AUDIT_2026-08.md`

## Legend

**STATUS:** `VERIFIED_COMPLETE` · `IMPLEMENTED_UNVERIFIED` · `PARTIAL` · `FRONTEND_ONLY` · `BACKEND_ONLY` · `BROKEN` · `MISSING` · `FUTURE`

**RUNTIME VERIFIED** = `YES` only where I executed something against the live system this audit: the DB verification scripts (100 assertions), the e2e script (49 assertions), the anonymous API penetration test, or a live RPC call. `NO` everywhere else. **Browser runtime evidence does not exist for any row** — there is no E2E suite.

**Live DB facts underpinning this table:** PostgreSQL 17.6 · 54 tables · **54/54 RLS + FORCE RLS** · 166 policies · 182 indexes · 70 SECURITY DEFINER functions with 0 missing `search_path` · zero migration drift · `services=0`, `appointments=0`, `queue_entries=0`, `customers=0`, `storage.objects=0`.

---

## Customer — Discovery & Marketplace

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Marketplace search | `/search` | `marketplace-search-page` | `organizations`,`locations`,`barbers` | ✅ live | `search_public_professionals` | — | ✅ unit + `verify_wave1_marketplace_boundary` (3 PASS) | **YES** — anon RPC HTTP 200, real org "7 VIE LA" | **VERIFIED_COMPLETE** | — | No fabricated fields |
| Consumer landing real data | `/` | `consumer-landing-page` | same | ✅ live | same RPC | — | ✅ unit | **YES** — same call | **VERIFIED_COMPLETE** | — | Rebuilt `ba3e064`; fixtures removed `d6c5f7d` |
| City matching | `/search` | search form | — | ✅ | `search_public_professionals` | — | ⚠️ indirect | NO | IMPLEMENTED_UNVERIFIED | — | `20260814000000_marketplace_city_matching` |
| Barber public profile | `/s/:slug/barbers/:id` | `public-barber-page` | `barbers`,`staff_profiles` | ✅ live | `get_public_barber`,`list_public_barber_services` | — | ✅ unit + `verify_public_barber_profile` | NO | IMPLEMENTED_UNVERIFIED | B-08 EN-only | |
| Shop public profile | `/s/:slug/profile` | `shop-profile-page` | `organizations`,`locations` | ✅ live | `get_public_organization` | — | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | EN-only | |
| Marketplace publication boundary | — | — | `set_organization_marketplace_visible` | ✅ live | ✅ | — | ✅ 3 PASS | **YES** | **VERIFIED_COMPLETE** | — | |
| Barber/shop imagery | marketplace | `barberAvatarUrl` field | — | — | — | — | ❌ | **YES** — `storage.objects=0`, 1 bucket only | **MISSING** | B-24 | No bucket, no upload path |
| Map / geo browse | `/search` | — | — | — | — | — | ❌ | NO | **MISSING** | — | `maplibre-gl` is Platform-only |

## Customer — Booking & Queue

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Public booking** | `/s/:slug` | `public-booking-page` | `appointments` | ✅ live | `get_public_available_slots`,`book_public_appointment` | ❌ | ✅ unit + `verify_public_booking` (no assertions) | **YES** — **`services=0`, `appointments=0`** | **BROKEN** | **B-04 nothing bookable** | Code correct; no shop has a service |
| Availability slots | booking | — | `barber_working_hours`,`location_hours`,`…exceptions` | ✅ live | `get_available_slots` | — | ✅ `verify_services_availability` (report only) | NO | IMPLEMENTED_UNVERIFIED | B-27 no date lib | |
| **Booking confirmation email** | — | — | `email_outbox` | ✅ live | — | — | ❌ | **YES** — no template exists | **MISSING** | **B-05** | Outbox+dispatcher exist and work |
| Appointment claim (guest→account) | post-booking | — | `appointment_claim_tokens` | ✅ live, **0 policies = total deny** | `redeem_appointment_claim` | — | ✅ `verify_wave1_appointment_ownership` (22 PASS) | **YES** | **VERIFIED_COMPLETE** | — | Hardened after takeover vuln `610d417` |
| Walk-in join | `/s/:slug/walk-in` | `public-walkin-page` | `queue_entries` | ✅ live | `join_public_queue` | ✅ published | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | 0 rows ever | |
| Live queue status | customer app | — | `queue_entries` | ✅ live | `get_my_queue_status` | ✅ | ✅ `verify_queue` (report) | NO | IMPLEMENTED_UNVERIFIED | — | |
| Public queue display | `/s/:slug/display` | `public-queue-display-page` | `queue_entries` | ✅ live | `get_public_queue_status` | ✅ | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | — | In-shop screen |
| Queue turn notification | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | Tab must stay open |
| Waitlist | `/app/waitlist` | `app-waitlist-page` | `waitlist_entries` | ✅ live | — | ❌ | ✅ unit + report | NO | IMPLEMENTED_UNVERIFIED | — | |
| No-show rules | pro | — | `appointments` | ✅ live | `apply_appointment_no_show_rule` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | |

## Customer — Account & Passport

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Customer signup / login** | `/register`,`/login` | 2 pages | `auth.users` (17) | ✅ | Supabase Auth | — | ✅ unit | **YES** — `SITE_URL=127.0.0.1`, autoconfirm off | **BROKEN** | **B-02** | Confirmation link unreachable |
| Password reset | `/forgot-password`,`/reset-password` | 2 pages | — | — | Supabase Auth | — | ❌ | **YES** — same root cause | **BROKEN** | **B-02** | Reset link points to localhost |
| Customer home | `/app/customer` | `customer-home-page` | `customers` (**0**) | ✅ live | `customer-app.ts` | ❌ | ✅ unit + `verify_wave1_customer_app` (13 PASS) | **YES** (assertions) | IMPLEMENTED_UNVERIFIED | — | Never used |
| Customer onboarding | `…/onboarding` | page | `customer_profiles` | ✅ live | ✅ | — | ✅ `verify_wave1_customer_identity` (8 PASS) | **YES** | **VERIFIED_COMPLETE** | — | |
| My appointments + cancel | `…/appointments` | page | `appointments` (**0**) | ✅ live | `get_my_appointments`,`cancel_my_appointment` | ❌ | ✅ 13 PASS | **YES** | **VERIFIED_COMPLETE** | — | Assertions cover own/other/completed |
| Favorites | `…/favorites` | page | `customer_favorites` | ✅ live | `get_my_favorites` | — | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | — | |
| Rebook | customer app | flow | `appointments` | ✅ live | booking RPCs | — | ✅ 13 PASS | NO | IMPLEMENTED_UNVERIFIED | B-04 | |
| Customer profile | `…/profile` | page | `customer_profiles` | ✅ live | `customer-profile.ts` | — | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | — | |
| Customer settings | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | Only profile |
| **Fade Passport** | `…/passport` | page | `customer_passports` (1) | ✅ live | `passport.ts` | — | ✅ `verify_wave1_passport` (12 PASS) | **YES** | **VERIFIED_COMPLETE** | — | Customer-owned, portable |
| Passport photos | `…/passport` | upload UI | `customer_passport_photos` + private bucket | ✅ per-user folder | signed URLs 1 h | — | ✅ 12 PASS | **YES** — **0 objects stored** | **PARTIAL** | never exercised | Bucket private, 5 MB, MIME-restricted |
| Passport sharing | `/passport/shared/:token` | page | `customer_passport_shares` | ✅ live | `create_/get_/revoke_passport_share` | — | ✅ 12 PASS | **YES** | **VERIFIED_COMPLETE** | — | Hash-verified server-side, `noindex` |

## Professional / Pro app

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pro registration** | `/pro/register` | page | `professional_applications` (1) | ✅ live | `submit_professional_application` | — | ✅ unit + **e2e 49 PASS** | **YES** | **VERIFIED_COMPLETE** | — | Grants nothing until approved |
| Application pending | `/pro/application` | route | same | ✅ live | `get_my_professional_application` | — | ✅ e2e | **YES** | **VERIFIED_COMPLETE** | — | |
| **Approval** | `/platform/applications/:id` | page | `…applications`,`organizations`,`email_outbox` | ✅ live | `review_professional_application` | ✅ stored | ✅ **e2e** | **YES** | **VERIFIED_COMPLETE** | — | Applicant owns new org; reviewer gets no membership; idempotent |
| **Rejection** | same | page | same | ✅ live | same | — | ✅ **e2e** | **YES** | **VERIFIED_COMPLETE** | — | Public reason only; internal note never leaked |
| **Self-approval blocked** | — | — | — | ✅ live | `guard_professional_application_update` | — | ✅ **e2e** | **YES** | **VERIFIED_COMPLETE** | — | "still no platform role after every attempt" |
| Pro login | `/pro/login` | page | `memberships` | ✅ live | Supabase Auth | — | ✅ `require-pro-access.test.tsx` | **YES** (e2e reaches workspace) | **VERIFIED_COMPLETE** | — | Separate door |
| Today / home | `/app` | `app-home-page` | multiple | ✅ live | multiple | ❌ | ⚠️ | NO | IMPLEMENTED_UNVERIFIED | B-08 EN-only | |
| **Appointments (pro)** | `/app/appointments` | page | `appointments` (**0**) | ✅ live | `appointments.ts` | ❌ **not published** | ✅ unit | **YES** — publication list | **PARTIAL** | **B-09** | Screen never live-updates |
| Calendar view | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | List-based only |
| Live queue (pro) | `/app/queue` | page | `queue_entries` | ✅ live | `queue.ts` | ✅ **published** | ✅ unit + report | NO | IMPLEMENTED_UNVERIFIED | — | Only working realtime surface |
| **Chair Mode** | marketing only | `pricing-page.tsx:24`, `features-page.tsx:67` | — | — | — | — | ❌ | **YES** — no DB object exists | **MISSING** | **B-18 sold, not built** | Listed as a paid plan highlight |
| Chairs management | `/app/chairs` | page | `chairs` | ✅ live | `chairs.ts` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | Distinct from "Chair Mode" |
| Customers (CRM) | `/app/customers` | page | `customers` (**0**) | ✅ live | `customers.ts` | — | ✅ unit + report | NO | IMPLEMENTED_UNVERIFIED | — | Staff-note leak fixed `f021d78` |
| Services | `/app/services` | page | `services` (**0**) | ✅ live | `services.ts` | — | ✅ unit + report | **YES** — 0 rows | **PARTIAL** | **B-04** | Nothing ever created |
| Availability | `/app/availability` | page | `barber_working_hours` | ✅ live | ✅ | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | |
| Team | `/app/team` | page | `staff_profiles` (5) | ✅ live | `staff-profiles.ts` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | |
| Barber workspace | `/app/team/:id/workspace` | page | `staff_profiles` | ✅ live | ✅ | — | ⚠️ | NO | IMPLEMENTED_UNVERIFIED | — | |
| Locations | `/app/locations` | page | `locations` (4) | ✅ live | `locations.ts` | — | ✅ unit | NO | IMPLEMENTED_UNVERIFIED | — | |
| Memberships | `/app/memberships` | page | `membership_plans`,`customer_memberships` | ✅ live | `memberships.ts` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | |
| Pro settings | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | No `/app/settings` |

## Owner

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Org creation / onboarding | `/onboarding` | page | `organizations` (4) | ✅ live | `complete_organization_onboarding` | — | ✅ report + e2e (approval path) | **YES** (via e2e) | IMPLEMENTED_UNVERIFIED | — | |
| Business settings | — | — | — | — | — | — | ❌ | NO | **MISSING** | **V1 #10** | |
| Owner ≠ barber surface | `/app` shared | — | `memberships.role` | ✅ live | — | — | ❌ | NO | **MISSING** | V1 #10 | Same UI for both |
| Invitations (create/revoke) | `/app/team` | page | `invitations` (2) | ✅ live | `revoke_invitation` | — | ✅ `verify_invitation_location_scope` | NO | IMPLEMENTED_UNVERIFIED | — | Location-scoped |
| Invitation acceptance | `/invite/:token` | page | `invitations` | ✅ live | `get_invitation_by_token`,`accept_invitation` | — | ✅ unit + report | NO | IMPLEMENTED_UNVERIFIED | — | `d36c4e0` fixed redirect |
| **Invitation email** | — | — | `email_outbox` | ✅ live | — | — | ❌ | **YES** — no template | **MISSING** | **B-06** | Link must be hand-delivered |
| Multi-location | `/app/locations` | ✅ | `locations`,`service_locations` | ✅ live | ✅ | — | ✅ | NO | IMPLEMENTED_UNVERIFIED | — | |
| Reception role / surface | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | Word appears in copy only |
| Live floor view | partial | `/app/queue` | `queue_entries` | ✅ live | ✅ | ✅ | ✅ | NO | **PARTIAL** | — | Queue ≠ full floor |

## Platform

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Platform access guard | all `/platform` | `RequirePlatformRole` | `platform_members` (1) | ✅ live | `has_platform_role` | — | ✅ `verify_platform_roles` + e2e | **YES** | **VERIFIED_COMPLETE** | — | Guard in layout |
| Overview | `/platform` | page | multiple | ✅ live | `platform.ts` | — | ⚠️ | NO | IMPLEMENTED_UNVERIFIED | — | |
| Applications review | `/platform/applications` | page | `professional_applications` | ✅ live | `review_professional_application` | ⚠️ | ✅ **e2e 49 PASS** | **YES** | **VERIFIED_COMPLETE** | — | Best-proven workflow |
| Organizations | `/platform/organizations` | 2 pages | `organizations` | ✅ live | ✅ | — | ⚠️ | NO | IMPLEMENTED_UNVERIFIED | — | |
| Users management | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | Deliberate honest-absence |
| Platform team + invites | `/platform/team` | page | `platform_invitations` | ✅ live | `create_/accept_/revoke_platform_invitation` | — | ✅ `verify_platform_control_center` | NO | IMPLEMENTED_UNVERIFIED | — | |
| Owner bootstrap | `/platform/claim/:token` | page | `platform_owner_bootstrap_tokens` | ✅ live, **0 policies = total deny** | `claim_platform_owner_bootstrap` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | Single-use, unguessable |
| Support sessions | banner | context | `platform_support_sessions` | ✅ live | `start_/end_platform_support_session` | — | ✅ report | NO | IMPLEMENTED_UNVERIFIED | — | Impersonation audited |
| **Notification bell** | navbar | `notification-bell` | `platform_notifications` | ✅ live | `mark_*_read` | ❌ **NOT in publication** | ⚠️ | **YES** — publication = `queue_entries` only | **BROKEN** | **B-15** | Subscription silently inert |
| Platform audit log | `/platform/audit` | page | `platform_audit_log` (7) | ✅ live | ✅ | — | ✅ report + e2e | **YES** — e2e wrote audit events | IMPLEMENTED_UNVERIFIED | — | Real rows exist |
| **Tenant audit log** | — | — | `audit_logs` | ✅ live | — | — | ❌ | **YES** — **0 rows** | **BACKEND_ONLY** | **B-10** | Table+indexes+RLS, no writer |
| System health | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | Deliberate |
| Feature flags | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | |

## Acquisition / Worker

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Prospect schema (18 tables) | — | — | `prospects` (5) + 17 | ✅ live **FORCE** | — | — | ✅ `verify_prospect_worker_v2` | **YES** | IMPLEMENTED_UNVERIFIED | — | Platform-staff SELECT only |
| **Marketplace separation** | — | — | disjoint families | ✅ live | no join path | — | ✅ 3 PASS | **YES** — anon sees **0 of 5** prospects | **VERIFIED_COMPLETE** | — | **Structurally impossible to leak** |
| Discovery/enrichment/scoring/dedupe | worker | — | `prospect_jobs` | ✅ live | `create_prospect_discovery_job` | — | ✅ 7 worker tests | **YES** | IMPLEMENTED_UNVERIFIED | B-16 | `FOR UPDATE SKIP LOCKED` |
| Source APIs | `…/sources` | page | `prospect_sources` | ✅ live | `set_prospect_source_enabled/paused` | — | ✅ `tests/sources.test.ts` | **YES** — a job failed *"invalid credentials for source API"* | **PARTIAL** | **B-16** | ≥1 key invalid/unset |
| Planity detection | — | — | — | — | — | — | ❌ | NO | **UNVERIFIED** | — | Not found by name |
| Suppression / GDPR | `…/suppressions` | page | `prospect_suppressions` | ✅ live | `private.is_prospect_value_suppressed` | — | ✅ | NO | IMPLEMENTED_UNVERIFIED | — | `docs/worker-v2/privacy.md` |
| API quota tracking | `…/api-usage` | page | `api_usage` | ✅ live, append-only | — | — | ✅ | NO | IMPLEMENTED_UNVERIFIED | — | update/delete revoked |
| **Email dispatcher** | — | — | `email_outbox` (1) | ✅ live | — | — | ✅ 2 tests + **e2e** | **YES** — **"dispatcher can lease both queued emails"** | **PARTIAL** | E-1 | Leasing proven; delivery unproven (SMTP :2500) |

## Cross-cutting

| FEATURE | SURFACE | FRONTEND | DATABASE | RLS | RPC | REALTIME | TESTS | RUNTIME VERIFIED | STATUS | BLOCKER | NOTES |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **RLS coverage** | all | — | 54 tables | ✅ **54/54 + FORCE** | — | — | ✅ 100 assertions | **YES** | **VERIFIED_COMPLETE** | — | Verified in `pg_class` |
| **Tenant isolation** | all | — | — | ✅ | — | — | ✅ `verify_rls` | **YES** — cross-tenant reads `(0 rows)` | **VERIFIED_COMPLETE** | — | Strongest finding |
| **Anonymous exposure** | all | — | 20 tables probed | ✅ | — | — | ✅ pen-test | **YES** — **0 rows on all 20** | **VERIFIED_COMPLETE** | — | Incl. 4 real orgs, 5 prospects |
| **SECURITY DEFINER hygiene** | all | — | 70 functions | — | — | — | ✅ `pg_proc` | **YES** — 0 without `search_path` | **VERIFIED_COMPLETE** | — | |
| **Migration integrity** | — | — | 54 = 55 − 1 dropped | — | — | — | ✅ set-diff | **YES** — zero drift | **VERIFIED_COMPLETE** | — | |
| **Migration ledger** | — | — | `supabase_migrations` | — | — | — | ❌ | **YES** — schema absent | **MISSING** | **B-11** | Applied by hand, untracked |
| Design system (25 primitives) | all | `components/ui/` | — | — | — | — | ✅ build + `dialog.test.tsx` | NO | VERIFIED_COMPLETE | B-23 | Missing Checkbox/Radio/PageHeader |
| Theme (light/dark/system) | all | `theme.tsx`,`index.css` | — | — | — | — | ✅ build | NO | **PARTIAL** | B-21, B-22 | 35 light / 32 dark tokens |
| i18n — public/marketing | public | 6 namespaces | — | — | — | — | ✅ `locale-completeness` | NO | VERIFIED_COMPLETE | — | 10 locales, parity enforced |
| i18n — customer app | customer | 8/9 pages | — | — | — | — | ✅ | NO | IMPLEMENTED_UNVERIFIED | — | |
| **i18n — public booking** | `/s/:slug` | **0/4** | — | — | — | — | ❌ | NO | **MISSING** | **B-07** | Conversion path EN-only |
| **i18n — Pro app** | `/app` | **0/12** | — | — | — | — | ❌ | NO | **MISSING** | **B-08** | |
| i18n — Platform | `/platform` | 2/24 | — | — | — | — | ❌ | NO | **MISSING** | — | Internal |
| RTL (Arabic) | all | `dir` on `<html>` | — | — | — | — | ❌ | NO | **PARTIAL** | B-14 | 1 component aware |
| **Geo-IP** | public | `geolocation.ts` | — | — | `locale-detect` (HTTP 200) | — | ❌ | **YES** — `PROXY_DOMAIN` = placeholder | **PARTIAL** | — | Always falls back to Accept-Language |
| SaaS pricing | `/pricing`,`/for-business` | `lib/commerce/` | — | — | — | — | ✅ 2 test files | NO | VERIFIED_COMPLETE | B-18 | Correctly decoupled from shop prices |
| Auth: 3 separate doors | 3 login routes | 3 guards | `memberships`,`platform_members` | ✅ live | Supabase Auth | — | ✅ 2 guard tests + e2e | **YES** | **VERIFIED_COMPLETE** | — | Architectural asset |
| **Auth email flows** | signup, reset | — | `auth.users` (17) | — | GoTrue v2.189.0 | — | ❌ | **YES** — `SITE_URL=127.0.0.1` | **BROKEN** | **B-02** | Links unreachable |
| **TLS / HTTPS** | infra | — | — | — | — | — | ❌ | **YES** — nothing on 443 | **MISSING** | **B-01** | Kong plaintext on `0.0.0.0:18100` |
| **Browser E2E** | all | — | — | — | — | — | ❌ **none** | **YES** — no config/dir | **MISSING** | **B-03** | Playwright installed, unused |
| DB verification scripts | — | 23 files | — | — | — | — | ⚠️ **5 assertive / 18 reports** | **YES** — executed, 100 PASS / 0 FAIL | **PARTIAL** | **B-12** | 18 cannot fail |
| CI pipeline | — | — | — | — | — | — | ❌ | NO | **MISSING** | — | No config found |
| Legal pages | public | — | — | — | — | — | ❌ | NO | **MISSING** | **B-13** | GDPR exposure |
| **Seed/product data** | all | — | `services`,`appointments`,`customers` | — | — | — | — | **YES** — **all 0** | **MISSING** | **B-04** | Nothing is bookable |

## Future (not started — correctly absent)

| FEATURE | STATUS | NOTES |
|---|---|---|
| Wallet, Referral, Tips, Commissions, Products, Inventory | FUTURE | No table, no route |
| Loyalty | FUTURE | Claim **removed** in `cb6f90d` — correct behavior |
| Payments | FUTURE | No provider anywhere in the stack |

---

## Roll-up

| Status | Count |
|---|---|
| **VERIFIED_COMPLETE** | **21** (16 of them runtime-verified this audit) |
| IMPLEMENTED_UNVERIFIED | 33 |
| PARTIAL | 9 |
| **BROKEN** | **4** |
| BACKEND_ONLY | 1 |
| MISSING | 25 |
| FUTURE | 7 |
| **RUNTIME VERIFIED = YES** | **26** |

**Compared with the previous revision** (0 runtime-verified rows), 26 rows now rest on executed evidence. The gain is concentrated in **security and the professional-approval workflow**; it is absent from **booking, queue and customer flows**, because those have never run with data.

**The four BROKEN rows are the product's critical path:** customer signup, password reset, public booking, and the platform notification bell.
