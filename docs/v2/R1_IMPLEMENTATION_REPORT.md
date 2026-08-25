# R1 — Implementation Report

Branch: `rebuild/social-first-v2`
Date: 2026-08-24 / 25
Status: implemented, reviewed, verified. **Not deployed.**

---

## 1. Executive summary

R1 establishes the domain and database foundation for FadeUp Social-First V2:
**six new tables, four extended, eleven additive migrations.** Nothing was
dropped, no column removed, no row deleted, no type converted, and no existing
migration edited.

The lot turned out to be considerably smaller than the brief assumed, because
several of its stated goals were already met by the existing schema (see §2).
It also contained one security problem the brief did not anticipate, which
reshaped the design (see §8).

What shipped:

* `professionals` — a durable, organization-independent professional identity
  that survives shop changes, serving **claimed and external/unclaimed
  identities from one table**.
* `professional_follows` — a social graph edge with sticky, explicit unfollow
  intent, idempotent under retry and concurrency.
* `customer_professional_relationships` — genuine completed-service
  relationships, keyed per shop, rebuildable from source.
* `customer_public_profiles` — opt-in public customer identity with
  platform-only verification, audited through the existing `platform_audit_log`.
* `professional_client_showcases` — consent-gated publishable social proof.
* `professional_profile_claims` — the external-profile claim lifecycle.
* `customer_passports` extended into a real Fade Passport identity: issued
  automatically, with a stable non-enumerable number.
* `appointments.booked_by_user_id` / `queue_entries.booked_by_user_id` — the
  trustworthy attribution provenance everything social depends on.

---

## 2. Pre-flight discrepancies

The mission's stated inputs did not match the repository. Recorded rather than
worked around silently.

**D1 — R0 does not exist.** `docs/v2/` was absent from this branch, from
`main`, and from every commit reachable from `git log --all`. None of
`R0_ARCHITECTURE_AUDIT.md`, `PRODUCT_CONSTITUTION.md`, `TARGET_DOMAIN_MODEL.md`,
`MIGRATION_STRATEGY.md`, `ENTITLEMENTS_DRAFT.md` or `ANALYTICS_DRAFT.md` was
ever committed. Per §4, R1 did not invent database facts and did not re-run a
full R0 audit; the domain model was derived from `pg_catalog` on a disposable
replay of the 61-migration chain.

**D2 — the live dev database is down, pre-existing.** `fadeup-supabase-db`
accepts TCP but every backend fails with
`FATAL: could not open file "global/pg_filenode.map": Permission denied` —
first occurrence `2026-08-21 00:50:14 UTC`, ~159,000 occurrences, 3.5 days
before R1 began, coinciding with the pre-existing checkpoint commit `34d375a`.
It affects PostgREST's `authenticator`, `supabase_admin`, storage and local
psql alike, which is why `fadeup-supabase-rest` is unhealthy. R1 did not cause
it, did not fix it (container/volume permissions, outside a domain lot), and
did not need it — §73 forbids touching production anyway. **Consequence:** all
verification is against disposable containers; live end-to-end application
verification was not possible in this lot. See §22.

**D3 — no generated DB TypeScript types exist.** §65 asks R1 to regenerate
them. There is no such artifact: `apps/web/src/lib/supabase.ts` creates an
**untyped** `SupabaseClient`, there is no `database.types.ts`, and
`package.json` has no codegen script. R1 did not introduce one (§94 — new
tooling, outside this lot). Because every schema change is additive there was
no type fallout and no `any` was needed (§66). Logged as `DEPRECATIONS.md` D5.

**D4 — there is no reviews table.** §50 requires that reviews must not break.
`information_schema` reports zero `%review%` tables in `public`. Reputation
history does not exist yet in FadeUp, so there was nothing to orphan.
`prospects.rating` / `prospects.review_count` are scraped external aggregates
about a prospect, untouched by R1.

**D5 — the Worker domain was already built.** §34–§40 assume R1 must found the
acquisition pipeline. It exists and is mature: `prospect_sources`,
`prospect_source_records` (with `external_id`, `source_url`, `raw_payload`,
`confidence`, `fetched_at`, `last_verified_at`), `prospect_identity_matches`
(`matching_rule`, `matched_attributes`, `confidence`, `rules_version`,
`merge_applied`, `reviewed_by`), `prospect_duplicates`, `prospects`. Multi-
source convergence, provenance, merge auditability and non-destructive
ambiguity handling were therefore **already satisfied**. R1 added no
observation, matching or dedupe structure and modified no `prospect_*` table.
This was the single largest scope reduction.

