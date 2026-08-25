# R1 — Domain Decisions

Status: proposed (Phase 2)
Branch: `rebuild/social-first-v2`
Date: 2026-08-24

This document records, for every domain concept R1 touches, what already
exists, what R1 decides, and why. It is the schema decision record required
by the R1 mission §80.

---

## 0. Pre-flight discrepancies

These are recorded here and in `R1_IMPLEMENTATION_REPORT.md` because the
mission's stated inputs did not match the repository.

### D1 — R0 artifacts do not exist

`docs/v2/` did not exist on this branch, on `main`, or in **any** commit
reachable from `--all`. None of `R0_ARCHITECTURE_AUDIT.md`,
`PRODUCT_CONSTITUTION.md`, `TARGET_DOMAIN_MODEL.md`, `MIGRATION_STRATEGY.md`,
`ENTITLEMENTS_DRAFT.md`, `ANALYTICS_DRAFT.md` or `ROADMAP.md` was ever
committed.

Per mission §4, R1 did **not** invent missing database facts and did not
re-run a full R0 audit. Instead the domain model below was derived from
read-only evidence: the 61-migration chain replayed into a disposable
PostgreSQL 17 container, introspected directly. Where this document states a
fact about the existing schema, that fact came from `pg_catalog`, not from
documentation.

### D2 — the live dev database is down (pre-existing)

`fadeup-supabase-db` accepts TCP connections but every backend fails:

```
FATAL: could not open file "global/pg_filenode.map": Permission denied
```

First occurrence `2026-08-21 00:50:14 UTC`, ~159,000 occurrences since. That
is 3.5 days before R1 started and coincides with the pre-existing commit
`34d375a chore: checkpoint before FadeUp social-first V2 rebuild`. It affects
every client (PostgREST `authenticator`, `supabase_admin`, storage, local
psql), which is why `fadeup-supabase-rest` reports unhealthy.

R1 did not cause it and does not fix it — it is a container/volume
permission fault, outside a domain+database lot's scope, and mission §73
forbids R1 from touching production anyway. **Consequence:** R1 is verified
against disposable containers built from the migration chain, not against the
dev stack, and live end-to-end application verification is not possible in
this lot. See `R1_IMPLEMENTATION_REPORT.md` §22.

### D3 — no generated database TypeScript types exist

Mission §65 asks R1 to regenerate the project's canonical DB types. There is
no such artifact: `apps/web/src/lib/supabase.ts` creates an **untyped**
`SupabaseClient` (no `Database` generic), there is no `database.types.ts`,
and `package.json` has no `supabase gen types` script.

R1 does not introduce a codegen pipeline (mission §94 — respect existing DB
access conventions; adding one is new tooling outside this lot and would
touch every call site). Because every R1 schema change is **additive**, there
is no TypeScript fallout to fix and no `any` escape hatch is needed (§66).
Flagged for R2 as a genuine gap.

### D4 — there is no reviews table

Mission §50 requires that reviews must not break. `information_schema` reports
zero tables matching `%review%` in `public`. Reputation history does not yet
exist in FadeUp, so there is nothing to orphan. `prospects.rating` /
`prospects.review_count` are *scraped external* aggregates about a prospect,
not FadeUp-native reviews, and R1 does not touch them.

---

## 1. Method notes

Two repository conventions govern everything below, both discovered rather
than assumed:

1. **Public data is exposed through narrowly-scoped `SECURITY DEFINER` RPCs,
   never through broad anonymous `SELECT` policies.** Every existing
   anon-facing read (`get_public_barber`, `search_public_professionals`,
   `get_shared_passport`, …) follows this shape: `security definer`,
   `set search_path = ''`, curated columns, `revoke ... from public`,
   `grant ... to anon, authenticated`. R1 follows it exactly. This already
   satisfies mission §54's public-projection principle.
2. **Tenant-consistency invariants are enforced by `BEFORE` triggers, not only
   by RLS `WITH CHECK`**, so they hold for `service_role` and direct SQL too
   (see `check_staff_profile_location_consistency`,
   `check_barber_staff_profile_consistency`). R1 follows this for its own
   cross-table invariants.

