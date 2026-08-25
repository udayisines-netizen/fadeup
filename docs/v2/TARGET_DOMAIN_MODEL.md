# R0 — Target Domain Model

Companion to `R0_ARCHITECTURE_AUDIT.md`. Governed by `PRODUCT_CONSTITUTION.md`.

This document decides, for every concept R1 needs, whether it **already
exists**, **exists but needs extension**, is **genuinely new**, should be
**derived rather than stored**, or is a **compatibility bridge to be removed
later**.

> **Rule applied throughout:** do not create a table because the product has a
> word for it. A concept earns a table only when no existing structure can hold
> it without lying about what it is.

---

## 1. Concept classification

| Concept | Verdict | Where it lives |
| --- | --- | --- |
| Authentication identity | **EXISTING, reusable** | `auth.users` |
| Account identity | **EXISTING, reusable** | `profiles` |
| Customer private identity | **EXISTING, reusable** | `customer_profiles` — already org-agnostic, portable, self-owned |
| Shop CRM contact | **EXISTING, needs extension** | `customers` — keep, but demote `user_id` from evidence to bridge |
| Business membership | **EXISTING, reusable** | `memberships` |
| Staff roster record | **EXISTING, reusable** | `staff_profiles` — becomes employment, stops being identity |
| Bookability marker | **EXISTING, reusable** | `barbers` |
| **Professional identity** | **GENUINELY NEW** | nothing today survives a shop change (D-6) |
| **Professional public handle** | **GENUINELY NEW** | only `organizations.slug` and raw `barbers.id` exist |
| **Social graph (follow)** | **GENUINELY NEW** | `customer_favorites` is a private bookmark, not a graph |
| Follow intent (manual/auto/explicit-unfollow) | **NEW, on the follow edge** | not a second table |
| **Customer↔professional relationship** | **NEW, hybrid** | materialized aggregate over booking evidence |
| Verified-client *status* | **DERIVED, not stored** | a predicate over the relationship, never a column |
| Follower / verified-client *counts* | **DERIVED, capped** | never materialized in R1 |
| Public customer profile | **GENUINELY NEW** | `customer_profiles` is private and must stay private |
| Customer verification state | **NEW, on the public profile** | not a separate table |
| Verification audit | **EXISTING, reusable** | `platform_audit_log` already has the exact shape |
| **Publishable social proof** | **GENUINELY NEW** | truth ≠ permission (Constitution §4.1) |
| Fade Passport | **EXISTING, needs extension** | `customer_passports` already enforces one-per-account |
| Passport public identifier | **NEW column** on the existing table |
| Wallet installation | **OUT OF SCOPE** | must not be conflated (Constitution §2.3) |
| Worker source | **EXISTING** | `prospect_sources` |
| Worker observation | **EXISTING** | `prospect_source_records`, raw payload retained |
| Normalized candidate / match | **EXISTING** | `prospect_identity_matches`, `prospect_duplicates` |
| Canonical prospect | **EXISTING** | `prospects` |
| **Public eligibility** | **GENUINELY NEW** | what exists answers "may we message them", not "may customers see them" |
| **External unclaimed profile** | **NEW — but not a new table** | an unowned professional identity row |
| **Claim lifecycle** | **GENUINELY NEW** | no claim token, table or column exists anywhere |
| Subscription / entitlement | **OUT OF SCOPE for R1** | R2 owns it; must remain expressible |
| Analytics events | **OUT OF SCOPE for R1** | R3 owns it |

**Net new tables: 5.** Professional identity, follow edge, relationship
aggregate, public customer profile, claim. Social proof needs a sixth only
because permission is a different fact from truth — see Q-G.

---

## 2. The architectural questions

### A. What is the current durable identity of a barber?

**There isn't one.** A barber is a `barbers` row keyed 1:1 to a `staff_profiles`
row that is `UNIQUE (organization_id, user_id)`. One person at two shops is two
unrelated UUIDs with nothing joining them. `barbers` cascades from both
`organizations` and `staff_profiles`, and `appointments.barber_id` is
`NOT NULL ON DELETE CASCADE` — so deleting the barber deletes the history that
would prove they ever worked.

### B. Is staff membership coupled to professional identity?

