# FadeUp — Full Forensic Audit

**Date:** 2026-08-17 (revised with live-database evidence)
**Branch:** `backup/fadeup-20260817-1533` @ `fa87b18`
**Method:** static analysis + **executed test suite** + **executed production build** + **live PostgreSQL introspection** + **executed DB verification scripts** + **executed end-to-end script** + **live anonymous API penetration test**.

---

## 0. Audit integrity statement

### 0.1 Evidence actually obtained

| Capability | Status | Evidence |
|---|---|---|
| Source files | ✅ Full | 299 tracked files in `apps/web/src` |
| Migrations as written | ✅ Full | 52 files |
| Frontend test suite | ✅ **EXECUTED** | `vitest run` → **43 files / 260 tests PASS** |
| Production build | ✅ **EXECUTED** | `npm run build` → **exit 0**, `tsc -b` clean |
| **Live PostgreSQL** | ✅ **CONNECTED** | via Supavisor pooler, `postgres.<tenant>` |
| **DB verification scripts** | ✅ **EXECUTED** | 23/23 ran, **100 assertions PASS / 0 FAIL** |
| **End-to-end script** | ✅ **EXECUTED** | **49 PASS / 0 FAIL** |
| **Anonymous API pen-test** | ✅ **EXECUTED** | 20 sensitive tables probed as `anon` |
| Container health / versions | ❌ Docker denied | versions obtained via SQL + HTTP headers instead |
| Browser E2E | ❌ **None exists** | Playwright installed but unconfigured |

**Connection detail (for reproducibility):** the pooler requires a tenant-qualified user (`postgres.<POOLER_TENANT_ID>`); a bare `postgres` user fails with `ENOIDENTIFIER`. This — not a missing credential — is what blocked the first audit pass.

### 0.2 Corrections to the previous revision of this document

A forensic audit must be reproducible, so I record where my own earlier conclusions were **wrong**:

| Earlier claim | Verdict | Truth |
|---|---|---|
| "18 acquisition tables lack RLS" | ❌ **FALSE** | Enabled via `execute format(...)` in `DO` blocks; invisible to grep. **54/54 tables confirmed live.** |
| "`/platform` is unguarded" | ❌ **FALSE** | Guard is in `platform-layout.tsx:23`, not the router |
| "SECURITY DEFINER functions missing `search_path`" | ❌ **FALSE** | Live DB: **70 definer functions, 0 without `search_path`** |
| "Git object store is damaged (P1)" | ❌ **FALSE** | Permission artifact. `git fsck` clean, `rev-list` works. **Finding withdrawn.** |
| "`.env.local` anon key is stale" | ❌ **FALSE** | Key is valid; the 403 was the OpenAPI root, restricted to `service_role` by design |
| "`platform_admins` vs `platform_members` ambiguity" | ❌ **FALSE** | A completed migration, not ambiguity — see §20 |
| "Migration drift unknown — top blocker" | ✅ **RESOLVED** | **Zero drift.** See §20 |

---

## 1. Executive Summary

FadeUp's **engineering foundation is materially stronger than the previous audit could prove, and its product maturity is materially weaker than its file count suggests.**

**Now proven at runtime (not inferred):**
- **Multi-tenant isolation works.** `verify_rls.sql` executed live: a user reading another organization by ID gets `(0 rows)`; an unfiltered `select *` returns only their own org, hiding even the 4 real production organizations.
- **Anonymous API exposure is zero.** All 20 sensitive tables probed as `anon` returned **0 rows** — including `organizations` (4 real rows) and `prospects` (5 real rows).
- **RLS is enforced, not just written.** 54/54 tables have `RLS` **and** `FORCE ROW LEVEL SECURITY` live.
- **70 SECURITY DEFINER functions, 0 without `search_path`.** Perfect hygiene, verified against `pg_proc`.
- **Zero migration drift.** 54 live tables = 55 created − 1 deliberately dropped.
- **Journey 4 (pro application → approval → workspace) is end-to-end verified**: 49/49 assertions including self-approval blocked, reviewer gets no membership, idempotent re-approval, internal notes never leaked, exactly one email queued.
- 260 frontend tests pass; production build clean; one design system; no duplicated libraries.

**Now proven to be worse than it looked:**
- **The product has never been used.** `services = 0`, `appointments = 0`, `queue_entries = 0`, `customers = 0`, `storage.objects = 0`. **Booking is impossible today** — no organization has a single bookable service.
- **Auth email flows are broken by configuration.** `SITE_URL = http://127.0.0.1:15180` with `ENABLE_EMAIL_AUTOCONFIRM = false`: every confirmation and password-reset link points at localhost. No real user can complete signup.
- **`PROXY_DOMAIN = your-domain.example.com`** — the placeholder was never replaced. **No TLS anywhere**; nothing listens on 443.
- **New bug found only at runtime:** the Realtime publication contains **only `queue_entries`**, yet the frontend subscribes to `platform_notifications`. That subscription is silently dead.
- **18 of 23 "verification" scripts contain no assertions** — they are human-readable reports that cannot fail.
- **Zero browser E2E coverage.**

**One-line verdict:** the backend is genuinely well-built and now *proven* so; the product is a well-engineered machine that has never been switched on, sitting behind an unencrypted, misconfigured front door.

---

## 2. Current Architecture

```
/opt/fadeup
├── apps/web/                 React 19 · Vite 8 · TS 6 · Tailwind 4 SPA   [ACTIVE — only frontend]
├── apps/prospect-worker-v2/  Node/TS acquisition worker + email dispatcher [ACTIVE — internal]
├── db/migrations/            52 forward-only SQL migrations               [SOURCE OF TRUTH]
├── db/tests/                 23 verify_*.sql  (5 assertive, 18 reports)
├── db/seeds/                 marketplace_demo.sql                          [DEV ONLY]
├── infra/supabase/           self-hosted Supabase compose stack
├── infra/worker/             worker compose
├── docs/                     architecture, database, design-2026, wave-1, worker-v2
└── scripts/                  1 e2e script (.mjs)
```

**`apps/web-v2` DOES NOT EXIST.** The brief's "legacy vs V2" framing (§3, §4, §43) has no referent. There is **one** frontend, actively developed. No dual-frontend migration debt exists — this is good news, not a gap.

**Note on host isolation:** port 4173 on this host serves **Jasmean OS**. Per CLAUDE.md it is out of scope and was not touched, inspected, or modified.

---

## 3. Git / Repository State

| Item | Value |
|---|---|
| Branch | `backup/fadeup-20260817-1533` |
| HEAD | `fa87b18` |
| Other branches | `feat/prospect-worker-v2` (same commit), `master` @ `0cd6fc2` |
| Remote | `origin git@github.com:udayisines-netizen/fadeup.git` |
| Working tree | **Clean** — only `docs/audits/` and `.claude/settings.local.json` untracked |
| Integrity | ✅ **`git fsck` clean** (only dangling commits, harmless) |

- **G-1 (P3):** HEAD sits on a `backup/…` branch that has diverged from `master` @ `0cd6fc2`. Which line is canonical is undocumented.
- Commit discipline is good — conventional commits, honest messages (`cb6f90d fix(marketing): stop claiming loyalty balances, which are not built`).

---

## 4. Route Inventory

Source: `apps/web/src/routes/router.tsx` (573 lines, fully read). All routes lazy-loaded.

### 4.1 Public

| URL | Page | Data source | Status |
|---|---|---|---|
| `/` | `consumer-landing-page` | `search_public_professionals` | **VERIFIED_WORKING** — RPC returns real org "7 VIE LA" anonymously (HTTP 200) |
| `/search` | `marketplace-search-page` | `search_public_professionals` | **VERIFIED_WORKING** — same RPC |
| `/for-business` | `business-landing-page` | `lib/commerce/plans` | IMPLEMENTED_UNVERIFIED |
| `/features` | `features-page` | static + illustrative previews | PLACEHOLDER (marketing) |
| `/pricing` | `pricing-page` | static plan copy | PARTIAL — advertises unbuilt Chair Mode |
| `/terms`, `/privacy` | — | — | **MISSING** |

### 4.2 Auth