---

## 3. ECC execution

| Agent | Role | Outcome |
| --- | --- | --- |
| A — planner | in-context, after read-only discovery | produced `R1_DOMAIN_DECISIONS.md`, `R1_MIGRATION_PLAN.md` |
| B — database architect/reviewer | separate context, adversarial | 3 CRITICAL, 8 HIGH, 7 MEDIUM on the **design** |
| C — security reviewer | separate context, adversarial | 3 CRITICAL, 5 HIGH, 6 MEDIUM on the **design** |
| D — implementer | this context | 11 migrations |
| E — fresh-context reviewer | separate context, given a live DB | 1 CRITICAL, 2 HIGH, 7 MEDIUM, 5 LOW on the **implementation** |

Agents B and C ran **before** implementation and independently found both the
two-column relationship key and the `citext` trap. Agent E ran after, built its
own database, and proved three defects with working exploits.

Practices actually applied: `postgres-patterns` and
`supabase-postgres-best-practices` (RLS, column privileges, lock behaviour),
`database-migrations` (additive-first, NOT VALID/VALIDATE, separate backfills),
`tdd-workflow` (invariants written as executable assertions), `security-review`
(threat model S1–S10), `verification-loop` (every claim re-measured, not
asserted).

Three reviewer recommendations were **rejected** with reasons — see §20.

---

## 4. Pre-R1 architecture

Professional identity **was** `barbers.id`: organization-scoped, cascading from
both `organizations` and `staff_profiles`. So a barber changing shop got a new
public identity, and an externally-discovered professional could not have one
at all. Customer identity was already well separated (`customer_profiles`
private and portable; `customers` per-org and staff-owned; `customer_passports`
one-per-account). All 89 tables had RLS **enabled and forced**; zero policies
granted to `anon`; every `SECURITY DEFINER` function pinned `search_path`.

---

## 5. Final domain model

See `TARGET_DOMAIN_MODEL.md` for the diagram and the full public/private data
map. The load-bearing decision: **one `professionals` table serves both claimed
and external identities**, with `user_id NULL` meaning unclaimed. All
operational data stays anchored to `barbers`/`organizations`, so an unclaimed
Worker-sourced profile is *structurally incapable* of implying availability, a
live queue, a wait time or a schedule — the guarantee is the absence of the
modelling, not a filter applied later (§42, §107).

---

## 6. Schema changes and migrations

| # | File | Purpose |
| --- | --- | --- |
| 1 | `20260824100000_professional_identity.sql` | `professionals`, `barbers.professional_id`, guards, RLS, column grants |
| 2 | `20260824100100_professional_identity_backfill.sql` | one identity per distinct barber account |
| 3 | `20260824100200_attribution_provenance.sql` | `booked_by_user_id` ×2; re-`create or replace` of the two self-service RPCs |
| 4 | `20260824100300_social_graph_follows.sql` | `professional_follows`, follow/unfollow RPCs, auto-follow trigger |
| 5 | `20260824100400_customer_professional_relationships.sql` | relationship aggregate, completion triggers, reconciliation |
| 6 | `20260824100500_customer_public_profiles.sql` | public customer identity, platform-only verification |
| 7 | `20260824100600_professional_client_showcases.sql` | consent-gated social proof |
| 8 | `20260824100700_fade_passport_identity.sql` | `passport_number`, `issued_at`, automatic issuance |
| 9 | `20260824100800_fade_passport_backfill.sql` | issue + number existing passports |
| 10 | `20260824100900_external_professional_claims.sql` | claim lifecycle, external-profile creation |
| 11 | `20260824101000_public_projections.sql` | anon-facing projections |

Supporting: `scripts/generate-master-r1.sh` (MASTER is derived, never
hand-edited), `supabase/MASTER_R1_...sql` (~3,500 lines, in sync),
`supabase/VERIFY_R1_...sql`, `supabase/SEED_R1_PRE_UPGRADE_FIXTURE_...sql`, and
one additive `--seed` flag on `scripts/disposable-db-test.sh`.

---

## 7. Backfills, with measured counts

Both are idempotent, restart-safe, deterministic and set-based. Verified
against a **seeded pre-R1 database**, not an empty one — an empty backfill
reports success vacuously.

