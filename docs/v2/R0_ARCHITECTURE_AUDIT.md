# R0 — Architecture Audit

Date: 2026-08-25 · Branch `rebuild/social-first-v2` @ `34d375a` · 61 migrations
Method: read-only. Full migration chain replayed into a disposable PostgreSQL
17 container and introspected from `pg_catalog`; application layer read from
source; both test suites executed.

---

## 0. Provenance and how to weight this document

**This is a reconstruction.** The R0 artifacts named in the R1 brief were never
committed — `git log --all -- docs/v2` is empty. Nothing here is recovered from
a prior R0; it is derived from the repository as it stands.

Three independent agents produced the evidence, each in its own context, each
given open questions rather than conclusions:

| Source | Scope |
| --- | --- |
| **DB** | schema, migrations, constraints, indexes, RLS shape, conventions |
| **SEC** | auth, tenancy, policy behaviour, exploit verification |
| **APP** | repo structure, data-access surface, routes, features, tests, docs |

Findings are marked **PROVEN** (executed against a live schema) or **RISK**
(reasoned from source). Where this document departs from an agent's conclusion,
it says so and why.

> **Honest limitation.** The synthesis was performed in a context that had
> previously attempted an R1 implementation. The *evidence* is independent; the
> *arrangement* of it is not. A fresh-context evaluation follows this document
> precisely to counterweight that.

---

## 1. What FadeUp is today, in numbers

| | |
| --- | --- |
| Tables in `public` | **89** base + 5 views |
| Migrations | 61 files, 17,516 lines |
| RLS enabled **and forced** | **89 / 89** |
| Policies | 282 → 235 `authenticated`, 47 `prospect_worker`, **0 `anon`**, **0 `PUBLIC`** |
| `SECURITY DEFINER` functions | 115, **all** with `search_path=''` |
| Anon-callable RPCs | 16 |
| Enum types | 42 |
| Indexes | 296 |
| Frontend | 442 files, 72 RPCs, 74 tables touched, 578 tests (all pass) |
| Worker | 133 files, 217 tests (all pass), 6 source adapters |
| CI | **none** |

**51 of 89 tables (57%) are the acquisition machine**, not the product. They
carry no `organization_id` and are structurally disjoint from the tenant graph
— which means a professional-identity change cannot break them.

---

## 2. The three things that are genuinely good

Stated first, because they constrain the design more than the defects do.

**RLS is complete and forced.** 89/89, zero anon policies, zero unpinned definer
functions, all views `security_invoker`. Cross-tenant read/write was tested
exhaustively across twelve tables and returned **0 rows in every cell**;
cross-tenant row relocation is rejected by `WITH CHECK`. This is unusual and
must not be weakened.

**The public-data convention is disciplined.** Public data is never a policy; it
is always a narrow `SECURITY DEFINER` RPC that resolves the tenant from a slug,
re-derives every eligibility predicate server-side, and returns a hand-curated
column list. New public surfaces must follow it literally.

**The security history is honest.** `20260813150000` and `20260813160000`
document real takeover vectors, reproduce them step by step, and record what was
rejected and why — including refusing a fix whose safety depended on an env var,
on the grounds that *"an identity control whose safety silently depends on an
env var being in the right position is not a control."* That is the standard new
work is held to.

---

## 3. The defects that shape the target model

### D-1 · CRITICAL · PROVEN — contact-detail squatting

An attacker plants a victim's phone or email on a `customers` row the attacker
owns; the victim's later anonymous booking is matched to it by
`link_customer_from_contact_info()` on `(organization_id, phone)`, then
`lower(email)`. The attacker then reads the victim's booking via
`get_my_appointments()` and cancels it via `cancel_my_appointment()`.

Proven through `book_public_appointment` and `join_public_queue`; via phone
and, case-insensitively, via email. No rate limiting exists anywhere in nginx
or the database.

> **Correction (independent review).** An earlier revision of this document
> also claimed the vector through `waitlist_entries`. **That is false and has
> been withdrawn.** `waitlist_entries_insert` requires
> `has_org_role(owner/manager/receptionist)`, there is no `anon` policy, and no
> public RPC reaches it — `apps/web/src/lib/queries/waitlist.ts` runs only
> under `/app/*` as staff tooling. A customer or anonymous visitor cannot reach
> the linking trigger through waitlist at all. The same trigger firing on a
> staff-created waitlist row is a data-hygiene footgun, not a customer-facing
> takeover vector, because staff already hold full CRM read/write in their own
> org. **R1A must not change waitlist on the strength of this finding.**