`/login`, `/register`, `/pro/login`, `/pro/register`, `/pro/application`, `/forgot-password`, `/reset-password`, `/invite/:token`, `/workspace`, `/onboarding` — all IMPLEMENTED_UNVERIFIED.
`/signup`, `/pro/signup`, `/customer/login`, `/customer/signup` — **4 LEGACY_REDIRECT** shims, documented in-code, intentional.

**`/pro/register` → approval → `/workspace` is VERIFIED_WORKING** at the data layer (e2e 49/49).

### 4.3 Customer app (`/app/customer`)

`index`, `onboarding`, `profile`, `appointments`, `favorites`, `passport` — IMPLEMENTED_UNVERIFIED, all query-backed.
`/passport/shared/:token` — public, hash-verified server-side, `noindex`.
**MISSING:** customer settings route.

### 4.4 Public booking (`/s/:slug`)

`index`, `profile`, `walk-in`, `display`, `barbers/:barberId` — RPC chain complete.
**Status downgraded to PARTIAL:** with `services = 0` in the database, **the booking page has nothing to offer**. The route works; the product behind it is empty.

**R-1 (P2):** brief expects `/barber/:slug` and `/shop/:slug`; actual scheme is `/s/:slug…` — opaque and weak for a discovery product's SEO. Undocumented decision.

### 4.5 Professional app (`/app`)

12 routes: `index`, `team`, `team/:id/workspace`, `locations`, `chairs`, `services`, `availability`, `appointments`, `queue`, `customers`, `waitlist`, `memberships`. All IMPLEMENTED_UNVERIFIED.
**MISSING:** `/app/settings`.

### 4.6 Platform (`/platform`)

8 routes + **13 acquisition sub-routes**. Guarded by `RequirePlatformRole` (in layout, not router).
**MISSING vs brief:** `users`, `system`, `support`, `settings` — **deliberately absent**, documented at `platform-layout.tsx:16-19`: unbuilt capabilities get honest absence rather than fabricated dashboards. **Correct judgment; preserve it.**

---

## 5. UI / UX Audit

Four shells — `MarketingLayout`, `CustomerAppLayout`, `AppLayout`, `PlatformLayout` — plus focused `PublicBookingLayout` whose in-code rationale (router.tsx:430-433) is sound product thinking.

- **UX-1 (P1):** `/workspace` is a forced interstitial on every login. Single-org users pay a click and a moment of confusion each time.
- **UX-2 (P2):** no visible role-switch affordance for dual customer/pro users.
- **UX-3 (P2):** Platform nav hides 13 acquisition sub-routes behind one item.
- **UX-4 (P3):** "Team" means platform staff at `/platform/team` and barbers at `/app/team`.

**Feedback states:** full ladder exists as primitives (`spinner`, `empty-state`, `error-state`, `alert`, `toast`, `skeleton`); `RequirePlatformRole` demonstrates loading → session → pending → error → success. **Real system, not decoration.**
**Gaps:** no offline/reconnect handling; no session-expiry interception (401 surfaces as a generic query error).

**Forms:** react-hook-form + zod, centralized primitives. `text-field.tsx:21-44` implements `htmlFor`/`useId`, `aria-invalid`, `aria-describedby`, `role="alert"` — the strongest layer of the codebase.
**Gap:** no `Checkbox`, no `Radio` primitive.

---

## 6. Webdesign / Art Direction

Coherent identity defined once in `index.css` (13.5 kB): token families `ink`, `paper`, `ivory`, `forest`, `accent`, `border`, `on-*`, `success/warning/danger/info`. Motion confined to marketing via `motion/react`, gated by `useReducedMotion()` in every animated component plus a CSS `prefers-reduced-motion` guard (`index.css:273`).

| Surface | Score | Justification |
|---|---|---|
| Consumer landing | **8/10** | Real data (runtime-verified), 10 locales, reduced-motion aware; no imagery system |
| For Business | **8/10** | Scene architecture, mode-adaptive, RTL-aware; heaviest content chunk (48 kB) |
| Marketplace | **7/10** | Never fabricates fields; no map, no photographs |
| Customer App | **7/10** | Consistent, translated, real queries; no settings surface |
| Pro App | **5/10** | Complete but **0% translated**, density-first where CLAUDE.md mandates speed and large touch targets |
| Owner interface | **4/10** | Not a distinct surface; no business settings |
| Platform | **6/10** | Comprehensive, honest about gaps; flat nav, English-only |

**Absent, to the codebase's credit:** no glassmorphism abuse, no gradient soup, no card nesting. **One** hardcoded color in all of `src/`.

---

## 7. Landing Page Audit

**`/`** — rebuilt at `ba3e064`. Consumes `search_public_professionals`; **runtime-verified returning real data anonymously**. No fixture fallback (`marketplace.ts` throws on error). Commit `d6c5f7d` "stop serving fixtures" corroborated.

**`/for-business`** — rebuilt `27d8210`, extended `702e315` (7-plan catalog) and `d8272e6` (adapts to business type). Architecture: `scenes.ts` + `product-stage.tsx` (sticky stage) + `mode-selector.tsx` + `pricing-stage.tsx` + `capability-comparison.tsx`.

**Scene classification:** Hero / Business types / Pricing / CTA — IMPLEMENTED. Appointments / Walk-ins / Live Queue / Barber assignment — IMPLEMENTED as illustrative stage content. Fade Passport / Customer history — IMPLEMENTED and genuinely backed. Shop floor / Owner / Team / Marketplace / Discovery / Rebook / FadeUp loop / competitor positioning — narrative copy. **Chair Mode — MARKETED, NOT BUILT.**

**Geo pricing on this page: INERT** (§12).

---

## 8. Design System Audit

**One system, one directory: `components/ui/` (25 primitives).** No competing system anywhere.

Present: Button, TextField, Textarea, SelectField, Switch, Card, Badge, Alert, Container, Table, Tabs, Dialog, Drawer, DropdownMenu, Tooltip, Toast, Skeleton, Spinner, EmptyState, ErrorState, NavLink, Navbar, ThemeToggle, LanguageSwitcher.
Radix-backed primitives inherit focus trap, escape handling, portal + ARIA correctness.

**Missing: `Checkbox`, `Radio`, `PageHeader`.** Every page re-implements its own header → drift.

**Recommendation:** KEEP entirely. ADD the three missing primitives. Nothing needs rewriting or deleting.

---

## 9. Responsive Audit

**Honest limitation:** no browser available. This is static risk analysis, explicitly not measurement.

| Risk | Severity |
|---|---|
| `table.tsx` used across Platform + `/app` list pages with no card fallback; Platform/Pro are table-heavy | **P1 (unverified)** |
| No calendar component exists (appointments are list-based) — avoids the classic mobile-calendar failure | P3 |
| `min-h-svh` used, not `min-h-screen` (`platform-layout.tsx:41`) | ✅ correct |
| Dialog viewport safety fixed at `de7e3e6`, covered by `dialog.test.tsx` | ✅ |
| No bottom-nav component for a mobile-first customer/barber product | P2 |

**This section cannot be closed without a device pass. It is V1 work, not V1 evidence.**

---

## 10. Theme Audit

**Architecture verified correct.** Provider `lib/theme.tsx` (82 lines): `light | dark | system`, `data-theme` on `<html>`, pre-paint bootstrap in `index.html:15-22` (no FOUC), `localStorage` in try/catch, live `matchMedia` following while `system`. Tokens: **35 light in `@theme`, 32 overridden** under `:root[data-theme='dark']`. Radix portals inherit the attribute → dialogs/toasts theme correctly.

- **T-1 (P2):** 3 of 35 tokens not overridden in dark — a latent contrast bug.
- **T-2 (P3):** exactly one hardcoded color, in `business-landing-page.tsx`.
- **T-3 (P2):** `ThemeToggle` is mounted **only** in `PlatformLayout`. Customers and barbers cannot reach the dark palette that exists.

---

## 11. i18n Audit

`i18next` + `react-i18next` + language detector; config `i18n/index.ts` (159 lines). **10 locales × 6 namespaces** (`auth`, `common`, `customer-app`, `landing`, `marketplace`, `passport`). Key parity **enforced by a passing test** (`locale-completeness.test.ts`).