All 89 existing tables have `relrowsecurity = true`. R1 keeps that at 100%.

---

## 2. Professional identity

### EXISTING MODEL

Three separate tables already encode the account/membership/operational split
the mission's §13 asks for:

| Table | Scope | Meaning |
| --- | --- | --- |
| `profiles` | account | bare auth identity, not org-scoped |
| `memberships` | (user, org) | authorization role only |
| `staff_profiles` | (org, user) unique | operational/public staff record: `display_name`, `title`, `bio`, `avatar_url`, `is_public`, `is_active`, `location_id` |
| `barbers` | org, unique(`staff_profile_id`) | marks a staff profile as a bookable barber |

Public barber URLs are `/s/:slug/barbers/:id` where `:id` is `barbers.id`,
served by `get_public_barber(p_organization_slug, p_barber_id)`.

### THE DEFECT

Professional identity today **is** `barbers.id`, and that row is
organization-scoped with `on delete cascade` from both `organizations` and
`staff_profiles`. Therefore:

* a barber who changes shop gets a *new* `barbers.id` — a new public identity;
* their followers, verified-client history and social proof would be orphaned;
* an external professional discovered by Worker has no `barbers` row at all
  (no org, no membership, no auth user), so today it cannot have an identity.

This directly violates mission §14 and blocks §41.

### DECISION — **NEW** table `public.professionals`

One durable, org-independent identity row per real professional.

```
id              uuid pk
user_id         uuid null unique -> auth.users   -- null = unclaimed/external
prospect_id     uuid null        -> prospects    -- Worker provenance, null for FadeUp-native
handle          citext null unique               -- reserved for R6/R7, nullable now
display_name    text not null
headline, bio, avatar_url  text
source          professional_identity_source     -- 'fadeup' | 'worker'
claim_state     professional_claim_state         -- 'unclaimed' | 'claim_pending' | 'claimed'
is_public       boolean not null default false
verification_state professional_verification_state
created_at/updated_at
```

`barbers` gains one nullable, additive column:

```
barbers.professional_id uuid null -> professionals (on delete restrict)
```

### REASON

* `barbers.id` is **untouched**, so every public route, every RPC signature
  and every existing FK keeps working (§51, §11 — no destructive change).
* One professional may own many `barbers` rows over time and across
  organizations (`staff_profiles` is unique per *(org,user)*, so a user in two
  orgs already has two `barbers` rows). Both point at one `professionals` row
  → identity survives shop change, and multi-location is already compatible
  (§14, §47).
* The **same** table serves external/unclaimed profiles with `user_id is null`
  — no second parallel identity hierarchy (§29, §34). This is the single most
  important structural decision in R1.
* Operational data (`appointments`, `queue_entries`, `barber_services`,
  `barber_working_hours`, availability) hangs off `barbers`/`organizations`,
  **not** off `professionals`. An unclaimed professional has no `barbers` row,
  so it is *structurally impossible* for a Worker-created profile to imply
  availability, a live queue, a wait time or an active schedule (§42, §107).
  This mirrors the codebase's existing habit of enforcing a privacy
  requirement by never modelling the data, rather than filtering it later.

### SOURCE OF TRUTH

For a claimed professional: the professional themselves (`user_id`), and the
organization for anything operational. For an unclaimed one: Worker
observations, which are explicitly lower-priority than claimed data (§37).

### PRIVACY

No anonymous table access. Public reads go through
`get_public_professional()`, which returns curated columns only and requires
`is_public`. `prospect_id` is never exposed publicly (§55).

### MIGRATION

Backfill one `professionals` row per distinct `staff_profiles.user_id` that
has a `barbers` row, then point every `barbers.professional_id` at it. A user
with barber rows in two orgs yields **one** professional, not two (§99).
Idempotent, restart-safe, verified by count equality.

### FUTURE USE

R6/R7 (social UI, handles), R10 (Worker publication), R17 (claim/outreach),
R18 (multi-location).