| Assertion | Result |
| --- | --- |
| barbers rows before → after | 3 → 3 (none lost) |
| staff_profiles before → after | 5 → 5 |
| memberships before → after | 5 → 5 |
| customer_profiles before → after | 2 → 2 |
| barbers left unlinked | **0** |
| distinct barber accounts vs `fadeup`-sourced professionals | 2 = 2 (**no duplicate identity**) |
| a barber at two shops → distinct identities | **1** |
| public-but-inactive staff profile → public professional? | **no** (`is_public` not inherited) |
| non-barber owner → identity? | **no** |
| registered customers without a Passport | **0** |
| Passports without a number | **0** |
| legacy Passport content preserved | yes (`usual_haircut`/`fade_type` intact) |
| duplicate passport numbers | **0** |
| orphan `professional_id` on barbers | **0** |

---

## 8. Social graph semantics

One row per `(follower_user_id, professional_id)`, mutated in place. All writes
are `insert … on conflict … do update`, never select-then-insert, so Follow is
idempotent and race-safe by construction.

`has_explicit_unfollow` is sticky intent, and `try_auto_follow` uses
`ON CONFLICT DO NOTHING` — auto-follow can only ever *create* an edge, never
overwrite one. That single clause is what makes an explicit Unfollow permanent.
A CHECK forbids the one combination no legal action produces
(`following` + `has_explicit_unfollow`).

### The attribution defect that reshaped the design

Attributing social facts through `appointments.customer_id → customers.user_id`
is **exploitable**, and the exploit descends from the one
`20260813160000_claim_scope_fix.sql` already removed.
`link_customer_from_contact_info()` attaches a booking to the CRM row it
matches from the **caller-typed** phone, then email. So:

1. Victim V books once signed in; V's phone lands on V's linked CRM row.
2. Attacker A, **signed out**, books at that shop typing V's phone. The
   trigger matches V's row.
3. `book_public_appointment` inserts that row already `status='confirmed'`, so
   naive attribution creates a follow edge **in V's name**, by an
   unauthenticated caller.
4. When the shop completes it, V becomes a "verified client" of a barber V
   never met.

`created_by` could not fix it — both self-service RPCs insert `created_by =
null` explicitly. R1 therefore records the trustworthy fact instead of
inferring it: `booked_by_user_id`, stamped **only** from `auth.uid()` inside
those two RPCs. Anonymous bookings and staff-created rows carry NULL and
attribute to nobody. Both directions are now passing tests (4.2, 4.3, 17.3,
17.5).

**Honest cost (§19 of the brief):** a staff-created appointment and an
anonymous walk-in do **not** establish verified-client status, even when
genuinely completed, because FadeUp cannot prove which account received that
service. R1 does not pretend it can. This is also what stops a shop inflating
its own verified-client count.

---

## 9. Verified customer relationship semantics

Verified Client ⇔ a `customer_professional_relationships` row with
`completed_interaction_count >= 1`. Established only by a **completed**
appointment or queue visit — a confirmed future booking produces nothing.
Never derived from follows, and follows are never derived from it.

Unique on `(customer_user_id, professional_id, organization_id)`. Both design
reviewers independently found the two-column version: it lets an upsert
overwrite `organization_id`, so a professional moving from shop A to shop B
would carry A's service history into B's RLS scope while A lost access to its
own. `organization_id` is additionally immutable via a guard trigger.

The table is a **rebuildable aggregate**;
`rebuild_customer_professional_relationships()` delete-then-recomputes from
`appointments`/`queue_entries` using the same rules the triggers apply. That is
what makes it defensible for the triggers to contain their own errors.

**Known drift:** the triggers increment per transition into a completed state,
so a row flapping `completed → waiting → completed` counts twice for one real
visit. The rebuild counts evidence rows and is authoritative. Documented in the
migration.

---

## 10. Public verification and social proof

Publishable requires **four** independent facts: a genuine relationship, the
customer's approval, `customer_public_profiles.is_public`, and — for the ✓ —
`verification_state = 'verified'` evaluated **live** so a revocation
disappears immediately.

The professional may only ever insert `pending`. Only the customer moves
consent. `revoked` is terminal and there is **no DELETE policy for anyone**, so
a declined customer cannot be re-solicited by delete-then-reinsert. A binding
trigger asserts the referenced relationship names the same professional *and*
the same customer with at least one completed interaction — without it, a
`NOT NULL` FK proves only that *some* relationship exists somewhere.

`list_public_professional_showcases()` returns exactly four columns —
display name, username, avatar, live verified flag. No appointment id, no date,
no count, no customer UUID, no organization.

---