**Coverage by surface — the headline failure:**

| Surface | Pages using `useTranslation` |
|---|---|
| Marketing | 3/3 ✅ |
| Customer app | 8/9 ✅ |
| **Public booking (`public-*`)** | **0/4** ❌ |
| **Pro app (`app-*`)** | **0/12** ❌ |
| **Platform (`platform-*`)** | **2/24** ❌ |

**I18N-1 (P0 for a French-first launch):** FadeUp markets in 10 languages then conducts the **actual booking transaction in English only**.
**I18N-2 (P1):** the Pro app is 100% English — French shop staff operate daily in a foreign language.

**RTL:** `i18n/index.ts:139` sets `document.documentElement.dir`. Only **one** component (`mode-selector.tsx:37`) adapts logic. Document-level RTL works; component-level is unproven.

---

## 12. Geo-IP Audit

**IMPLEMENTED BUT INERT.** `infra/supabase/volumes/functions/locale-detect/index.ts` maps ~30 countries → locales and is honest in its own header:

> *"No such header is configured on this VPS yet — until it is, this always falls through to Accept-Language."*

Confirmed by `PROXY_DOMAIN = your-domain.example.com` — no reverse proxy was ever configured. Geo resolution: **never active**. Locale selection still works server-side via `Accept-Language`. Fallback is safe (never blocks).

**Language ↔ pricing region: CORRECTLY DECOUPLED** — see §13.

---

## 13. Pricing Audit

**Centralized and correct.** `lib/commerce/`: `plans.ts` (504 lines, 7 plans), `pricing.ts` (194), `pricing-context.tsx` (127), with `plans.test.ts` + `pricing.test.ts` **passing**.

**Sweep: zero hardcoded SaaS prices in components.** The only `€`/`$` in non-test source are explanatory comments inside `pricing.ts`.

**The SaaS/shop separation is explicit and right.** `pricing.ts:26`: *"A Paris shop charging 25 € shows 25 € to someone [abroad]"*. `pricing.ts:147`: locale changes **formatting** (`49 €` vs `$49`) but *"never changes WHICH currency is shown."*

**PR-1 (P2):** `pricing-page.tsx:24` lists **"Chair Mode"** as a plan highlight for an unbuilt feature — inconsistent with the team's own precedent (`cb6f90d` removed the loyalty claim on identical grounds).

---

## 14. Frontend Data Architecture

31 modules in `lib/queries/` + 8 in `lib/queries/acquisition/`. Uniform pattern:

```
Page → use<Thing>() (TanStack Query) → getSupabaseClient().rpc('<name>', {p_…})
     → snake_case Row interface → map<Thing>() → camelCase domain type
```

**No raw Supabase calls in components.** Single client factory. **42 distinct RPCs**, all `p_`-prefixed.

**Verified:** all 42 frontend RPC names exist in migrations (set-diff empty) **and** the DB holds 71 public + 21 private functions.

**D-1 (P2):** types are **hand-written**, not generated. A column rename produces a runtime `undefined`, not a compile error. Largest latent-bug source in the frontend.

---

## 15. Mock / Demo Data Audit

| Item | Category |
|---|---|
| `product-previews.tsx` (`/features`) | **SAFE** — `aria-hidden`, visibly labeled *"Illustrative preview"*, self-documented at lines 6-16 |
| `for-business/product-stage.tsx`, `scenes.ts` | **SAFE** — narrative scene content |
| `db/seeds/marketplace_demo.sql` | **DEV_ONLY** — not referenced by app code |
| `lib/uuid.ts`, `lib/locale.ts`, `dialog.tsx`, `login-form.tsx` | **SAFE** — `placeholder` attributes / fallback logic |

**NO `ACTIVE_PRODUCTION_FAKE`. NO `PRODUCTION_RISK`.** Marketplace, profiles, queue, availability and history all resolve to real RPCs that `throw` on error — now **runtime-confirmed**: the live marketplace RPC returns a real organization, not a fixture.

**MD-1 (P3):** `product-previews.tsx:9` carries a stale comment claiming only auth/onboarding is built.

---

## 16-17. Supabase Architecture — LIVE

| Component | Status | Version / detail |
|---|---|---|
| PostgreSQL | ✅ | **17.6** |
| Kong | ✅ | **3.9.3** |
| Auth (GoTrue) | ✅ HTTP 200 | **v2.189.0** — 17 accounts |
| PostgREST | ✅ HTTP 200 | `PGRST_DB_SCHEMAS=public,graphql_public`, `MAX_ROWS=1000` |
| Storage | ✅ HTTP 200 | 1 bucket, **0 objects** |
| Edge Functions | ✅ HTTP 200 | `FUNCTIONS_VERIFY_JWT=false` |
| Realtime | ⚠️ | publication contains **only `queue_entries`** |
| Pooler (Supavisor) | ✅ | 15432 session / 16543 transaction |
| Studio / Meta / Imgproxy | ❔ | Docker denied — not individually verifiable |

**Schemas present:** `public`, `auth`, `storage`, `realtime`, `_realtime`, `extensions`, `graphql`, `graphql_public`, `vault`, `supabase_functions`, `pgbouncer`, `private`.
**Extensions:** `earthdistance`, `cube` (radius search — **no PostGIS**), `pg_trgm`, `unaccent`, `pgcrypto`, `pg_net`, `supabase_vault`, `btree_gist`, `pg_stat_statements`, `uuid-ossp`, `plpgsql`.

**Port bindings (live `ss`):**

| Service | Binding | Assessment |
|---|---|---|
| PostgreSQL | `127.0.0.1:15432` | ✅ correct |
| Pooler | `127.0.0.1:16543` | ✅ correct |
| Kong HTTPS | `127.0.0.1:18443` | ✅ localhost only |
| **Kong HTTP** | **`0.0.0.0:18100`** | ❌ **public, plaintext** |
| nginx | `0.0.0.0:80` | ❌ plaintext |
| **443** | **nothing** | ❌ **no TLS** |

---

## 18. Database Schema Inventory — LIVE

**54 tables in `public`. 100% with `RLS` + `FORCE RLS`. 166 policies, 182 indexes, 71 public + 21 private functions.**

Live row counts (the most important table in this audit):

| Domain | Table | Rows | Policies |
|---|---|---|---|
| ORGANIZATIONS | `organizations` | **4** | 4 |
| LOCATIONS | `locations` | **4** | 4 |
| STAFF | `barbers` / `staff_profiles` | **4 / 5** | 4 / 4 |
| **SERVICES** | `services` | **0** | 4 |
| **APPOINTMENTS** | `appointments` | **0** | 5 |
| **QUEUE** | `queue_entries` | **0** | 5 |
| **CUSTOMERS** | `customers` | **0** | 4 |
| PASSPORT | `customer_passports` | 1 | 4 |
| PASSPORT PHOTOS | `storage.objects` | **0** | — |
| APPLICATIONS | `professional_applications` | 1 | 3 |
| INVITATIONS | `invitations` | 2 | 3 |
| PLATFORM | `platform_members` | 1 | 2 |
| PLATFORM AUDIT | `platform_audit_log` | 7 | 1 |
| **TENANT AUDIT** | `audit_logs` | **0** | 1 |
| EMAIL | `email_outbox` | 1 | 2 |
| ACQUISITION | `prospects` | 5 | 5 |
| AUTH | `auth.users` | 17 | — |

**S-1 (P0 — product, not code): FadeUp has never been used.** Zero services means **no organization has anything bookable**. The marketplace correctly returns "7 VIE LA", but a customer clicking through finds nothing to book. Booking, queue and CRM have never processed a row.

**S-2 (P1 confirmed): `audit_logs` = 0 rows.** `…100900_tenant_rls_policies.sql:185` states *"no feature produces audit events yet"*; the live count proves nothing was added since. **Tenant-level auditability is unimplemented.**

**S-3 (P2): Triple identity model.** `profiles` / `customer_profiles` / `customers` are three notions of a person, bridged by `claim_customer_records` and `link_customer_from_contact_info`. Commit `610d417` removed an **account-takeover vector** here and two migrations corrected it. Highest-risk schema area — but now covered by 22 passing assertions in `verify_wave1_appointment_ownership.sql`.