`20260813160000` closed the *other* direction — an attacker adopting a victim's
existing row. It did not close this one.

**Consequence for the target model:** `customers.user_id` is a *convenience
bridge*, not evidence. It cannot be a verification predicate.

### D-2 · CRITICAL · PROVEN — deleting a barber destroys the service record

`appointments.barber_id` is `NOT NULL ON DELETE CASCADE`. Removing one `barbers`
row permanently erases that professional's entire appointment history, including
completed revenue-bearing appointments, with no tombstone and no soft-delete
column. Deleting an *organization* cascades to 24 tables and erases every
professional identity and every service history inside it.

**Consequence:** a durable professional identity is worthless if the evidence it
depends on is deletable as a side effect of roster management. Any identity work
must fix the cascade, not merely add a table beside it.

### D-3 · HIGH · PROVEN — completion is not trustworthy state

* `appointments` has **no `completed_at`**. Completion time lands in
  `decided_at`, a column shared with approve and cancel, and deliberately left
  NULL by auto-confirm.
* `queue_entries.called_at` / `service_started_at` / `completed_at` are
  **written by the browser** (`apps/web/src/lib/queries/queue.ts:183-186`). No
  trigger, no CHECK ties any of them to `status`.
* **No transition guard exists at table level.** `complete_appointment()`
  enforces `confirmed → completed`, but `appointments_update` lets
  owner/manager/receptionist PATCH any status directly, and
  `appointments_update_self` + `restrict_appointment_self_update` let the
  assigned barber set *any* status — that trigger constrains which *columns*
  change, never which *transitions*.
* `restrict_appointment_self_update` freezes twelve columns but **not
  `customer_id`**, so a barber can re-point an appointment at another CRM row in
  the same org.

**Consequence:** "this customer was served by this professional" is currently
assertable by any staff member with a PATCH. Verified-client status cannot be
built on `status = 'completed'` alone.

### D-4 · HIGH · PROVEN — the typechecker cannot see the database

`apps/web/src/lib/supabase.ts:13` calls `createClient()` with **no `Database`
generic**, so every table and RPC is `any`. There is no `supabase gen types`
script anywhere. ~74 row shapes are hand-written interfaces applied with `as`.
The 578 tests mock `@/lib/supabase` fourteen times and assert against fixtures
shaped like those same hand-written interfaces.

**A renamed column or changed RPC return shape typechecks clean, lints clean,
passes all 578 tests, and fails in production.**

**Consequence:** "typecheck and tests pass" is not evidence of schema
compatibility. Compatibility must be demonstrated by database-level tests and by
reading the ~25 direct-write call sites.

### D-5 · HIGH · PROVEN — a professional cannot control their own public page

`staff_profiles_update` requires owner/manager. The barber **cannot edit their
own profile**, and no RPC lets them. Yet `get_public_barber` serves their
`display_name`, `title`, `bio`, `avatar_url` and location to the anonymous
internet, gated on `is_public`/`is_bookable`/`is_active` — three switches the
*shop* controls.

So a shop can publish a named person to the open internet and that person has no
technical means to edit or retract it. `avatar_url` is unconstrained free text
rendered in every visitor's browser.

**Consequence:** a public professional profile must not be built on
`staff_profiles`. Whatever holds public professional data must be writable by
the professional.

### D-6 · HIGH · PROVEN — no shop-independent professional address

The public professional URL is `/s/:slug/barbers/:barberId` — a raw `barbers.id`
UUID nested under the shop's slug, also embedded in deep links
(`public-barber-page.tsx:116-117`). The shop got a human-readable global slug;
the professional did not. A professional who leaves a shop has **no surviving
public address**.

Internally the same person is addressed by a *different* UUID —
`staff_profiles.id` at `/app/team/:staffProfileId/workspace`.

**Consequence:** this is a direct conflict with Constitution §1. It cannot be
resolved by adding a table alone; it requires a professional-level public
identifier and a compatibility mapping for existing links.

### D-7 · HIGH · PROVEN — pre-existing exposures unrelated to identity

Recorded so they have owners; none is introduced by the social work.