---

## 3. Follow / social graph

### EXISTING MODEL

`customer_favorites (user_id, organization_id, barber_id null)` — a **private,
owner-only bookmark** with strict RLS and no public projection, no intent
history, no follower semantics.

### DECISION — **NEW** `public.professional_follows`; KEEP favorites

Favorites and follows are genuinely different concepts (private bookmark vs.
public social edge), so favorites are neither reused nor deprecated.

```
id                     uuid pk
follower_user_id       uuid not null -> auth.users
professional_id        uuid not null -> professionals
state                  follow_state not null   -- 'following' | 'unfollowed'
source                 follow_source not null  -- 'manual' | 'auto'
has_explicit_unfollow  boolean not null default false
followed_at, unfollowed_at, created_at, updated_at
unique (follower_user_id, professional_id)
```

One row per edge, **mutated in place** rather than append-only. The unique
constraint is what makes Follow idempotent and race-safe under concurrency —
all writes go through `insert ... on conflict (follower_user_id,
professional_id) do update`, never `select`-then-`insert` (§58, §59).

`has_explicit_unfollow` is the sticky intent flag that makes §17/§100 work:

| Action | state | source | has_explicit_unfollow |
| --- | --- | --- | --- |
| manual follow | following | manual | **false** (reset — user opted back in) |
| manual unfollow | unfollowed | manual | **true** (sticky) |
| auto-follow, no row | following | auto | false |
| auto-follow, `has_explicit_unfollow = true` | *unchanged* | *unchanged* | true |

That last row is the invariant: an explicit Unfollow permanently suppresses
auto-follow until the customer manually follows again.

### SOURCE OF TRUTH

The edge row itself. Follows are **never** derived from bookings, and
verified-client status is **never** derived from follows (§20).

### PRIVACY

Owner-only RLS on the edge (`follower_user_id = auth.uid()`). Follower
*counts* are public via RPC; the follower *list* is not exposed in R1.

### COUNTERS (§64)

R1 deliberately does **not** materialize a follower counter. It ships a
partial index `(professional_id) where state = 'following'`, making the count
an index-only scan. Materializing a counter adds a write-hot row, contention
on the follow path, and a drift-repair obligation — all unjustified before
there is traffic. The decision is recorded so R6/R7 can revisit with real
numbers; converting to a materialized counter later is additive.

---

## 4. Customer ↔ professional relationship / Verified Client

### EXISTING MODEL

Completion evidence already exists and is trustworthy:

* `appointments.status = 'completed'` (enum `pending, confirmed, completed,
  cancelled, no_show`), plus `resolution`, `decided_at`, `decided_by`;
* `queue_entries.status = 'completed'` with `service_started_at`,
  `completed_at`.

Both carry `barber_id` and `customer_id`; `customers.user_id` bridges the
org-scoped CRM row to a real account.

### DECISION — **NEW** `public.customer_professional_relationships`, hybrid materialized aggregate

Mission §21 asks which of derived / materialized / hybrid. R1 chooses
**hybrid**: appointments and queue entries remain the *source of truth*; this
table is a rebuildable aggregate maintained on completion.

```
id                          uuid pk
customer_user_id            uuid not null -> auth.users
professional_id             uuid not null -> professionals
organization_id             uuid not null -> organizations   -- §22 shop dimension
first_completed_at          timestamptz not null
last_completed_at           timestamptz not null
completed_interaction_count integer not null default 0 check (>= 0)
established_by              relationship_evidence not null   -- 'appointment' | 'queue'
unique (customer_user_id, professional_id)
```

Chosen over pure derivation because a public profile load would otherwise
need a multi-join aggregate over the two largest tables in the system, per
professional, on every view. Chosen over a fully independent materialization
because being rebuildable from source means a bug is always correctable by a
forward migration — never data loss.

**Verified Client** ⇔ a row exists with `completed_interaction_count >= 1`.
Never `follower = verified_client` in either direction (§20).

### ATTRIBUTION PROVENANCE — the defect this design had to close first