---

## 19. Database Relationships

`auth.users` → `profiles` (1:1, trigger `handle_new_user`) → `memberships` → `organizations` → `locations` → `staff_profiles` → `barbers` → `barber_services`/`barber_working_hours` → `appointments`/`queue_entries`. `customers` links to bookings via `link_customer_from_contact_info` / `claim_customer_records`. `customer_passports` is customer-owned (not tenant-owned) — deliberate and correct for portability. `prospects` is a **disjoint island** (§29).

Orphan-risk handled deliberately: `audit_logs` uses `ON DELETE SET NULL` (not CASCADE) on both `organization_id` and `actor_user_id`, so deleting an org never destroys its trail — documented and verified in `verify_rls.sql` cleanup.

---

## 20. Migration Audit — DRIFT RESOLVED

52 forward-only migrations, `20260809100000_extensions` → `20260814000000_marketplace_city_matching`. No duplicate filenames.

**M-1 — ZERO DRIFT (previously the #1 blocker).**
- Live tables: **54**. Repo `create table`: **55**. Difference: exactly `platform_admins`.
- `20260810130000_platform_roles.sql:82` **deliberately drops it** after migrating its rows into `platform_members` as `platform_owner`, guarded idempotently by `to_regclass(...) is not null`.
- It is the **only** `drop table` in all 52 migrations.
- **Conclusion: the database matches the repository exactly.** This also resolves the previously-flagged `platform_admins`/`platform_members` ambiguity — it was a completed migration.

**M-2 (P1 — NEW): there is no migration ledger.** `supabase_migrations.schema_migrations` **does not exist**. Migrations were applied by hand. Today drift is zero by luck and discipline; nothing structurally prevents it, and nothing records what ran or when. **This is now the real migration risk**, replacing the drift concern.

**M-3 (P3):** `search_public_organizations` is defined but never called by the frontend — superseded by `search_public_professionals`.

Repeated-object edits are legible remediation, not churn: appointments hardened by `…150000_appointment_ownership_hardening`; claiming fixed by `…160000_claim_scope_fix` after `610d417`.

---

## 21. RLS Audit — VERIFIED ENFORCED

**Live: 54/54 tables have `relrowsecurity` AND `relforcerowsecurity`. 166 policies.** `FORCE` means even the table owner is not exempt — deliberate, documented at `…150100:591-593`.

Authorization centralized in `private.*` helpers invoked as `(select private.has_platform_role(...))` — the correct initplan-cached form.

### Runtime penetration test — anonymous role

20 sensitive tables queried through PostgREST with the `anon` key:

| Result | Count |
|---|---|
| Rows returned to anonymous | **0 on all 20** |

Includes `organizations` (4 real rows), `prospects` (5 real rows), `customer_passports`, `email_outbox`, `platform_members`, `audit_logs`, `profiles`. **Nothing leaks to anonymous users.**

### Runtime tenant-isolation test (`verify_rls.sql`, executed)

| Assertion | Expected | Actual |
|---|---|---|
| Alice reads Org B by ID | 0 rows | **`(0 rows)`** ✅ |
| Alice `select *` unfiltered | only Org A | **only "Alice's Barbershop"** ✅ (4 real prod orgs also hidden) |
| Alice reads Org A memberships | 3 rows | **`(3 rows)`** ✅ |
| Alice reads Org B memberships | 0 rows | **`(0 rows)`** ✅ |
| Alice reads locations | only Org A's | **only "Org A Downtown"** ✅ |

| Boundary | Verdict | Evidence |
|---|---|---|
| Org A ↔ Org B | ✅ **SAFE — runtime verified** | above |
| Anonymous exposure | ✅ **SAFE — runtime verified** | pen-test |
| Customer A ↔ Customer B passport | ✅ SAFE | `verify_wave1_passport.sql` (12 PASS) |
| Barber self-promotion | ✅ **SAFE — runtime verified** | e2e: "still no platform role after every attempt" |
| Pending Pro self-approval | ✅ **SAFE — runtime verified** | e2e PASS |
| Tenant owner → Platform owner | ✅ **SAFE — runtime verified** | e2e: "approval granted the applicant no platform role" |
| Reviewer privilege leak | ✅ **SAFE — runtime verified** | e2e: "the REVIEWER got no membership in the applicant's shop" |
| Prospect → marketplace | ✅ **SAFE — structural** | §29 |

**No CRITICAL, HIGH_RISK or QUESTIONABLE RLS finding.** This is the strongest part of FadeUp and it is now proven, not asserted.

---

## 22. RPC / Function Audit — LIVE

**71 public + 21 private functions. 70 are `SECURITY DEFINER`. Zero lack an explicit `search_path`** (verified against `pg_proc.proconfig`). Schema-injection hygiene is complete.

All 42 frontend-called RPCs exist. The uncalled remainder are triggers and `check_*_consistency` constraint functions — correctly not client-callable.

Sensitive RPCs runtime-verified by the e2e run: `submit_professional_application`, `review_professional_application`, `guard_professional_application_update` (idempotent, non-escalating, no internal-note leakage). `get_shared_passport` verifies the share token **by hash server-side**, and the public view sets `noindex` — correctly designed capability URL.

---

## 23. Index / Performance Audit

**182 indexes across 54 tables**, live. Heaviest coverage where expected: `prospects` (11), `appointments` (9), `customers` (6), `queue_entries` (5), `prospect_jobs` (5), `staff_profiles` (5).

Good practice spot-verified: `audit_logs_org_created_at_idx (organization_id, created_at desc)` composite; `email_outbox_pending_idx` partial on `next_attempt_at`.

**Adequacy cannot be assessed:** with `appointments = 0` and `services = 0`, no query plan is meaningful. `search_public_professionals` (country/city/geo-radius/price/open-now/text) is the most complex query in the system and uses `earthdistance`/`cube` rather than PostGIS. **First place to measure once real data exists** — §49, not V1.

---

## 24. Auth Audit — CONFIGURATION IS BROKEN

Three deliberately separate front doors — `/login`, `/pro/login`, `/platform/login` (excluded from public nav) — with three guards, each unit-tested. Established `37e1a5a`, reinforced `e8b9997`, `804f0b6`. **Architecturally excellent.**

**Live configuration:**

| Setting | Value | Assessment |
|---|---|---|
| `SITE_URL` | `http://127.0.0.1:15180` | ❌ **localhost** |
| `ADDITIONAL_REDIRECT_URLS` | **EMPTY** | ❌ |
| `ENABLE_EMAIL_AUTOCONFIRM` | `false` | confirmation required |
| `ENABLE_EMAIL_SIGNUP` | `true` | |
| `DISABLE_SIGNUP` | `false` | open |
| `ENABLE_ANONYMOUS_USERS` | `false` | ✅ correct |
| `ENABLE_PHONE_SIGNUP` | `true` | ⚠️ enabled without a configured provider |
| `JWT_EXPIRY` | 3600 | reasonable |
| `SMTP_PORT` | 2500 | non-standard |
| `PROXY_DOMAIN` | `your-domain.example.com` | ❌ **placeholder never replaced** |

**A-1 (P0 — NEW, runtime-confirmed): email-based auth is non-functional for real users.** `ENABLE_EMAIL_AUTOCONFIRM=false` requires clicking a confirmation link, and `SITE_URL` points at `127.0.0.1:15180`. Every confirmation and password-reset link is unreachable from any real device. **Customer signup and password reset cannot complete.**

**A-2 (P2):** `.env.example` declares `VITE_SUPABASE_PUBLISHABLE_KEY` while `.env.local` sets `VITE_SUPABASE_ANON_KEY`. A developer following the example gets a non-booting app.
**A-3 (P2):** `ENABLE_PHONE_SIGNUP=true` with no evidence of an SMS provider — an enabled but unbacked signup path.
**A-4 (P2):** no session-expiry interception.

---

## 25. Storage Audit

**One bucket: `passport-photos`** — `public = false`, `file_size_limit = 5 MB`, MIME-restricted. Policies on `storage.objects` scope select/insert/delete to `bucket_id='passport-photos' AND (storage.foldername(name))[1] = auth.uid()::text`. Frontend uses `createSignedUrl(…, 3600)`, never public URLs.

**No private file is public.** ✅ **Live objects: 0** — the feature has never been exercised.

**ST-1 (P2):** no bucket for avatars, barber portfolios or shop media. `barberAvatarUrl` exists as a field with no upload path. **A barbershop discovery marketplace can currently display no photographs of anything.**

---

## 26. Realtime Audit — NEW BUG

**Live publication `supabase_realtime` contains exactly one table: `queue_entries`.**

| Subscription | Table | In publication? |
|---|---|---|
| `queue-entries-${organizationId}` (`queue.ts:101`) | `queue_entries` | ✅ yes |
| `platform-notifications-${userId}` (`professional-applications.ts:311-318`) | `platform_notifications` | ❌ **NO** |

**RT-1 (P2 — NEW, found only at runtime): the platform notification bell never updates in realtime.** The subscription is syntactically correct and silently inert; `postgres_changes` events are never emitted for a table absent from the publication. Platform staff will not see new applications appear live. Static analysis could not have found this. Fix is one line of SQL.

**RT-2 (P1): appointments have no realtime at all.** A shop floor running the day off `/app/appointments` sees a screen that does not reflect new bookings.
**RT-3 (P2):** no reconnect/stale-channel handling.

Both existing subscriptions are correctly tenant/user-filtered and call `removeChannel` on cleanup. **No cross-tenant realtime exposure.**

---

## 27. Edge Functions Audit

| Function | Status |
|---|---|
| `locale-detect` | **PARTIAL** — deployed and returns HTTP 200, but inert without a proxy geo header (§12) |
| `hello` | **UNUSED** — Supabase scaffold, should be removed |
| `main` | infrastructure entrypoint |

`FUNCTIONS_VERIFY_JWT = false` — acceptable for `locale-detect` (deliberately public, no secrets, no data access), but it applies **globally**, so any future function is unauthenticated by default. **P2 configuration risk.**

---

## 28. Email / Notification Audit

**Architecture is sound.** `email_outbox` (RLS + FORCE, partial index on pending) is written **in the same transaction as the decision**; delivery is asynchronous via `EmailDispatcher` (`apps/prospect-worker-v2/src/email/dispatcher.ts`) holding a least-privileged `prospect_worker` connection with `FOR UPDATE SKIP LOCKED`. Failures park as `failed` with the error rather than vanishing.

**Runtime-verified by the e2e run:**
- exactly one approval email queued per approval ✅
- exactly one rejection email queued, carrying **only** the public reason ✅
- neither email carries the internal note ✅
- the applicant **cannot** read the outbox; the platform owner can ✅
- **the dispatcher can lease both queued emails** ✅

| Notification | State |
|---|---|
| Pro approved / rejected | ✅ **queued and leasable — verified** |
| Platform in-app notifications | ⚠️ stored, but realtime dead (RT-1) |
| **Invitation email** | ❌ **MISSING** — no template |
| **Booking confirmation** | ❌ **MISSING** |
| **Queue turn notification** | ❌ **MISSING** |

**E-1 (P1):** `SMTP_HOST` is set and `SMTP_PORT` is **2500** — a non-standard port characteristic of a development mail catcher. Whether any email leaves the host is **unverified**; the dispatcher was proven able to lease, not to deliver.
**E-2 (P0):** a customer who books receives nothing. For a booking product this is a missing core function, not a gap.
**E-3 (P0):** an invited barber receives nothing — the owner must hand-deliver the link.

---

## 29. Worker / Acquisition Audit

`apps/prospect-worker-v2` — 34 source files, own Dockerfile/compose, 7 test files. Sources: `google-places`, `geoapify`, `osm`, `sirene`, `instagram`, `website`. Pipeline: discovery → enrichment → scoring → dedup-scan, with `FOR UPDATE SKIP LOCKED` claiming, quota, retry, and normalizers (phone/email/address/domain/name).

**Live state:** `prospects = 5`, plus the 17 supporting tables. `verify_prospect_worker_v2.sql` executed cleanly (554 lines of output). One log line shows a job in `failed` state with *"invalid credentials for source API"* — i.e. **at least one source API key is invalid or unset**; the queue correctly parked the failure rather than crashing.

**✅ CRITICAL SEPARATION — CONFIRMED STRUCTURALLY AND AT RUNTIME.**
- `prospect_*` is a disjoint table family; `search_public_professionals` reads only `organizations`/`locations`/`barbers`. **No FK, view or join path connects them.**
- Runtime pen-test: `prospects` returns **0 rows to anonymous** despite holding 5 real rows.
- `verify_wave1_marketplace_boundary.sql`: **3 PASS**.

**A scraped prospect cannot become a public marketplace record.** This is the acquisition system's most important safety property and it holds three ways.

Suppression enforced in-DB via `private.is_prospect_value_suppressed`; privacy documented at `docs/worker-v2/privacy.md`.
**W-1:** "Planity detection" named in the brief was not found — absent or differently named. **UNVERIFIED.**

---

## 30. Security Infrastructure Findings

| # | Finding | Severity |
|---|---|---|
| **SEC-1** | **No TLS.** Nothing on 443. nginx serves `0.0.0.0:80` plaintext; vhost `fadeup-ip` is IP-based; `PROXY_DOMAIN` is still the placeholder. **JWTs, anon keys, passwords and customer PII cross the network in cleartext.** | **P0** |
| **SEC-2** | **Kong exposed publicly on `0.0.0.0:18100` in plaintext**, bypassing nginx. The HTTPS port (18443) is localhost-only — **the secure port is closed and the insecure one is open.** | **P0** |
| **SEC-3** | `SITE_URL`/redirect URLs point at localhost → email auth unusable (§24 A-1) | **P0** |
| SEC-4 | `FUNCTIONS_VERIFY_JWT=false` globally | P2 |
| SEC-5 | `ENABLE_PHONE_SIGNUP=true` without a provider | P2 |
| SEC-6 | `.env.example`/`.env.local` key-name mismatch | P2 |
| SEC-7 | No migration ledger (§20 M-2) | P1 |
| **SEC-8** | **Anonymous API exposure: ZERO across 20 sensitive tables** | ✅ **VERIFIED SAFE** |
| **SEC-9** | **Tenant isolation enforced at runtime** | ✅ **VERIFIED SAFE** |
| SEC-10 | No `service_role` key in frontend; only URL + anon key | ✅ SAFE |
| SEC-11 | PostgreSQL and pooler bound to `127.0.0.1` only | ✅ SAFE |
| SEC-12 | 70 SECURITY DEFINER functions, 0 without `search_path` | ✅ SAFE |

---

## 31. Test Coverage

**Executed this audit:**

| Suite | Result |
|---|---|
| `vitest run` | ✅ **43 files / 260 tests PASS** (102 s) |
| `npm run build` | ✅ **exit 0**, `tsc -b` clean |
| 23 × `db/tests/verify_*.sql` | ✅ **23/23 ran, exit 0, 0 Postgres errors** |
| Machine assertions within those | ✅ **100 PASS / 0 FAIL** |
| `verify-professional-applications-e2e.mjs` | ✅ **49 PASS / 0 FAIL** |
| Fixture residue afterwards | ✅ **0** — `auth.users` 17 before and after |

**T-1 (P1 — NEW): 18 of 23 "verification" scripts contain no assertions.** Only `verify_wave1_*` (4) and `verify_professional_applications` carry PASS/FAIL markers. The other 18 print query output for a human to read — their own headers say *"Read the output top to bottom"*. **They cannot fail, therefore they do not protect against regressions.** Counting them as "23 passing tests" would be false; I verified `verify_rls.sql` by hand instead (§21).

**T-2 (P0): zero browser E2E.** `@playwright/test` is installed with **no config and no test directory**. Journeys 1, 2, 3, 5 and 6 have no end-to-end proof. 260 unit tests prove components render, not that a customer can book.

**T-3 (P2):** the DB scripts **write to the live database** (seed → commit → cleanup) with `ON_ERROR_STOP off`. They self-cleaned correctly here, but a mid-run failure would leave fixtures behind. They are not safe for CI against production.

---

## 32. Dead Code / Legacy

| Item | Category |
|---|---|
| `search_public_organizations` | **SAFE_TO_REMOVE** |
| `functions/hello` | **SAFE_TO_REMOVE** |
| `@playwright/test` | **REQUIRES_MIGRATION** — configure it rather than remove |
| `/signup`, `/pro/signup`, `/customer/login`, `/customer/signup` | **STILL_REFERENCED** — intentional shims |
| `maplibre-gl` | **STILL_REFERENCED** — Platform acquisition map only |
| `create_organization` | **UNKNOWN** — possibly superseded by `complete_organization_onboarding` |
| `product-previews.tsx:9` stale comment | doc debt |

**No dead pages** — all 67 are routed. **`platform_admins` is NOT dead code** — it was correctly dropped (§20).

---

## 33. Dependency Audit

**Exemplary — no duplicated solutions.**

| Concern | Choice | Duplicate? |
|---|---|---|
| Animation | `motion` v13 | ❌ **no GSAP, no react-spring** |
| Forms | `react-hook-form` + `zod` | ❌ |
| Server state | `@tanstack/react-query` v5 | ❌ |
| UI primitives | Radix | ❌ |
| Icons | `lucide-react` | ❌ |
| i18n | `i18next` + `react-i18next` | ❌ |
| Styling | Tailwind v4 + `clsx` + `tailwind-merge` | ❌ |
| **Date/time** | **NONE** | see DEP-1 |

**DEP-1 (P2):** no date library in a scheduling product; `lib/timezone.ts` is hand-rolled. DST/timezone correctness is a classic trap.
**DEP-2 (P3):** `@playwright/test` unused.

---

## 34. Accessibility Audit

227 `aria-*`, 19 `role=`, 18 reduced-motion references.

**Strengths:** form a11y is correct **at the primitive level** (`text-field.tsx:21-44`), so every form inherits it — the low raw `htmlFor` count is a *good* sign. Radix supplies focus trap/escape/ARIA for dialogs, dropdowns, tooltips, toasts. `prefers-reduced-motion` honored in both CSS and JS. Marketing mockups are `aria-hidden` with visible labels.

- **A11Y-1 (P1):** RTL is document-level only; one component is direction-aware. Arabic layout correctness is unproven.
- **A11Y-2 (P2):** 19 `role=` across 67 pages suggests thin landmark structure.
- **A11Y-3 (P2):** no skip-to-content link.
- **A11Y-4 (P2):** contrast unverified; the 3 un-overridden dark tokens are a concrete risk.

---

## 35. Performance Findings

Build verified. Per-route code splitting works.

| Chunk | Size | Assessment |
|---|---|---|
| `platform-acquisition-map-page` | **955 kB** (248 gz) | maplibre-gl — **lazy, Platform-only**; public users never fetch it ✅ |
| `index` | 287 kB (86 gz) | shell |
| `supabase` | 265 kB (66 gz) | vendor |
| `react` | 121 kB (39 gz) | vendor |
| `business-landing-page` | 48.5 kB | heaviest content route |
| `landing-*` × 10 | 14-22 kB | per-locale, lazy ✅ |

- **PERF-1 (P3):** the 500 kB warning is Platform-only and lazy — correctly architected.
- **PERF-2 (P2):** booking page issues sequential queries (organization → barbers → services → slots) — waterfall risk, unmeasurable with 0 services.
- **PERF-3:** no Platform code loaded for public users ✅.
- **PERF-4 (P3):** no image pipeline (§25 ST-1) — nothing to optimize, which is the problem.

---

## 36-37. Product Journey / Golden Path

| # | Journey | Where it breaks |
|---|---|---|
| **1** | search → barber → service → book → account → confirm → app | **BREAKS IMMEDIATELY AT "service".** Route chain and RPCs exist and the marketplace is runtime-verified — but `services = 0`, so nothing is bookable. Then: no confirmation email (E-2), English-only (I18N-1), signup unusable (A-1), no E2E (T-2). |
| **2** | Live Queue → position → barber → chair → complete | Structurally complete; the only surface with working realtime. `queue_entries = 0`. Breaks on: no turn notification; customer must hold the tab open. |
| **3** | history → Passport → favorite → rebook | Best-built journey; 12 passing passport assertions. `storage.objects = 0` — photos never exercised. |
| **4** | /for-business → register → pending → approval → login → workspace | ✅ **VERIFIED END-TO-END — 49/49.** The only journey proven to work. Residual risk: actual email delivery (E-1). |
| **5** | invite → account → accept → same shop | Exists and location-scoped; `d36c4e0` fixed a wrong redirect. **BREAKS: no invitation email (E-3)** — link must be hand-delivered. |
| **6** | location → services → team → availability → booking → live op | Pages exist. Breaks on: no `/app/settings`; owner and barber share one undifferentiated `/app`; Pro app 0% translated. |
| **7** | applications → organization → acquisition → audit/system | Works (7 rows in `platform_audit_log`). Breaks on: no `users`/`system-health` pages (deliberate); tenant `audit_logs = 0`; notification bell not live (RT-1). |

**Personas:** returning customer is best-served; **shop owner is worst-served** (no owner surface, no invite delivery); receptionist **has no role or surface at all**.

---

## 38. CONFIRMED IMPLEMENTED

| Feature | Evidence |
|---|---|
| **Multi-tenant isolation** | ✅ **RUNTIME** — `verify_rls.sql` cross-tenant reads return `(0 rows)` |
| **Anonymous data protection** | ✅ **RUNTIME** — 0 rows across 20 tables via PostgREST |
| **Professional application workflow** | ✅ **RUNTIME** — e2e 49/49: submit, review, approve, refuse, idempotency, audit, email |
| **Marketplace search** | ✅ **RUNTIME** — anonymous RPC returns real org "7 VIE LA" |
| **RLS coverage** | ✅ **LIVE** — 54/54 with FORCE, 166 policies |
| **SECURITY DEFINER hygiene** | ✅ **LIVE** — 70 functions, 0 without `search_path` |
| **Migration integrity** | ✅ **LIVE** — zero drift |
| **Prospect ↔ marketplace separation** | ✅ **STRUCTURAL + RUNTIME** |
| **Passport (incl. sharing)** | ✅ 12 assertions + hash-verified tokens + `noindex` |
| Design system (25 primitives) | ✅ build + `dialog.test.tsx` |
| i18n public surfaces (10 locales) | ✅ `locale-completeness.test.ts` |
| Centralized pricing | ✅ `plans.test.ts`, `pricing.test.ts` |
| Theme system | ✅ 35/32 tokens + pre-paint bootstrap |
| Three-door auth separation | ✅ 2 guard tests + e2e role assertions |

---

## 39. PARTIAL IMPLEMENTATIONS

| Feature | Exists | Missing |
|---|---|---|
| Booking engine | Full RPC chain, tested | **any bookable service**, confirmation email, i18n, E2E |
| Live queue | Complete + realtime | turn notifications; never used (0 rows) |
| Email | Outbox, dispatcher, 2 templates, leasing proven | invitation + booking templates; real delivery unproven (SMTP :2500) |
| Realtime | queue works | `platform_notifications` not published (RT-1); appointments absent |
| Geo-IP | Edge function written | proxy header — never configured |
| Theme | Both palettes | toggle outside Platform; 3 dark tokens |
| Tenant audit | Table + RLS + indexes | **any writer** (0 rows) |
| RTL | Document `dir` | component-level layout |
| Owner surface | `/app` operations | settings, owner/barber differentiation |
| Marketplace media | `barberAvatarUrl` field | buckets, upload UI (0 storage objects) |
| Acquisition worker | Full pipeline, 5 prospects | at least one invalid source API credential |

---

## 40. MISSING FUNCTIONALITY

**Frontend:** legal pages; `/app/settings`; customer settings; `Checkbox`/`Radio`/`PageHeader`; theme toggle outside Platform; offline/session-expiry UX; bottom nav; consumer map view.
**Backend:** booking-confirmation email; invitation email; queue-turn notification; tenant audit writer; media buckets; reception role.
**Database:** migration ledger; generated TS types.
**Security:** **TLS**; Kong plaintext closure; correct `SITE_URL`/redirect URLs.
**UX:** owner/barber differentiation; `/workspace` auto-forward; role switching.
**Mobile:** device-verified responsive pass; table→card strategy.
**Localization:** Pro app (0/12), public booking (0/4), Platform (2/24); component RTL.
**Platform:** users, system health, support, settings.
**Infrastructure:** domain + certificate; geo header; verified SMTP; backups; observability.
**Testing:** **all browser E2E**; assertions for the 18 non-assertive DB scripts.
**Product:** **actual seed data — services, so that anything is bookable.**

---

## 41. Bug Inventory

| ID | Title | Surface | Sev | Root cause | Evidence |
|---|---|---|---|---|---|
| **B-01** | No TLS; app + Kong plaintext | Infra | **P0** | `PROXY_DOMAIN` placeholder; 443 unbound | `ss`, compose:85 |
| **B-02** | `SITE_URL`=localhost + autoconfirm off → signup/reset links dead | Auth | **P0** | config never updated | `infra/supabase/.env` |
| **B-03** | Zero browser E2E | QA | **P0** | Playwright unconfigured | no config/dir |
| **B-04** | No bookable services in DB → booking impossible | Product | **P0** | never seeded | `services = 0` |
| **B-05** | Booking sends no confirmation email | Booking | **P0** | no template | `email_outbox` |
| **B-06** | Invitation has no email delivery | Owner | **P0** | no template | e2e covers approval only |
| **B-07** | Public booking 0% translated | Booking | **P1** | no namespace | 0/4 pages |
| **B-08** | Pro app 0% translated | Pro | **P1** | no namespace | 0/12 pages |
| **B-09** | Appointments lack realtime | Pro | **P1** | not published | publication list |
| **B-10** | Tenant `audit_logs` has no writer | Platform | **P1** | never implemented | **0 rows live** |
| **B-11** | No migration ledger | DB | **P1** | applied by hand | `supabase_migrations` absent |
| **B-12** | 18 DB scripts have no assertions | QA | **P1** | reports, not tests | 0 PASS markers |
| **B-13** | Legal pages absent | Public | **P1** | not built | router |
| **B-14** | RTL unproven beyond `dir` | i18n | **P1** | 1 component aware | grep |
| **B-15** | **Platform notification bell never live-updates** | Platform | **P2** | table not in `supabase_realtime` | **runtime** |
| **B-16** | Worker source API credential invalid | Acquisition | **P2** | unset/expired key | job `failed` |
| **B-17** | `.env.example` key-name mismatch | DX | **P2** | drift | both files |
| **B-18** | `/pricing` advertises unbuilt Chair Mode | Marketing | **P2** | copy ahead of build | `pricing-page.tsx:24` |
| **B-19** | Hand-written DB types | FE | **P2** | no codegen | `lib/queries/*` |
| **B-20** | `/workspace` forced interstitial | UX | **P2** | no shortcut | router:140 |
| **B-21** | Theme toggle Platform-only | UX | **P2** | not mounted | grep |
| **B-22** | 3 dark tokens un-overridden | Theme | **P2** | incomplete block | 35 vs 32 |
| **B-23** | No `Checkbox`/`Radio`/`PageHeader` | DS | **P2** | not built | `components/ui/` |
| **B-24** | No avatar/portfolio storage | Marketplace | **P2** | 1 bucket only | `storage.buckets` |
| **B-25** | `ENABLE_PHONE_SIGNUP` on without provider | Auth | **P2** | config | `.env` |
| **B-26** | `FUNCTIONS_VERIFY_JWT=false` globally | Edge | **P2** | config | `.env` |
| **B-27** | No date library in a scheduling product | FE | **P2** | hand-rolled | `package.json` |
| **B-28** | No session-expiry/offline UX | UX | **P2** | no interceptor | `auth-context.tsx` |
| **B-29** | `search_public_organizations` orphaned | DB | **P3** | superseded | set-diff |
| **B-30** | `hello` edge function unused | Infra | **P3** | scaffold | volumes |
| **B-31** | Stale comment claims only auth built | Docs | **P3** | not updated | `product-previews.tsx:9` |
| **B-32** | HEAD on `backup/…`, diverged from `master` | Repo | **P3** | workflow | `git branch -vv` |

---

## 42. Technical Debt Register

1. **No migration ledger** — drift is zero today by discipline alone; nothing structural prevents it (B-11).
2. **Triple identity model** (`profiles`/`customer_profiles`/`customers`) — produced one account-takeover vector (`610d417`); now assertion-covered but still the most complex area.
3. **Hand-maintained DB types** — no compile-time protection.
4. **18 non-assertive DB scripts** presented as a test suite.
5. **DB scripts write to the live database** with `ON_ERROR_STOP off` — unsuitable for CI as-is.
6. **No CI configuration at all** — everything is run by hand.
7. **No date/time library.**
8. **`/s/:slug` scheme** undocumented and SEO-weak.
9. **Documentation drift** — `docs/wave-1/PROGRESS.md`, `docs/pro-onboarding/PROGRESS.md` are completion narratives.
10. **Marketing ahead of implementation** (Chair Mode).

---

## 43. Preserve / Rebuild / Delete

| System | Verdict |
|---|---|
| `apps/web` | **KEEP** — clean, builds, 260 tests pass |
| `apps/web-v2` | **N/A — does not exist**; do not create one |
| Design system | **KEEP + EXTEND** (3 primitives) |
| Data layer | **KEEP + REFACTOR** (generated types) |
| Marketplace queries | **KEEP** — runtime-verified honest |
| Booking engine | **KEEP + COMPLETE** — code is fine; it needs data, email, i18n, E2E |
| Queue engine | **KEEP** |
| Fade Passport | **KEEP** — strongest feature |
| Professional applications | **KEEP** — only end-to-end-proven workflow |
| Invitations | **KEEP + COMPLETE** (email) |
| Platform | **KEEP** |
| Worker/acquisition | **KEEP** — isolation proven three ways |
| i18n | **KEEP + EXTEND** |
| Geo pricing | **KEEP** — needs proxy header only |
| **RLS / auth model** | **KEEP — do not touch.** Proven correct at runtime |
| `hello`, `search_public_organizations` | **DELETE** |
| Backup-branch workflow | **DEPRECATE** |

---

## 44. Supabase Remaining Work

**Before V1:** replace `SITE_URL`/`ADDITIONAL_REDIRECT_URLS` with the real domain (B-02); add `platform_notifications` to `supabase_realtime` (B-15); add `appointments` to it (B-09); add booking + invitation templates and enqueue points (B-05, B-06); **seed at least one organization with real services** (B-04); introduce a migration ledger (B-11); verify SMTP actually delivers (E-1); create media buckets (B-24); implement a tenant `audit_logs` writer (B-10).
**Before scale:** `EXPLAIN` marketplace search under volume (earthdistance/cube, no PostGIS); realtime connection budgeting; outbox throughput; backup/PITR verification; observability.
**Nice-to-have:** drop `search_public_organizations`; generate TS types in CI; rotate the invalid worker source credential (B-16).

---

## 45. Frontend Remaining Work

**Foundation:** generated DB types; CI; Playwright harness.
**Public:** legal pages; map view; document `/s/` scheme.
**Customer:** settings; session-expiry + offline UX.
**Pro:** full i18n (12 pages); appointments realtime; mobile table strategy.
**Owner:** `/app/settings`; owner/barber differentiation; reception role.
**Platform:** users/system-health/support surfaces; i18n (22 pages).
**Theme:** toggle everywhere; 3 dark tokens; 1 hardcoded color.
**i18n:** namespaces for `public-*`, `app-*`, `platform-*`; component RTL.
**Geo/pricing:** proxy header; remove Chair Mode claim.
**Responsive/A11y:** device pass; skip link; landmarks; contrast.
**Perf:** measure booking waterfall once data exists.

---

## 46-48. V1 Blockers — TOP 10

| # | Blocker | Affects | Fix | Depends on |
|---|---|---|---|---|
| **1** | **No TLS; plaintext auth tokens** (B-01) | Everyone | Domain + cert; bind 443; close Kong `:18100` | DNS |
| **2** | **`SITE_URL` localhost → signup & reset dead** (B-02) | Every new user | Real domain in `SITE_URL` + redirect URLs | #1 |
| **3** | **No bookable services** (B-04) | Customers, shops | Seed/allow real service creation; verify a booking completes | — |
| **4** | **No booking confirmation email** (B-05) | Customers | Template + in-transaction enqueue; verify delivery | #2 |
| **5** | **No invitation email** (B-06) | Owners, barbers | Template + enqueue | #4 |
| **6** | **Zero browser E2E** (B-03) | Everyone | Configure Playwright; cover Journeys 1, 2, 5 | #3 |
| **7** | **Public booking English-only** (B-07) | Non-EN customers | `booking` namespace × 10 locales | — |
| **8** | **Legal pages absent** (B-13) | Legal/GDPR | `/terms`, `/privacy` | content |
| **9** | **Pro app English-only** (B-08) | Barbers, owners | `pro` namespace × 12 pages | — |
| **10** | **No owner surface** | Owners | `/app/settings`; role differentiation | product design |

### Minimum Shippable V1 — MUST work
Customer discovery · **public booking that actually completes, with confirmation email, in FR+EN** · Live Queue + walk-in · customer account · barber operations in the shop's language · shop setup with **real services** · **invitations delivered by email** · professional approval (already proven) · basic Platform admin · **TLS** · **E2E on all of the above**.

### CAN WAIT
Passport photos/sharing (built and good — not launch-gating) · memberships · waitlist · acquisition worker (internal) · Platform users/system-health/support · Chair Mode (**remove from pricing until built**) · map view · 8 of 10 locales · component RTL · wallet, loyalty, referral, payments, tips, commissions, products, inventory (**none started, none should be**).

---

## 49. Scale Risks (NOT V1 blockers)

**~100 salons:** `search_public_professionals` plan under real volume (earthdistance/cube, no PostGIS, no spatial index); single-dispatcher outbox throughput; **no observability** — failures will be reported by customers first.
**~1,000:** realtime connection ceiling (one channel per org); acquisition API quotas (`api_source_limits` exists — good); `audit_logs`/`platform_audit_log` growth without partitioning; no read replicas; support tooling limited to one session mechanism.
**~10,000:** single-region Postgres; no partitioning/sharding plan; Kong single gateway; passport-photo storage lifecycle; noisy-neighbor isolation.

---

## 50. Final CTO Scorecard

| Dimension | Score | Justification |
|---|---|---|
| Product completeness | **5/10** | Every surface exists; **zero services means the core transaction cannot occur** |
| Frontend architecture | **8/10** | Centralized queries, zero RPC drift, clean deps, lazy routes; hand-written types |
| UI quality | **7/10** | One token system, 25 primitives, no clichés; no imagery |
| UX quality | **6/10** | Strong state ladder and auth separation; `/workspace` friction, no role switching |
| Mobile readiness | **4/10** | Correct primitives but unverified; table-heavy; no bottom nav |
| Backend architecture | **9/10** | 54 tables, clean domains, perfect definer hygiene, verified live |
| Database quality | **8/10** | Zero drift, 182 indexes, deliberate FK semantics; triple identity complexity; no ledger |
| **RLS / security** | **9/10** | **54/54 FORCE RLS, 0 anonymous leakage, tenant isolation runtime-proven.** −1 for no live verification of every role combination |
| Auth | **6/10** | Excellent three-door architecture, **crippled by localhost `SITE_URL`** |
| Marketplace | **7/10** | Runtime-verified real data, no fabrication; no imagery, no map |
| Booking | **3/10** | Code and RPCs are sound; **nothing is bookable, no email, no E2E** |
| Live Queue | **6/10** | Only surface with working realtime; never used |
| Fade Passport | **8/10** | Private bucket, hashed share tokens, `noindex`, 12 assertions |
| Pro operations | **5/10** | Broad but 0% translated, no appointment realtime |
| Platform Owner | **6/10** | Solid and honest; blind on tenant audit; dead notification bell |
| i18n | **5/10** | 10 locales, parity-tested — marketing only; conversion path untranslated |
| Geo / pricing | **6/10** | Pricing centralized and correctly decoupled; geo inert |
| Testing | **5/10** | 260 unit + 149 DB/e2e assertions genuinely pass; **zero browser E2E**; 18 fake "tests" |
| Performance | **7/10** | Correct splitting, per-locale bundles, no public heavy chunks |
| Production readiness | **2/10** | No TLS, broken auth URLs, no bookable data, no E2E, no CI |

---

## 51. FINAL VERDICT

**Can FadeUp be used today by a real customer?** — **NO.**
Not "partially": a customer cannot complete signup (confirmation links point to `127.0.0.1`), and cannot book anything (`services = 0`). Discovery works and is runtime-verified, but the funnel terminates immediately after it.

**Can FadeUp be used today by a real barber?** — **PARTIALLY.**
All twelve operational pages exist and are query-backed, and an approved professional provably reaches their workspace (e2e 49/49). But they work in English regardless of locale, on a screen that never live-updates for new appointments, with no appointments to see.

**Can FadeUp be used today by a real shop owner?** — **NO.**
No owner surface, no business settings, and invitations cannot be delivered — staff onboarding requires hand-copying links. A five-barber shop cannot be set up.

**Can FadeUp be administered safely by Platform Owner?** — **PARTIALLY.**
Applications, organizations, acquisition and platform audit work, and the approval workflow is the best-proven part of the product. But the notification bell is silently dead, tenant `audit_logs` is empty, there is no system-health surface, and all administration happens over plaintext HTTP.

**Ready for 5 pilot salons?** — **NO.**
Blocked by TLS (#1), dead auth links (#2), nothing bookable (#3), and no invitation email (#5). A pilot salon cannot be onboarded, cannot invite staff, and cannot take a booking.

**Ready for public launch?** — **NO.**
All ten blockers, plus absent legal pages and zero browser E2E on any revenue path.

**Should the current legacy frontend be preserved?** — **YES.** It is not legacy; it is the only frontend, it is clean, it builds, and its tests pass.

**Should frontend V2 continue?** — **N/A.** There is no V2 and none is needed. Building one would discard a sound codebase.

**Should the backend be rebuilt?** — **NO.**
This audit's strongest finding is that the backend is *provably* correct: zero drift, 54/54 FORCE RLS, zero anonymous leakage, tenant isolation demonstrated at runtime, 70/70 definer functions safe. **Rebuilding it would destroy the most valuable asset in the repository.** It needs configuration and completion, not replacement.

### The five most important next actions

1. **Fix the front door: domain + TLS certificate, bind 443, close plaintext Kong `:18100`, and set `SITE_URL`/`ADDITIONAL_REDIRECT_URLS` to the real host.** This single action resolves blockers #1 and #2 and is the difference between "demo" and "deployable".
2. **Make one shop genuinely bookable end-to-end** — create real services for a real organization and drive one booking through `book_public_appointment` to a confirmed appointment. Everything downstream is untestable until a single row exists in `services`.
3. **Close the transactional email loop** — booking-confirmation and invitation templates enqueued in-transaction, and prove real delivery (current `SMTP_PORT 2500` suggests a dev catcher, not a mail provider).
4. **Configure Playwright and cover Journeys 1, 2 and 5.** Journey 4 is already proven at the data layer; the rest have no end-to-end evidence at all.
5. **Translate the conversion and operator paths** (`public-*` 0/4, `app-*` 0/12) and **remove the Chair Mode claim from `/pricing`** until it exists.

---

*Revised 2026-08-17 against `fa87b18`. Evidence: 260 frontend tests executed, production build executed, live PostgreSQL 17.6 introspected, 23 DB scripts executed (100 assertions), 1 e2e script executed (49 assertions), anonymous API penetration test across 20 tables. Docker and browser evidence unavailable; every such claim is marked. No repository file was modified.*