| | Finding |
| --- | --- |
| SEC-1 | `professional_applications.internal_note` is readable by the applicant it describes. The RPC omits it, but a row-level SELECT policy plus table-wide grants means one `.select('internal_note')` returns it. |
| SEC-2 | The cold-outreach worker can read **every tenant's** transactional email stream. `email_outbox` has no tenant anchor and carries `grant select … to prospect_worker` + `using (true)`. `private.claim_next_email()` already returns the claimed rows, so the grant is pure over-grant. |
| SEC-3 | **MEDIUM (downgraded).** Kong is published on `0.0.0.0:18100` (confirmed on the live container), so Studio and pg-meta are reachable directly, bypassing nginx's TLS, path allow-list and rate limiting. It is **not** an unauthenticated data exposure: Studio carries `basic-auth`, pg-meta `key-auth` + an `admin` ACL, `/mcp` is terminated, and the real `.env` is git-ignored and not the default placeholder. The risk is lost defence-in-depth and credential-stuffing surface. One-line fix: bind to `127.0.0.1`. |
| SEC-4 | **WITHDRAWN — disproved by independent review.** Every acquisition RPC examined (`create_prospect_discovery_job`, `cancel_prospect_job`, `set_prospect_source_enabled`, `approve_outreach_template`, `promote_ml_model`, `set_outreach_campaign_status`, `classify_outreach_reply`, `override_prospect_locale`, `override_prospect_booking_provider`) opens with `if not (select private.is_platform_admin()) then raise exception`. The coarse `GRANT EXECUTE … TO authenticated` is a style issue, not a vulnerability. **Replacement finding (LOW):** `prospect_effective_locale(uuid)` is `SECURITY DEFINER`, granted to `authenticated`, and has **no** role check — any signed-in user can confirm whether a UUID is a valid prospect and read its locale. No PII, no mutation. Fix: add the gate or drop the grant. |
| SEC-5 | `customers.notes` — shop-internal — is readable by role `barber`, because `customers_select` uses `is_org_member` rather than `has_org_role`. |
| APP-1 | The worker renders six booking email templates through a two-branch boolean. The moment SMTP is enabled, a customer whose booking is **confirmed** receives *"About your FadeUp application — Unfortunately we are not able to approve it."* |
| APP-2 | `platform_notifications` was never added to the realtime publication and its query has no polling fallback, so the staff bell is inert. |

### D-8 · HIGH · PROVEN — identity-forgery primitive

*(Raised from MEDIUM after independent review. The database reviewer's
compositional argument is decisive and I accept it: chained with D-1 and D-3,
this gives a single dishonest owner/manager a low-effort path to fabricate a
complete, internally consistent "verified client" record about a real, named
victim who was never served. The security reviewer's cap still holds —
cross-tenant **row** relocation is correctly blocked by `WITH CHECK` — but
cross-tenant **identity** assertion is not.)*

`customers_update`'s `WITH CHECK` constrains only `organization_id`. Any
owner/manager/receptionist can set `customers.user_id` to any `auth.users` id,
and no trigger freezes it. Cross-tenant relocation *is* correctly blocked.

Blast radius is confined to that shop today. It matters because anything later
built on "this `customers` row belongs to this account" inherits a forgeable
premise.

### D-9 · MEDIUM · PROVEN — orphaned bookable barbers, and a missing index

* Deleting a `membership` does **not** remove `staff_profiles`/`barbers`. There
  is no `ON DELETE` trigger. The barber stays bookable and stays in marketplace
  search with no membership at all.
* Nothing prevents the last owner leaving an organization —
  `20260809100400_memberships.sql` documented this and it is still true.
* `staff_profiles` has **no index on `user_id` alone** (the only covering index
  leads with `organization_id`). Confirmed `Seq Scan`. That is precisely the
  query *"which professional identities does this person have across all
  shops?"* — the foundational query of any cross-org professional model.
* `search_public_professionals` INNER-joins `locations` on
  `staff_profiles.location_id`, so a professional with a NULL location
  **vanishes from search** while remaining visible on the shop page, which
  LEFT-joins.

---

## 4. Where a convention claim needed correcting

Two points where this document departs from an agent's conclusion.