**Coupled on creation, decoupled on removal — the worst combination.**
`on_membership_created` auto-creates `staff_profiles`; RLS requires a membership
to insert one. But there is **no FK from `staff_profiles` to `memberships` and
no delete trigger**, so removing a membership leaves a fully functional,
publicly bookable barber with no membership at all.

`get_my_access().professional_available` answers *"am I a professional"* from
`memberships` — i.e. from **authorization**, not identity. That is the coupling
to break.

### C. How are shop / location / organization represented?

There is no `shops` table. "Shop" means three different things by surface:
`organizations` in the URL (`/s/:slug`), `organizations × locations` in search,
`locations` in booking and queue. Multi-location is structurally supported (no
unique on `locations.organization_id`; `business_type` includes
`multi_location`) but practically defeated: `staff_profiles.location_id` is a
single nullable FK, and `search_public_professionals` INNER-joins it so a
location-less professional **vanishes from search**.

**Decision for R1: change nothing here.** Multi-location coherence is R18's. R1
must only avoid encoding "one business = one location" anywhere.

### D. What identifiers do booking, queue, reviews and public URLs use?

| Surface | Identifier |
| --- | --- |
| Public shop | `organizations.slug` (mutable text) |
| Public professional | `organizations.slug` + raw `barbers.id` UUID, also in deep-link query strings |
| Queue kiosk / display | slug + `locations.id` |
| Customer's own queue/appointments | **none** — derived from `auth.uid()` |
| Pro workspace | `staff_profiles.id` — a *different* UUID for the same person |
| Reviews | **no route, no table, no RPC** |

**Constraint: `barbers.id` must keep its meaning.** Any new identity is additive
and must not renumber it.

### E. What is the source of truth for a completed customer service?

Two disjoint sources, neither authoritative: `appointments.status='completed'`
(with **no `completed_at`** — time lands in the overloaded `decided_at`) and
`queue_entries.status='completed'` (with a real `completed_at` that is **written
by the browser**, unconstrained by any trigger or CHECK).

### F. Can verified-client relationships be derived reliably today?

**No — not uniformly, and not safely.** Account attribution is trustworthy **if
and only if** `appointments.customer_id` points at a `customers` row with
`user_id IS NOT NULL` *that was set by `resolve_customer_for_user`*, because
that function keys solely on `(organization_id, user_id)`.

| Path | Trustworthy? |
| --- | --- |
| Signed-in `book_public_appointment` | **yes** |
| Signed-in `join_public_queue` | **yes** |
| Anonymous booking + redeemed claim token | **yes**, for that one appointment |
| Anonymous booking, token never redeemed | no — `user_id` is NULL |
| Anonymous walk-in kiosk | no |
| Staff-created booking | **no** — a receptionist's typing |

And even a trustworthy-looking `customers.user_id` is **forgeable two ways**:
squatting (D-1) and direct staff UPDATE (D-8).

> **Conclusion that governs R1:** verified-client status may be established
> **only** from a booking whose account link was proven by session or by token,
> and never from `customers.user_id` alone. Everything else is documented as not
> provable, per Constitution §3.3.

### G. How to represent manual follow, auto-follow and explicit unfollow without duplicate state?

**One row per (follower, professional), mutated in place.** Not an append-only
log, not two tables.

```
state                  following | unfollowed      -- current edge
source                 manual | auto              -- how the CURRENT state arose
has_explicit_unfollow  boolean                    -- sticky intent, survives state
```

| Action | state | source | sticky flag |
| --- | --- | --- | --- |
| manual follow | following | manual | **cleared** |
| manual unfollow | unfollowed | manual | **set** |
| auto-follow, no row | following | auto | false |
| auto-follow, row exists | *unchanged* | *unchanged* | *unchanged* |

Auto-follow is `ON CONFLICT DO NOTHING` — it can only ever *create* an edge.
That single clause is what makes Constitution §3.4 true. A CHECK forbids
`following AND has_explicit_unfollow`, so the invariant is enforced by the
database rather than by every write path remembering it.

Uniqueness on `(follower, professional)` makes Follow idempotent and race-safe
without select-then-insert.

### H. Does Fade Passport already have a durable domain representation?