## 11. Fade Passport

**No new table.** `customer_passports` already existed and already enforced one
per account via a UNIQUE `user_id`. R1 added what was missing: a stable
`passport_number` (80 bits of randomness, non-enumerable), `issued_at`, an
idempotent `ensure_customer_passport()`, and an `AFTER INSERT` trigger on
`customer_profiles` so every registered customer is issued one automatically.

"Registered customer" is anchored to `customer_profiles`, not `auth.users`,
following this codebase's own definition — a login that never touches the
customer app is not a customer.

Wallet is deliberately **not** modelled: a Passport exists whether or not it is
installed on a device. The column comment states that `passport_number` is an
*identifier, not an authenticator*, and that any future lookup-by-number must
go through the revocable, expiring `customer_passport_shares` mechanism.

---

## 12. Worker domain

R1 added no observation, matching or dedupe structure, and modified no
`prospect_*` table — the MASTER generator asserts this mechanically. The two
genuinely missing pieces:

* **External profile** — not a new table. A `professionals` row with
  `source='worker'`, `prospect_id` set, `user_id NULL`,
  `claim_state='unclaimed'`. `create_external_professional()` is platform-only,
  idempotent per prospect, and enforces safe defaults *in code*: unowned,
  unclaimed, not public, not verified.
* **Claim lifecycle** — `professional_profile_claims`, modelled on
  `professional_applications` (AUTHENTICATED != AUTHORIZED).

**Data source priority** is structural: Worker writes go to `prospect_*`, and
nothing in R1 propagates them onto a claimed `professionals` row. There is no
trigger, no sync job and no `ON CONFLICT DO UPDATE` path — the conflict cannot
occur because the write path does not exist. R4/R10 must preserve this.

---

## 13. RLS

Full matrix in `R1_SECURITY_MODEL.md` §3. All six new tables are `enable` +
`force`. The two trigger-maintained tables (`professional_follows`,
`customer_professional_relationships`) have **no write policy at all** —
mirroring `appointment_claim_tokens`, which has zero policies of any kind and
is written only by definer functions. Verified database-wide: RLS still 100%,
`anon`/`PUBLIC` policies still **0**, `SECURITY DEFINER` without
`search_path` still **0**.

Because RLS has no column granularity, and a column-level `REVOKE` **cannot**
subtract from a table-level grant, every column restriction is a table-level
revoke plus a selective re-grant. This is now asserted per column (22
assertions in VERIFY §16).

---

## 14. Indexes

`professionals_handle_lower_unique`, `professionals_prospect_id_idx` (mandatory
— `ON DELETE SET NULL` would otherwise seq-scan on every prospect delete),
`professionals_public_idx`, `barbers_professional_id_idx` (mandatory —
`ON DELETE RESTRICT` searches `barbers` on every professional delete),
`professional_follows_professional_following_idx` (partial, follower count),
`professional_follows_follower_recent_idx` (paginated "who I follow"),
`customer_professional_relationships_professional_idx` (verified-client count),
`..._org_idx` (org read path), showcase partials for the public projection and
the consent inbox, claim partial uniques plus a `submitted_at` review queue,
and `booked_by_user_id` partials on both booking tables.

Deliberately **not** added: a bare `(follower_user_id)` index (strict prefix of
the unique), and a partial on `completed_interaction_count >= 1` (the writers
never insert a zero, so the predicate is always true).

**Counters:** not materialised. The public projection caps both counts with a
`LIMIT 1001` subquery and returns a `*_capped` flag, so the cost is O(1001) at
any scale with no drift and no write-path contention. R6/R7 can materialise
later; that change is purely additive.

---

## 15. Compatibility

No existing RPC signature or return shape changed. `book_public_appointment`
and `join_public_queue` were re-`create or replace`d with **exactly two lines
changed each** — the insert column list and the insert values list — verified
by `diff` against the extracted originals, and independently re-verified by
Agent E. The web app required **zero** changes.

---

## 16. Deprecations

`DEPRECATIONS.md` opens with eight entries. The two that matter most:

* **D2 — no professional merge path.** `approve_professional_claim()` fails
  closed when the claimant already has an identity, which is the *most likely
  real claim* (a scraped barber who later signed up). This is a **hard
  prerequisite for R17**.
* **D3 — `link_customer_from_contact_info()` still trusts typed contact
  details.** Pre-existing; R1 refused to build on it rather than fixing it
  (see §20).

---

## 17. Tests