**Column-level protection is achievable.** SEC concluded that column ACLs "could
not work" because `anon`/`authenticated` hold table-wide grants that subsume
them. That is true only while the table-level grant remains. Revoking
`SELECT`/`UPDATE`/`INSERT` at table level and re-granting the permitted columns
does work, and is verifiable with `has_column_privilege`. It is the **only**
mechanism that protects a column against `SELECT` — the established
`is distinct from` freeze trigger covers `UPDATE` only, which is exactly why
SEC-1 exists. Any new table with a server-owned column should use
revoke-then-regrant *and* a freeze trigger.

**Enums vs text+CHECK.** DB reports 42 enum types and that state machines are
enums. That is the dominant convention and new state machines should follow it,
*except* where a value set is expected to grow often —
`20260809100400_memberships.sql` documents the `alter type … add value` cost
itself, and `profiles_locale_valid` / `profiles_theme_valid` are the existing
text+CHECK precedent. Rule for new work: **enum for closed sets, text+CHECK for
sets expected to grow, and state the choice in the migration.**

---

## 5. KEEP / EXTEND / REFACTOR / REPLACE / REMOVE

| Subsystem | Verdict | Evidence and reasoning |
| --- | --- | --- |
| **auth** | **KEEP** | Anon-key-only frontend, no secret reachable from `apps/web/src`. `authenticator` is not a member of `prospect_worker`/`fadeup_scheduler`, so no JWT reaches those roles. Three-front-door split works. |
| **RLS** | **KEEP** + targeted EXTEND | 89/89 forced, 0 anon policies, proven cross-tenant denial. Extend: freeze `customers.user_id` (D-8); freeze `appointments.customer_id` (D-3). |
| **tenancy** | **KEEP** + one REFACTOR | Uniform via two helpers over `memberships`. Refactor: `email_outbox` is the only business table with no tenant anchor (SEC-2). |
| **customer identity** | **KEEP `customer_profiles`, REPLACE the resolution mechanism** | The private/portable split is correct and documented. What must go is identity-by-unverified-contact-detail (D-1). |
| **professional / staff identity** | **REPLACE** | The core finding. A professional *is* an org-scoped `staff_profiles` row with a 1:1 `barbers` marker: two shops ⇒ two unrelated UUIDs; public URL nested under the shop; deleting the barber cascades away the appointment history; `get_my_access` answers "am I a professional" from `memberships`, i.e. from authorization. |
| **shop / location / organization** | **REFACTOR** | "Shop" means `organizations` in the URL, `organizations × locations` in search, `locations` in booking. Multi-location is structurally possible but defeated by one-primary-location-per-professional and the INNER-join disappearance. |
| **memberships** | **KEEP** | Clean `(user, org) → role`. Stop overloading it as the answer to "is this person a professional". Add last-owner protection and delete semantics (D-9). |
| **services** | **KEEP** | Correct, org-scoped, consistency-triggered, indexed. |
| **public profiles** | **REFACTOR** | The RPC *philosophy* is right and must be preserved verbatim; the *identity* they expose is wrong (D-5, D-6). |
| **marketplace** | **EXTEND** | Capable — geo via GiST, `unaccent`, price/radius/open-now, windowed count. But nothing to rank by beyond distance and name, and no way to represent an unclaimed professional. |
| **booking** | **EXTEND** | Concurrency core is excellent (GiST exclusion constraints, server-side window re-derivation) — do not touch. Add `completed_at`, a transition guard, and break the barber cascade. |
| **queue** | **EXTEND** | Works and is realtime-published, but timestamps are browser-written with no CHECK, and nothing expires a `waiting` row. |
| **reviews** | **REPLACE (build from nothing)** | Do not exist: no table, column, RPC, route, enum or policy. `prospects.rating` is a scraped third-party aggregate about non-users. **Prerequisite:** reviews are meaningless until completion is trustworthy (D-3) and identity is durable (D-2). |
| **Fade Passport** | **KEEP** | The cleanest subsystem: strict `user_id = auth.uid()`, hashed revocable share tokens, private bucket scoped by folder, and internal-notes separation enforced *structurally* by never modelling staff-writable columns. Full UI exists. No wallet anywhere. |
| **social graph** | **NEW** | Nothing exists. Favorites is a private bookmark, not a graph. Note it is **not tenant-scoped**, so it cannot use `is_org_member`. |
| **verified customer relationships** | **NEW, and blocked** | Nothing exists, and the natural predicate (`customers.user_id`) is forgeable two ways (D-1, D-8). |
| **verified public profiles** | **NEW** | No verification flag, badge or trust signal anywhere. |
| **analytics** | **NEW (build)** | **Zero** tracking calls. No PostHog/GA/Segment/Sentry/`sendBeacon`. Clean sheet. |
| **notifications** | **KEEP in-app, REPLACE email rendering** | In-app model is sound (transactional, `dedupe_key`, owner-scoped). Email rendering is broken (APP-1). No push. No SMS — correct per Constitution §7. |
| **subscriptions / entitlements / billing** | **NEW (build)** | **Zero** occurrences of "stripe" in `src` or `db/migrations`. `lib/commerce/plans.ts` is a display matrix that gates nothing; `?plan=` is discarded at registration. |
| **Worker** | **KEEP, frozen** | Mature and isolated: SKIP-LOCKED queue, SSRF guard, real ML inference, honest mock fallbacks, 217 tests. Pipeline is complete through CANONICAL PROSPECT and stops there. One coupling to fix: it owns `email_outbox` delivery for the whole product. |
| **claim flow** | **NEW** | Every `%claim%`/`%token%` column across all 89 tables was enumerated. There is no prospect claim token, no claims table, no `claimed_by`. The `claim_started`/`claim_completed` outreach enum values are outcome labels nothing produces. `prospects.converted_organization_id` is read twice and **written by nothing**. |
| **realtime** | **KEEP abstraction, REFACTOR 2 call sites, FIX 1 bug** | `lib/realtime.ts` is well designed — event as signal only, always invalidate-and-refetch. Two call sites hand-roll channels. `platform_notifications` is not published (APP-2). |
| **i18n / RTL** | **KEEP** | 10 locales × 10 namespaces with parity enforced, pre-paint `dir` bootstrap, `--fu-dir` motion mirroring, and **eight executable gates that assert on source files rather than mocks** — the strongest tests in the repo. |
| **design system** | **KEEP** | 35 token-driven primitives, one `@theme` contract, full dark palette, no ad-hoc hex. Healthiest layer. |