**Yes.** `customer_passports.user_id` is `UNIQUE` with an FK to `auth.users`, so
one-per-account is *already* a database guarantee. Photos and revocable hashed
share links exist, with a full UI.

What is missing is only: automatic issuance (today a passport exists only if the
customer creates one) and a stable public identifier.

**Do not create a `fade_passports` table.** It would duplicate a live entity and
orphan the photos and shares that reference it.

### I. What is the safest one-customer-one-Passport invariant?

`UNIQUE (user_id)` — which already exists — plus an idempotent
`insert … on conflict (user_id) do nothing` ensure-function, never
select-then-insert. Concurrency and retry then yield exactly one row by
construction.

"Registered customer" is anchored to **`customer_profiles`**, not `auth.users`,
following this codebase's own definition: an account that never touched the
customer app deliberately has no `customer_profiles` row. A professional's or
platform admin's login is not a customer and must not be issued a Passport.

Any public identifier must be **high-entropy and non-sequential**, and must be
documented as an *identifier, not an authenticator* — the revocable, expiring
`customer_passport_shares` token is the credential, and lookup-by-number must
never become an alternative to it.

### J. What Worker models already exist?

Stages 1–4 are production quality and need no change:

| Stage | Table | Status |
| --- | --- | --- |
| Source | `prospect_sources`, `prospect_jobs` (SKIP-LOCKED lease queue) | complete |
| Observation | `prospect_source_records` — `raw_payload`, `external_id`, `source_url`, `confidence`, `fetched_at`, `last_verified_at`, `UNIQUE (source_id, external_id)` | complete |
| Normalize / match | `prospect_identity_matches` (4-state, `matching_rule`, `confidence`, `rules_version`, `merge_applied`, human review), `prospect_duplicates` | complete |
| Canonical | `prospects` (`canonical_name`, `entity_kind`, `parent_group_id`, 10-stage pipeline, dual scoring) | complete |

Missing: **public eligibility**, **external unclaimed profile**, **claim**,
**claimed professional link**.

### K. How should multiple sources converge without creating duplicate public professionals?

They already converge — `prospect_source_records.prospect_id` is many-to-one on
`prospects`, and `prospect_identity_matches` records the evidence. R1 adds
nothing here.

The new rule is at the **publication** boundary: an external profile is minted
**per canonical prospect, never per observation**, and that creation must be
**idempotent per prospect** so a re-run of a publication job cannot mint a second
identity for the same real shop.

Constitution §5.3 governs the uncertain case: an unresolved duplicate candidate
is correct; a destructive merge is not.

### L. How should external/unclaimed profiles map to canonical claimed identities?

**Same table, different state.** An external profile is a professional identity
row with **no owner**:

```
user_id      NULL            -- unclaimed
prospect_id  set             -- Worker provenance
source       'worker'
is_public    false           -- opt-in, never inherited
```

Claiming sets `user_id`. No second identity is minted, so no merge is required
for the ordinary path.

**Why this is safe, and it is the most important structural point in R1:** all
operational data — availability, services, working hours, appointments, queue
entries — hangs off `barbers`/`organizations`, **never** off the professional
identity. An unclaimed professional has no `barbers` row, so it is *structurally
impossible* for a Worker-created profile to imply a bookable slot, a live queue,
a wait time or a schedule. Constitution §5.5 is satisfied by the **absence of
the modelling**, not by a filter applied at render time.

### M. How should claimed data outrank scraped data?

**Structurally: by having no write path at all.** Worker writes to `prospect_*`.
Nothing propagates prospect data onto a claimed identity — no trigger, no sync
job, no `ON CONFLICT DO UPDATE`. The conflict cannot occur because the path does
not exist. R4/R10 must preserve that; if a suggestion mechanism is ever needed it
must land in a *proposal* table a human accepts, never in the identity row.

### N. What claim mechanism exists today?

**None for this purpose.** Two adjacent mechanisms exist and neither fits:
`professional_applications` creates a **brand-new empty tenant**; `invitations`
joins an **existing organization**. Nothing adopts an existing *professional
identity*.