| Command | Result |
| --- | --- |
| `scripts/disposable-db-test.sh --verify …` (TEST A) | **122 PASS / 0 FAIL / 4 INFO** |
| `--skip-from … --seed … --master … --verify …` (TEST B) | **137 PASS / 0 FAIL / 4 INFO** |
| `scripts/generate-master-r1.sh --check` | in sync |
| `npm run typecheck` | exit 0 |
| `npm test` | 68 files, **578 passed** |
| `npm run lint` | exit 0 (pre-existing fast-refresh warnings only) |
| `npm run build` | exit 0 |

VERIFY asserts behaviour, not object existence: it books, unfollows, re-books,
completes, forges, claims, races and revokes, then checks what actually
happened. Highlights: an explicit unfollow surviving a later confirmed booking;
an anonymous attacker failing to forge a follow or a verified-client
relationship in a victim's name; a shop owner failing to forge
`booked_by_user_id`; a barber failing to self-approve a showcase; a claimant
failing to self-approve a claim; a takeover of an owned identity being refused;
a queue client still being markable done through the real PostgREST path.

---

## 18. Migration verification

**TEST A — fresh database.** All 72 migrations replay from empty, then VERIFY.

**TEST B — existing pre-R1 database.** Base built *without* the 11 R1
migrations, seeded with realistic pre-R1 rows (a barber at two shops, an
inactive-but-public staff profile, a non-barber owner, customers with no
passport, a legacy passport with no number), then the single generated MASTER
applied on top, then VERIFY. This is the path a real upgrade would take, and it
is why the backfills must be idempotent.

---

## 19. Regression

Booking and queue were most at risk, because R1 adds triggers to both.
Specifically verified: staff can still create an ordinary appointment; a barber
can still mark a queue client done **through the exact raw PostgREST `PATCH`
the app issues** (`apps/web/src/lib/queries/queue.ts:206`) — this one matters
because an invoker-rights trigger would have raised `42501` and broken it; the
GiST overlap constraints still reject a clash; `customers.user_id` linkage is
unchanged; public route ids (`barbers.id`) are untouched; auth, onboarding,
marketplace, calendar, localization and RTL are covered by the 578 app tests,
all passing. Reviews: none exist (D4).

---

## 20. Security review — findings and disposition

Adopted from the pre-implementation reviews: column-level revoke + guard
triggers on every client-reachable state column; no write policies on
trigger-maintained tables; `organization_id` in the relationship key and
immutable; the showcase binding trigger; claims modelled on
`professional_applications`; no professional DELETE and terminal `revoked`;
`force` RLS everywhere; no `prospect_worker` grant on `professionals`;
`is_public` as a fourth publishability condition with live verification.

Adopted from the post-implementation review — **three shipping blockers, each
proven with a working exploit**:

* **C1 — the Fade Passport editor was broken for 100% of customers.**
  Withholding `customer_passports.user_id` from the UPDATE grant made
  PostgREST's upsert fail, because `ON CONFLICT DO UPDATE` requires UPDATE on
  every column in the SET list — and R1's new trigger guarantees the conflict
  arm now *always* runs. Reproduced (`permission denied for table
  customer_passports`), fixed, now covered by test 17.1.
* **H1 — no professional's account could ever be deleted.** `user_id` is
  `ON DELETE SET NULL`, which collided with an equivalence CHECK tying
  `claim_state` to ownership; every backfilled professional is `claimed`, so
  Supabase Auth admin delete and GDPR erasure would have failed for every
  barber. Relaxed to an implication plus a demotion trigger; covered by
  17.7/17.8.
* **H2 — `booked_by_user_id` was forgeable on INSERT**, falsifying the lot's
  central attribution claim. Only UPDATE had been revoked; a shop owner could
  insert an appointment carrying a victim's UUID and mint a verified-client
  relationship or a public follow. INSERT is now revoked and selectively
  re-granted; covered by 17.3/17.5, with 17.6 proving ordinary staff booking
  still works.

Also adopted: the GUC stand-down flag is now reset to `'off'` after each
guarded write (it is transaction-scoped, and all three existing precedents
reset it); the reconciliation function now delete-then-recomputes rather than
upserting; the passport backfill is set-based rather than a row-by-row loop
holding `ACCESS EXCLUSIVE` on `appointments` for the length of the loop; a
`reject_professional_claim()` RPC was added so a rejection cannot strand a
profile in `claim_pending` forever; the VERIFY refusal predicates now assert
**SQLSTATE** instead of catching everything (a catch-all passed for typo'd
table names, i.e. several "attacker cannot" checks would have passed while
testing nothing).