An earlier draft attributed auto-follow and relationships by resolving
`appointments.customer_id → customers.user_id`. **That is exploitable**, and
the exploit is a direct descendant of the one
`20260813160000_claim_scope_fix.sql` already documents.

`link_customer_from_contact_info()` (a `BEFORE INSERT` trigger on **both**
`appointments` and `queue_entries`) find-or-creates the `customers` row by
matching the *caller-typed* `customer_phone`, then `lower(customer_email)`.
So:

1. Victim V has a linked CRM row `R` at shop S (`R.user_id = V` — the normal
   state once V has ever booked while signed in, or called
   `claim_customer_records`).
2. Attacker A books at S **anonymously**, typing V's phone number.
3. The trigger matches `R`, so `appointment.customer_id = R`.
4. Naive attribution resolves `R.user_id = V` and creates a **follow edge
   from V's account** to a barber V has never chosen — a social action forged
   in V's name.
5. When the shop marks that appointment `completed`, V gains a
   **verified-client relationship** with a barber V never visited.

Knowing a phone number would have been enough. The injection itself is
pre-existing and accepted (an attacker can already push a bogus appointment
into V's history); what R1 must not do is *amplify* it from a stray row in a
list into V's social graph and public verified-client status.

**`created_by` cannot be used as the provenance signal** — both
`book_public_appointment` (final definition in
`20260819210000_booking_auto_confirm.sql`) and `join_public_queue` (final
definition in `20260813160000_claim_scope_fix.sql`) insert `created_by = null`
explicitly.

The trustworthy signal is the one those RPCs already compute but discard:
when the caller is authenticated they resolve `customer_id` through
`private.resolve_customer_for_user(...)`, which matches **on `user_id` only,
never on a typed-in phone**. Anonymous callers leave `customer_id` null and
let the contact-matching trigger fill it. By `AFTER` time the two are
indistinguishable — so R1 stores the distinction explicitly rather than
inferring it.

**Decision:** add a nullable provenance column to both tables

```
appointments.booked_by_user_id  uuid null -> auth.users (on delete set null)
queue_entries.booked_by_user_id uuid null -> auth.users (on delete set null)
```

set to `auth.uid()` inside `book_public_appointment` and `join_public_queue`
(the two self-service paths), left `NULL` for anonymous bookings and for rows
created by staff. Attribution then requires:

```
booked_by_user_id is not null
and booked_by_user_id = customers.user_id   -- the actor IS the account
```

The attacker's anonymous booking has `booked_by_user_id = null`, so it
attributes to nobody. Nothing can be attributed to an account that did not
itself act.

**Consequence, stated honestly (§19):** a staff-created appointment and an
anonymous walk-in never establish verified-client status, even when genuinely
completed, because FadeUp cannot prove *which account* received that haircut.
R1 does not pretend otherwise. Narrowing verified-client to self-booked
service is the conservative reading, and it is also what stops a shop from
inflating its own verified-client count by typing strangers' phone numbers
(§87 S3).

### MAINTENANCE — trigger, and why (§86)

Two `AFTER` triggers, deliberately chosen over application code:

* `appointments`: on transition **to `confirmed`** → attempt auto-follow (§18).
* `appointments` / `queue_entries`: on transition **to `completed`** → upsert
  the relationship (§19).

Both read `booked_by_user_id`, never a contact-matched identity.

Justification against §86's four tests: the invariant must hold regardless of
caller (staff RPC, direct SQL, scheduler, future services) — application code
cannot guarantee that; the behaviour is deterministic; it is idempotent by
construction (`on conflict do update`), so retries are safe; and the bodies
are small and total.

**Regression safety (§48, §49):** each trigger body is written so it cannot
raise — it resolves `customers.user_id` and the professional, and returns
early (`return new`) when either is absent. A walk-in with no linked account
simply produces no relationship. Booking and queue completion therefore
cannot be broken by these triggers.

### The confirmed ≠ completed distinction (§19)

A confirmed booking triggers **auto-follow only**. It never creates or
increments a relationship. A future-dated confirmed appointment can therefore
never produce verified-client status — this is the §102 acceptance test.

### DOCUMENTED LIMITATION

When `customers.user_id is null` — an anonymous walk-in, or a CRM row never
claimed — there is no account to attribute the completed service to, so no
relationship is created. FadeUp cannot currently prove completion for
unlinked walk-ins, and R1 does not pretend otherwise (§19).

### PRIVACY

Readable by the customer themselves, by the professional it concerns, and by
members of the `organization_id` where it happened. Never by another tenant
(§109). No anonymous access — the public surface exposes only a *count*.

---

## 5. Public customer profile and verification

### EXISTING MODEL

`customer_profiles` — the customer-owned portable identity, strict owner-only
RLS, holds `phone`/`email`/preferences. Entirely private, correctly so.

### DECISION — **NEW** `public.customer_public_profiles` (+ `customer_verification_events`)

A separate table rather than columns on `customer_profiles`, precisely so
that "has a public projection" can never leak "has private columns" (§15).

```
customer_public_profiles
  user_id            uuid pk -> auth.users
  username           citext null unique      -- reserved for R6/R7
  display_name, avatar_url, bio
  is_public          boolean not null default false   -- private by default (§23)
  persona_category   text null check (in artist/athlete/creator/public_figure/other)
  verification_state customer_verification_state not null default 'not_verified'
  created_at/updated_at
```

`verification_state` ∈ `not_verified | pending | verified | revoked` (§23).

```
customer_verification_events   -- append-only audit (§24)
  id, user_id, from_state, to_state, reason, decided_by, created_at
```

### PRIVACY

`customer_public_profiles`: owner + platform admin only at table level;
anonymous reads go through a projection RPC that requires `is_public` and
returns display_name/username/avatar/verified-flag/persona only — never
email, phone, booking history or `customer_profiles` data.

`customer_verification_events` is **platform-internal**: no customer-facing
read at all. Verification metadata (who decided, why) must not be public
(§24).

Verification state is writable **only** by platform members via a
`SECURITY DEFINER` RPC that also writes the audit event — a customer cannot
self-verify (§87 S4).

---

## 6. Publishable social proof

### DECISION — **NEW** `public.professional_client_showcases`

Relationship *truth* and relationship *publishability* are modelled
separately, exactly as §25 requires.

```
id                uuid pk
professional_id   uuid not null -> professionals
customer_user_id  uuid not null -> auth.users
relationship_id   uuid not null -> customer_professional_relationships
consent_state     showcase_consent not null   -- 'pending'|'approved'|'declined'|'revoked'
requested_at, decided_at, revoked_at
unique (professional_id, customer_user_id)
```

A showcase is publishable **only** when all three hold:

1. a genuine relationship row exists (real completed service);
2. `consent_state = 'approved'`;
3. for a verified "✓", `customer_public_profiles.verification_state = 'verified'`.

**The professional may only INSERT a `pending` request.** Only the customer
(`customer_user_id = auth.uid()`) may move it to `approved`, `declined` or
`revoked`. This is enforced by RLS plus a trigger that rejects a
consent_state transition performed by anyone other than the customer — so a
barber cannot publish a celebrity relationship without permission (§87 S5,
§103).

`relationship_id` is `NOT NULL`, so a showcase cannot exist without a real
completed-service relationship — genuineness is a foreign key, not a check
performed at render time (§26).

### PUBLIC PROJECTION (§88)

`list_public_professional_showcases()` returns only
`display_name, username, avatar_url, is_verified`. It returns no
appointment id, no dates, no counts, no customer UUID, no organization — the
smallest projection that supports "Already cutting X ✓" (§27, §88).

---

## 7. Fade Passport

### EXISTING MODEL

`customer_passports` — already one row per `auth.users` (`user_id` **unique**),
customer-owned, portable, with photos and revocable share links. The
uniqueness invariant §28 asks for is *already* enforced at the database level.

### DECISION — **EXTEND**, do not create a new table (§29)

Creating a `fade_passports` table would duplicate an existing entity for the
sake of a product name. R1 adds what is genuinely missing:

* `passport_number text unique` — a stable, **non-sequential, high-entropy**
  public identifier (base32 of 10 random bytes). Random specifically so the
  passport space cannot be enumerated (§87 S10).
* `issued_at timestamptz`.
* `ensure_customer_passport()` — idempotent `insert ... on conflict (user_id)
  do nothing`, safe under concurrency and retry (§60, §104).
* an `AFTER INSERT` trigger on `customer_profiles` calling it, so every newly
  registered customer gets exactly one Passport automatically (§28).
* a separate, idempotent backfill migration for existing customers (§31).

"Registered customer" is anchored to `customer_profiles`, not `auth.users`,
because this codebase deliberately treats an auth account that never touched
the customer app as *not* a customer (documented in
`20260813120000_customer_identity.sql`).

### WALLET SEPARATION (§30)

R1 adds **nothing** about Apple/Google Wallet. Passport identity and wallet
installation stay separate concepts; a wallet-install entity belongs to the
lot that builds it. No column here implies a device.

### PRIVACY

Unchanged owner-only RLS. `passport_number` is **not** exposed by
`get_shared_passport` or any anonymous path in R1.

---

## 8. Worker V2 domain

### EXISTING MODEL — already mature, do not rebuild

The mission's §34 pipeline is largely implemented:

| §34 stage | Existing table |
| --- | --- |
| SOURCE | `prospect_sources` (`key`, `is_enabled`, `config`) |
| SOURCE OBSERVATION | `prospect_source_records` (`source_id`, `external_id`, `source_url`, `raw_payload`, `confidence`, `fetched_at`, `last_verified_at`, `job_id`) |
| MATCH / DEDUPE | `prospect_identity_matches` (`state`, `matching_rule`, `matched_attributes`, `confidence`, `rules_version`, `merge_applied`, `reviewed_by`), `prospect_duplicates` (`confidence`, `status`, `reviewed_by`) |
| CANONICAL PROSPECT | `prospects` (`canonical_name`, `entity_kind`, `status`, `converted_organization_id`) |
| social provenance | `prospect_social_profiles` (platform, handle, url, external_id) |

Provenance (§36), multi-source convergence (§35), merge auditability (§40) and
non-destructive ambiguity handling (§39 — `prospect_duplicates.status` holds
unresolved candidates rather than auto-merging) are therefore **already
satisfied**. R1 adds no new observation, matching or dedupe structure. This
is the single largest scope reduction versus the mission's assumptions.

### DECISION — add only the two genuinely missing pieces

**(a) External profile** — not a new table. A Worker-sourced professional is a
`professionals` row with `source='worker'`, `prospect_id` set, `user_id null`,
`claim_state='unclaimed'` (§2 above). Distinguishable from claimed-free and
claimed-paid by `claim_state` + absence of any subscription concept (§41).

**(b) Claim lifecycle** — **NEW** `public.professional_profile_claims`:

```
id, professional_id -> professionals, claimant_user_id -> auth.users
state claim_state    -- 'pending'|'approved'|'rejected'|'withdrawn'
evidence jsonb, submitted_at, decided_at, decided_by, rejection_reason
```

with two constraints that together make §108's race impossible:

```
unique index (professional_id) where state = 'approved'   -- at most one owner, ever
unique index (professional_id, claimant_user_id) where state = 'pending'
```

and a third, independent guard: `professionals.user_id` is itself `unique`, so
even a bug in claim handling cannot attach one identity to two accounts.

Approval is platform-reviewed only. R1 leaves claims in a safe `pending`
state rather than shipping weak self-service verification (§44). R17 builds
the outreach/closer flow on top.

### DATA SOURCE PRIORITY (§37)

Once `claim_state = 'claimed'`, professional-managed fields on `professionals`
outrank Worker observations. R1 enforces this structurally: Worker writes go
to `prospect_*` tables, and nothing in R1 propagates them into a claimed
`professionals` row. There is no trigger, no sync job and no `ON CONFLICT DO
UPDATE` path from prospect data onto a claimed identity — the conflict cannot
occur because the write path does not exist. R4/R10 must preserve this.

### PRIVACY (§55)

All `prospect_*` tables keep their existing non-public RLS. R1 introduces no
anonymous read of any raw observation, matching evidence, confidence score or
enrichment metadata. The marketplace consumes only the curated
`get_public_professional()` projection.

### CLAIM ≠ SUBSCRIPTION (§45)

No subscription, plan, price or entitlement column appears anywhere in R1.
`claim_state` answers *who controls this identity*; nothing in R1 answers
*what they have paid for*. R2 owns that.

---

## 9. Amendments after independent review

Two reviews ran in separate contexts (Agent B database, Agent C security)
against the same disposable replay. Their findings changed six decisions in
this document. `R1_SECURITY_MODEL.md` §6 holds the full adjudication; the
material changes are:

1. **`citext` is not used.** It is not installed, and installing it into
   `public` breaks this repo's universal `set search_path = ''`. Empirically
   the failure is *silent and asymmetric*: with an empty search_path the
   `citext` operator is unreachable so lookups degrade to case-sensitive
   `text`, while the unique index keeps its case-insensitive opclass — so
   `@AbC` reserves `abc` for nobody else and `@abc` finds nothing, with no
   error. R1 uses `text` plus `unique (lower(handle))` expression indexes,
   matching the existing `customers_org_email_unique`.
2. **`customer_verification_events` is dropped.** The existing
   `platform_audit_log` already provides exactly what §24 requires. Six new
   tables, not seven.
3. **Relationship uniqueness is three columns**, `(customer_user_id,
   professional_id, organization_id)`, with `organization_id` immutable. Both
   reviewers found the two-column key independently: it lets a barber changing
   shop carry a competitor's service history into the new shop's RLS scope.
4. **New state columns are `text` + `CHECK`, not enums** — except where the
   value set is genuinely closed. The repo already does this
   (`profiles_locale_valid`, `profiles_theme_valid`) and already documents the
   `alter type ... add value` cost in `20260809100400_memberships.sql`.
   `follow_source`, `relationship_evidence`, `claim_state`,
   `customer_verification_state`, `professional_verification_state` and
   `showcase_consent` all have obvious near-term additions.
5. **`professionals.claim_state` gains `check ((claim_state = 'claimed') =
   (user_id is not null))`** — it is derived state and would otherwise drift
   into a `claimed` professional with no owner.
6. **`barbers.professional_id` is assigned by trigger, never by the client.**
   The backfill alone would have left every *newly created* barber unlinked,
   silently losing verified-client evidence for the newest professionals; and
   a client-settable FK let one shop point its barber at another shop's
   professional identity.

## 10. Summary of new structures

Six new tables, four extended, zero dropped, zero rewritten.

| New table | Purpose |
| --- | --- |
| `professionals` | durable professional identity, claimed **and** external |
| `professional_follows` | social graph edge with explicit intent |
| `customer_professional_relationships` | genuine completed-service relationship, per shop |
| `customer_public_profiles` | opt-in public customer projection |
| `professional_client_showcases` | consent-gated publishable social proof |
| `professional_profile_claims` | external-profile claim lifecycle |

| Extended | Change |
| --- | --- |
| `barbers` | `+ professional_id` (nullable FK) |
| `customer_passports` | `+ passport_number`, `+ issued_at` |
| `customer_profiles` | `+ AFTER INSERT` trigger → ensure passport |
| `appointments`, `queue_entries` | `+ booked_by_user_id` (nullable FK, trustworthy attribution provenance) and `+ AFTER` triggers → auto-follow / relationship |
| `book_public_appointment`, `join_public_queue` | `create or replace` — stamp `booked_by_user_id = auth.uid()`; no other behaviour change |

Reused rather than duplicated: `customer_passports`, `prospects`,
`prospect_source_records`, `prospect_identity_matches`, `prospect_duplicates`,
`staff_profiles`, `barbers`, `customers`, `customer_profiles`,
`customer_favorites`, `professional_applications`.