The right prior art is `redeem_appointment_claim`: single-use, sha256-at-rest,
TTL-bounded, atomically redeemed, and **deliberately narrowed to move only what
the secret proves**. A claim must prove possession of something the claimant was
given, and then move exactly that.

R1 builds the **lifecycle**, not the verification engine (R17 owns outreach).
Claims therefore rest in a safe `pending` state rather than shipping weak
self-service verification.

### O. Which tables can remain untouched?

**~62 of 89.** All 51 acquisition tables (no `organization_id`, structurally
disjoint), the 6 platform back-office tables, the 5 self-scoped customer tables,
and the operational leaves (`chairs`, `location_hours`, `barber_*_hours`,
`time_blocks`, `service_*`).

Blast radius is ~12 tables: `staff_profiles`, `barbers`, `memberships`,
`customers`, `appointments`, `queue_entries`, `waitlist_entries`,
`customer_favorites`, `customer_memberships`, `organizations`, `locations`,
`professional_applications`.

### P–T

Answered in `MIGRATION_STRATEGY.md`: exact migrations (P), RLS per structure
(Q), indexes (R), compatibility bridges (S) and their removal lots (T).

---

## 3. Public / private data map

| Domain | ANONYMOUS PUBLIC | AUTHENTICATED CUSTOMER PRIVATE | PROFESSIONAL / BUSINESS PRIVATE | PLATFORM INTERNAL | WORKER INTERNAL |
| --- | --- | --- | --- | --- | --- |
| Professional identity | display name, handle, headline, bio, avatar, verified flag, claimed flag, **capped** counts — via projection RPC | — | operational rows on `barbers` | provenance, raw claim/verification state | `prospect_*` linkage |
| Customer identity | display name, username, avatar, persona, verified flag — **only** when opted in | `customer_profiles`: email, phone, preferences | the per-org `customers` row incl. `notes` | verification rationale in `platform_audit_log` | — |
| Fade Passport | nothing | whole passport + photos; curated subset via share token | — | passport identifier (never an authenticator) | — |
| Social graph | follower **count** only | own edges + own intent flag | — | all | — |
| Customer↔professional relationship | **existence only, as a count** | own rows | rows for **that organization only** | all | — |
| Social proof | display name, username, avatar, live verified flag — nothing else | consent state | — | all | — |
| Booking / queue | availability only | own appointments via RPC | full operational rows | read-only | — |
| Acquisition | **nothing** | — | — | full | full |
| Claims | nothing | own claims | — | all | — |

Nothing in the ANONYMOUS column is reachable by a direct table SELECT. There are
**zero** anon policies in the database and R1 adds none.

**Explicitly never public, for any customer:** live location, current queue
participation, future appointments, private visit timestamps, booking history,
contact information (Constitution §4.3).

---

## 4. Tenancy exemption, defended

CLAUDE.md requires every business resource to carry `organization_id`. Four of
the five new tables will not, and that must be argued rather than omitted:

| Table | Why platform-scoped |
| --- | --- |
| professional identity | the entire point is to **outlive** org membership |
| follow edge | a customer↔professional social edge; neither party is a tenant resource |
| public customer profile | customer-owned, org-agnostic — same posture as `customer_profiles` and `customer_passports`, neither of which is org-scoped |
| claim | a platform-arbitrated workflow; the claimant may have no organization yet |
| **relationship aggregate** | **IS tenant-scoped** — `organization_id NOT NULL`, in the unique key, immutable, and the RLS anchor |

The isolation argument: no tenant *business* data lives in these tables. A
professional working at two organizations exposes nothing of A to B, because
nothing operational hangs off the identity. The single table recording a
tenant-scoped fact carries the tenant column and is isolated on it.

---

## 5. What must be true before R1 is worth building

Three findings make parts of the target model unsafe *as specified*. They are
resolved in `MIGRATION_STRATEGY.md`; listing them here so the dependency is
explicit:

1. **D-2** — deleting a barber cascades away the appointment history. A durable
   identity over deletable evidence is theatre.
2. **D-3** — completion is assertable by any staff PATCH, and queue timestamps
   are browser-written. Verified Client rests on this.
3. **D-1 / D-8** — `customers.user_id` is squattable and staff-settable, so it
   cannot be the attribution predicate.