**Rejected, with reasons:**

* **Adding `and c.user_id is null` to `link_customer_from_contact_info()`.**
  It would not work — the function's `on conflict do nothing` is followed by an
  *unfiltered* re-select fallback that lands straight back on the victim's row.
  Filtering the fallback too would stop legitimate anonymous re-bookings from
  linking to their own CRM row, breaking `get_my_appointments`. That is a
  booking regression, which §48 forbids. Logged as D3.
* **Claiming `exception when others` catches `statement_timeout`.** It does
  not — PL/pgSQL's `OTHERS` deliberately excludes `QUERY_CANCELED` and
  `ASSERT_FAILURE`. Rather than swallow cancellations (which would be wrong),
  the comments and the MASTER header were corrected to state the real
  guarantee.

**GUC exploitability — checked explicitly, since it was the highest-risk
question.** A client *can* call `set_config` in a raw session, but it is **not
reachable through PostgREST**: `set_config` lives in `pg_catalog`, not an
exposed schema; no `public`/`private` function wraps it with a caller-supplied
name; PostgREST populates only `request.*` GUCs and accepts no arbitrary `SET`.
Even with the flag forced on, the write is blocked one layer lower by the
column grants. The belt-and-braces holds independently.

---

## 21. Database review — findings and disposition

The `citext` finding is worth singling out because the failure mode is silent:
`citext` is not installed, and installing it into `public` breaks this repo's
universal `set search_path = ''`. With an empty search_path the `citext`
operator is unreachable, so comparisons degrade to case-sensitive `text` while
the unique index keeps its case-insensitive opclass — `@AbC` would reserve
`abc` for nobody else and `@abc` would find nothing, with **no error anywhere**.
R1 uses `text` with `unique (lower(...))`, matching the existing
`customers_org_email_unique`.

Also adopted: `INSERT OR UPDATE` trigger guards (rows are *born* `confirmed`,
so an UPDATE-only trigger would have been dead code on the primary booking
path); `SECURITY DEFINER` on all three triggers; explicit FK actions;
deterministic backfill ordering; a completeness assertion instead of a count
equality that would break on re-run; capped counts; the concrete index list;
`NOT VALID` FK then `VALIDATE`; `lock_timeout`; text+CHECK over enums for
evolving states; collapsing verification events into `platform_audit_log`
(seven new tables became six); deterministic trigger naming.

---

## 22. Remaining risks

**CRITICAL** — none known.

**HIGH**

* **No live application verification was possible.** The dev stack's database
  has been down since before this lot began (D2). Everything is verified
  against disposable containers and the 578-test app suite; nothing was
  exercised through a running browser against a real PostgREST. The dev
  database should be repaired and R1 smoke-tested there before any production
  consideration.
* **`approve_professional_claim()` fails closed on the most likely real claim**
  (`DEPRECATIONS.md` D2). Safe, but the claim flow is not yet usable
  end-to-end for a scraped-then-signed-up professional.

**MEDIUM**

* VERIFY still does not call `book_public_appointment` / `join_public_queue`
  themselves; the attribution fixtures assert the trigger logic, with the RPC
  stamping verified by `diff` rather than by execution. Building a fully
  bookable shop fixture is the remaining test gap.
* Counter drift under status flapping (§9) — corrected by reconciliation, which
  is not scheduled (R1 adds no job infrastructure).
* Auto-follow is lossy by design and not reconstructible (D8).

**LOW**

* Handle/username uniqueness is an existence oracle via unique-violation
  errors. Accepted; every major social product shares it.
* Deleting an organization cascades away a `revoked` showcase row (via
  `relationship_id`), so a professional could re-solicit a customer who
  declined, if the relationship at that shop is gone. Narrow, documented.
* `customer_public_profiles.display_name` is nullable while `is_public` can be
  true, so a public showcase entry could render nameless.

---

## 23. R2 readiness

**R2 is safe to start.** R1 changed no pricing concept and deliberately
contains no plan, price, subscription, tier or entitlement column —
`claim_state` answers *who controls this identity*, never *what they have paid
for*. The MASTER generator asserts this mechanically.

R2 should pick up: `barbers.professional_id` → `NOT NULL` (D1, recipe
included); DB type codegen (D5); and the two pre-existing write-authorization
gaps R1 logged rather than fixed (D3, D4).

Full cross-lot notes in `ROADMAP.md`.