---

## 6. Documentation reliability

The brief warned against trusting old audits. It was right.

| Document | Verdict |
| --- | --- |
| `docs/frontend-v2/migration-map.md` | **Trust.** Routes, hooks, realtime, RBAC and deletions all match code. |
| `docs/pro-onboarding/PROGRESS.md` | **Trust.** Route map verified including compatibility redirects. |
| `docs/worker-v2/*` | **Trust.** Architecture, queue mechanics, source list all match. |
| `docs/audits/FADEUP_*_2026-08.md` | **Trust the method, not the state.** Evidence-based but pre-date the V2 work: realtime publication, calendar and i18n findings are all now fixed. Still true: B-15 (inert platform bell), B-03 (no E2E), B-18 (Chair Mode sold, not built), B-13 (no legal pages). |
| `docs/architecture.md` | **Do not rely on.** Stops at LOT 13. Says light-only (dark theme exists), copper accent (it is emerald), no deep-linking (it exists), 46 tests (578), and documents the wrong Dockerfile. |
| `docs/database.md` | **Do not rely on.** Stops at LOT 13, documents ~30 of 89 tables, states "no customers table yet". |
| `docs/testing.md` | **Do not rely on.** Claims a smoke test only; there are 578 tests. Its "no Playwright config" claim is still accurate. |
| `docs/design-2026/design-system.md` | **Partly stale.** Says `motion` is unused (10+ importers) and references a `components/marketplace/` directory that no longer exists. |

---

## 7. What this audit changes about the plan

1. **A durable professional identity is necessary but not sufficient.** Without
   fixing D-2 (the barber cascade) and D-6 (no shop-independent address), a new
   identity table is a container for data that remains deletable and
   unaddressable.
2. **Verified Client cannot ship on today's evidence.** D-1, D-3 and D-8 mean
   completion is assertable by staff and identity is squattable. Either the
   evidence chain is hardened first, or verified-client is scoped to the one
   path that is forgery-resistant, and the limitation is stated in the product.
3. **"Typecheck + tests pass" proves nothing about schema compatibility** (D-4).
   Compatibility evidence must come from database-level tests and from reading
   the ~25 direct-write call sites.
4. **Worker needs no restructuring** — stages 1–4 are production quality. Only
   public eligibility, external profile and claim are missing.
5. **Six pre-existing security findings need owners** (D-7, D-8) independently of
   the social work.
