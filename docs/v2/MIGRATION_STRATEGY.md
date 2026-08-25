# R0 — Migration Strategy for R1

Answers questions **P–T** from the R1 brief. Governed by
`PRODUCT_CONSTITUTION.md`; evidence in `R0_ARCHITECTURE_AUDIT.md`; decisions in
`TARGET_DOMAIN_MODEL.md`.

---

## 0. The scope decision this document forces

The audit found three defects that sit **underneath** the social layer:

* **D-2** deleting a barber cascades away their appointment history;
* **D-3** completion is assertable by any staff `PATCH`, and queue timestamps are
  browser-written;
* **D-1 / D-8** `customers.user_id` is squattable and staff-settable.

Verified Client is a claim about **what really happened**. Built on the schema as
it stands, that claim is forgeable by a shop and squattable by a stranger.
Constitution §3.3 is explicit: *if the platform cannot reliably establish that a
service was completed, it must not pretend that it can.*

**SUPERSEDED — R1 is split into R1A and R1B.**

An earlier revision offered exactly two shapes (A: one 15-migration lot; B:
identity only) and recommended A. The independent architecture review found
this framing to be the clearest structural rationalisation in the document set:
the rejected option was strictly dominated, and the obvious third option was
never tabled even though *this same section* conceded "Phase 0 is separable."

**Approved decision — Option C:**

| Lot | Scope | Character |
| --- | --- | --- |
| **R1A** — Data Integrity & Security Foundation | contact-squatting fix, appointment history durability, authoritative `completed_at` + transition guard, queue integrity, `customers.user_id` freeze, `booked_by_user_id` privileges, indexes, search LEFT JOIN, Passport DELETE policy, Worker/internal least privilege | touches **hot, revenue-bearing tables**; changes behaviour that previously succeeded silently |
| **R1B** — Social + Acquisition Domain | durable professional identity, follow, relationship aggregate, passport issuance, external profile, claim lifecycle, projections | **purely additive** — new tables, RLS at creation, definer-only writes |

Why the seam is here: R1A is the only work that changes existing behaviour — a
delete that used to succeed now raises, a status PATCH that used to succeed now
raises, a client timestamp is now overwritten. Everything in R1B is new tables
nothing yet depends on, trivially revertible. Bundling them means one rollback
decision covers both, and the operator cannot tell which half caused a symptom.

**R1B does not start until R1A has landed *and been observed*.** Not merely
applied — observed, because R1A changes behaviour that previously failed
silently. R1B's migrations must additionally **assert their preconditions at
migration time** (`completed_at` and the transition guard must exist) rather
than relying on file-ordering discipline.

The section below still describes the full R1 content; read "Phase 0 + Phase 2"
as R1A and "Phases 1, 3, 4, 5" as R1B.

---

## 1. Principles

* **Additive-first.** No `DROP TABLE`, no `DROP COLUMN`, no destructive type
  change, no row deletion, no identifier renumbering.
* **Applied history is immutable.** No file under `db/migrations/` is edited.
  Every change is a new timestamped file.
* **Schema and backfill are separate migrations.**
* **RLS at creation, never "added later."** Every new table gets `enable` +
  `force` and its full policy set in the same migration.
* **Statement-level idempotency.** Migrations replay per file with no explicit
  `BEGIN` — each statement autocommits — so a mid-file failure must leave a
  re-runnable state.
* **Enum for closed sets, `text`+CHECK for sets expected to grow**, and the
  choice stated in the migration (audit §4).
* **Column protection = table-level revoke + selective re-grant**, plus an
  `is distinct from` freeze trigger. Neither alone is sufficient.

---

## 2. P — the exact migration sequence

### Phase 0 — hardening (makes the social layer honest)

| # | File | Purpose |
| --- | --- | --- |
| 1 | `..._appointment_history_durability.sql` | `appointments.barber_id` FK `CASCADE` → **`RESTRICT`**, added `NOT VALID` then validated. Configuration children (`barber_services`, `barber_working_hours`, `time_blocks`) keep `CASCADE` — only the *service record* is protected. Verified safe: no frontend path deletes a `barbers` row (`queries/barbers.ts` has INSERT/UPDATE only). |
| 2 | `..._appointment_completion_state.sql` | add `appointments.completed_at timestamptz`; backfill **only** from `decided_at` where that value semantically proves completion — **never fabricate from `starts_at`** (see §3); add a **separate** `BEFORE UPDATE` transition guard enforcing the matrix in `R1A_TRANSITION_MATRIX.md`. **It must NOT be folded into `restrict_appointment_self_update`**, which exempts owner/manager/receptionist entirely and would silently inherit that exemption, leaving the manager-side forgery path open. Separately extend the existing self-update guard to freeze `customer_id`. |
| 3 | `..._queue_completion_state.sql` | stamp `called_at`/`service_started_at`/`completed_at` **server-side** in a `BEFORE UPDATE` trigger; add a CHECK tying each timestamp to its status; leave the client columns writable for compatibility but overwrite them. |
| 4 | `..._customer_link_integrity.sql` | `guard_customers_update()` freezing `customers.user_id` against client sessions; **do not** change `link_customer_from_contact_info` (see §6). |

### Phase 1 — professional identity

| # | File | Purpose |
| --- | --- | --- |
| 5 | `..._professional_identity.sql` | `professionals` table; `barbers.professional_id` (nullable, FK `NOT VALID` → validate); assignment trigger deriving it from `staff_profiles.user_id`; RLS; column grants; **`staff_profiles(user_id)` index** (D-9). |
| 6 | `..._professional_identity_backfill.sql` | one identity per distinct barber-holding `staff_profiles.user_id`; link every `barbers` row; completeness assertion. |

### Phase 2 — attribution provenance

| # | File | Purpose |
| --- | --- | --- |
| 7 | `..._attribution_provenance.sql` | `booked_by_user_id` on `appointments` and `queue_entries`, stamped **only** from `auth.uid()` inside `book_public_appointment` / `join_public_queue`; also stamped by `redeem_appointment_claim` (token possession is real proof); `INSERT` **and** `UPDATE` revoked at table level with selective re-grant. |

### Phase 3 — social

| # | File | Purpose |
| --- | --- | --- |
| 8 | `..._social_graph_follows.sql` | follow edge, follow/unfollow RPCs, auto-follow on `INSERT OR UPDATE` to `confirmed`. |
| 9 | `..._customer_professional_relationships.sql` | relationship aggregate keyed `(customer, professional, organization)`; completion triggers; delete-then-recompute reconciliation function. |
| 10 | `..._customer_public_profiles.sql` | opt-in public customer identity; platform-only verification RPC writing `platform_audit_log` atomically. |
| 11 | `..._professional_client_showcases.sql` | consent-gated social proof; binding trigger; consent transition guard. |

### Phase 4 — passport

| # | File | Purpose |
| --- | --- | --- |
| 12 | `..._fade_passport_identity.sql` | `passport_number` (80-bit random, non-sequential), `issued_at`, idempotent ensure-function, auto-issue trigger on `customer_profiles`. |
| 13 | `..._fade_passport_backfill.sql` | set-based issuance + numbering for existing customers. |

### Phase 5 — Worker bridge

| # | File | Purpose |
| --- | --- | --- |
| 14 | `..._external_professional_claims.sql` | claim lifecycle; platform-only external-profile creation with safe defaults; approve/reject/withdraw with takeover guard. |
| 15 | `..._public_projections.sql` | anon-facing curated projections. |

**Ordering constraints that matter:** 2 before 9 (relationships read
`completed_at`); 7 before 8 and 9; 9 before 11; 12 before 13; 15 last.

---

## 3. Exact backfills

| Backfill | Rule | Verification |
| --- | --- | --- |
| `appointments.completed_at` | `= decided_at` **only** where `status='completed'` AND `decided_at is not null` — `complete_appointment()` is the sole writer of both, so that value genuinely proves completion time. Rows completed by a raw PATCH have `decided_at` NULL and **stay NULL**. | completed rows with NULL `completed_at` reported as a **count, not an error** — unknown completion time remains unknown. **Fabricating from `starts_at` is forbidden** (independent review): it would invent historical evidence in the exact column verified-client will read. |
| professional identity | one row per **distinct** `staff_profiles.user_id` having a `barbers` row; deterministic tie-break `order by user_id, created_at, id` | distinct barber accounts = `fadeup`-sourced identities; `barbers` with NULL `professional_id` = 0; **`is_public` must NOT be inherited** from `staff_profiles` |
| passport issuance | one per `customer_profiles.user_id` lacking one; number every unnumbered passport | customers without a passport = 0; passports without a number = 0; duplicate numbers = 0; legacy passport content unchanged |

All three are idempotent, restart-safe and set-based, and must be verified
against a **seeded pre-R1 database** — an empty backfill reports success
vacuously.

---

## 4. Q — RLS per structure

| Structure | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `professionals` | self; org members of a linked barber; platform | — (trigger/RPC only) | self, **presentational columns only**; platform via RPC | — |
| follow edge | own edges; platform. Counts via RPC | — | — | — |
| relationship aggregate | customer; the professional; members of **that** `organization_id`; platform | — | — | — |
| public customer profile | own row; platform. Public via RPC requiring `is_public` | own row, `verification_state` pinned to not-verified | own row, **verification excluded**; platform via RPC | own row |
| showcase | customer; professional; platform. Public via RPC | professional only, `pending` only | **customer only** | **nobody** |
| claim | own claims; platform | own, `pending` only | own → withdraw only; platform decides | — |

Both trigger-maintained tables (follow edge, relationship aggregate) have **no
write policy at all**, mirroring `appointment_claim_tokens`. Writes arrive via
`SECURITY DEFINER` functions owned by `postgres` (`rolbypassrls`).

Column hardening — table-level revoke then selective re-grant:

* `professionals`: withhold SELECT on `prospect_id`, `source`; withhold UPDATE on
  `user_id`, `prospect_id`, `source`, `claim_state`, `verification_state`
* `barbers`: withhold UPDATE on `professional_id`
* `appointments` / `queue_entries`: withhold INSERT **and** UPDATE on
  `booked_by_user_id`
* `customer_public_profiles`: withhold UPDATE on `verification_state`
* `customer_passports`: withhold UPDATE on `passport_number`, `issued_at` —
  **but `user_id` MUST remain granted**, because the customer app saves via
  PostgREST upsert with `onConflict: 'user_id'`, which puts `user_id` in the
  `ON CONFLICT DO UPDATE SET` list

Every new `SECURITY DEFINER` function: `set search_path = ''`, `revoke execute
from public, anon`, explicit grant. No new `anon` policy — the count stays at 0.

---

## 5. R — exact indexes

| Index | Why |
| --- | --- |
| `staff_profiles (user_id)` | **fixes an existing `Seq Scan`** on the foundational cross-org identity query |
| `professionals (lower(handle)) unique where handle is not null` | public handle |
| `professionals (prospect_id) where not null` | mandatory — `ON DELETE SET NULL` would otherwise seq-scan on every prospect delete |
| `barbers (professional_id) where not null` | mandatory — `ON DELETE RESTRICT` searches `barbers` on every professional delete |
| follow edge `(professional_id) where state='following'` | follower count |
| follow edge `(follower_user_id, followed_at desc) where state='following'` | "who I follow", paginated; leading column is the RLS predicate |
| relationship `(professional_id)` | verified-client count |
| relationship `(organization_id, last_completed_at desc)` | org read path |
| `appointments (barber_id, customer_id) where status='completed'` | **new** — "all customers this professional has served" is currently unindexed |
| showcase `(professional_id) where consent_state='approved'`; `(customer_user_id) where consent_state='pending'`; `(relationship_id)` | projection, consent inbox, FK |
| claim `(professional_id) where state='approved'` **unique**; `(professional_id, claimant_user_id) where state='pending'` **unique**; `(submitted_at) where state='pending'` | one owner ever; no spam; review queue |
| `appointments (booked_by_user_id) where not null`, same on `queue_entries` | attribution lookups |

Deliberately **not** added: a bare `(follower_user_id)` index (strict prefix of
the unique), and a partial on `completed_interaction_count >= 1` (writers never
insert zero, so the predicate is always true).

---

## 6. What R1 must NOT do

**CORRECTED after independent review — the earlier text here was wrong.**

This section previously argued that filtering
`link_customer_from_contact_info()` on `user_id is null` was *ineffective*,
because the function's `on conflict do nothing` is followed by an unfiltered
re-select fallback. The premise is true; the conclusion does not follow. The
fallback is unfiltered **as written** — filtering it is one line. Two
independent reviewers identified this as a non-sequitur used to defer a
CRITICAL, proven vector, and they are right.

**The fix is viable and belongs in R1A.** There are **four** relevant SELECT
paths — the initial phone lookup, the initial email lookup, and the two
re-select fallbacks after `on conflict do nothing`. **All four** must exclude
rows already owned by an authenticated account (`user_id is not null`). If the
only contact match is an account-owned row, the anonymous booking or queue
entry is left **safely unlinked** rather than attached to a stranger.

**UX trade-off, stated explicitly:** a customer who already has an account but
books *anonymously* using their own phone will no longer be auto-linked. Their
booking is recoverable through the existing single-use 72-hour claim token
(`redeem_appointment_claim`), which is exactly the mechanism that path was built
for. That is a real cost and it is the correct trade: the alternative is leaving
a live takeover primitive in place beneath every future social feature.

`booked_by_user_id` remains the attribution source for anything social — but it
is now defence in depth rather than the sole mitigation.

Also out of scope: multi-location coherence (R18), reviews, entitlements (R2),
analytics (R3), scrapers/outreach (R4/R10/R17), wallet, SMS, search
infrastructure, job infrastructure, ORM, framework change, production deploy.

---

## 7. Tests required

The suite must assert **behaviour**, following the existing `VERIFY_*.sql`
convention (`pg_temp.expect`, `become(uuid)` setting **both** claim GUCs,
fixtures inside a rolled-back transaction, 0 FAIL expected).

Refusal predicates must assert **SQLSTATE** (`42501`, `P0001`, `23514`,
`23505`) and re-raise anything else — a catch-all returns true for a typo'd
table name, which would let "attacker cannot X" pass while testing nothing.

Mandatory cases:

* **Identity** — one human at two shops yields one identity; identity survives
  losing a shop; `is_public` not inherited; non-barber owner gets none.
* **Durability (new)** — a completed appointment **survives** deletion of the
  barber row; deleting an org still behaves as documented.
* **Completion (new)** — a staff `PATCH` cannot jump `pending → completed`; a
  barber cannot set an arbitrary status; queue timestamps are server-stamped and
  a client-supplied `completed_at` is overwritten.
* **Follow** — idempotent; unfollow sticky; **explicit unfollow survives a later
  confirmed booking**; client cannot clear the intent flag.
* **Verified Client** — follower alone is not one; a future confirmed booking is
  not one; a completed self-booked appointment is; a client cannot forge a
  relationship row; **a shop cannot forge `booked_by_user_id` on INSERT**.
* **Squatting (new)** — an attacker who plants a victim's phone gains no follow
  edge and no relationship when the victim's booking lands on that row.
* **Cross-tenant** — a professional at two shops produces two tenant-scoped
  rows; shop B cannot read shop A's; the tenant column is immutable.
* **Passport** — exactly one per customer; ensure is idempotent; numbers unique;
  **the PostgREST upsert with `user_id` in the SET list still succeeds**.
* **External profile** — unclaimed, not public, not verified, no `barbers` row,
  no invented counts; creation idempotent per prospect.
* **Claim** — filing grants nothing; claimant cannot self-approve; approving an
  already-owned identity is refused; only one approval ever.
* **Anonymous** — zero visibility on every new table; curated projections work;
  a non-public professional returns zero rows, not an error.
* **Regression** — booking still confirms; a barber can still mark a queue
  client done **through the real PostgREST `PATCH`**; ordinary staff-created
  appointments still insert.
* **Column privileges** — assert the exact granted/withheld set per table, for
  each role, using `has_column_privilege()`. This is not optional: a
  table-level revoke plus selective re-grant is the only mechanism that
  protects a column against `SELECT`, and it silently changes what PostgREST
  can write. In particular `customer_passports.user_id` **must remain
  UPDATE-grantable**, because `apps/web/src/lib/queries/passport.ts:82-84`
  saves via `.upsert({ user_id, … }, { onConflict: 'user_id' })`, and
  `ON CONFLICT DO UPDATE` requires UPDATE privilege on every column in its SET
  list. Tests must exercise a PostgREST-shaped upsert, not only direct SQL.

Migration matrix: **TEST A** fresh database, **TEST B** pre-R1 base + seeded
realistic rows + generated MASTER + VERIFY. Both via
`scripts/disposable-db-test.sh`, never against the dev or production stack.

> **Do not treat `npm run typecheck` or the 578 app tests as compatibility
> evidence** (D-4). The client is untyped and the suite mocks it. Compatibility
> must be argued from database-level tests and from reading the ~25 direct-write
> call sites.

---

## 8. S / T — compatibility bridges and their removal lot

| Bridge | Why it exists | Removed by |
| --- | --- | --- |
| `barbers.professional_id` nullable | cannot be `NOT NULL` in the migration that adds it | **R2** — `CHECK … NOT VALID` → `VALIDATE` → `SET NOT NULL` → drop |
| `professionals.handle` / public username nullable | uniqueness must exist from day one; forcing backfilled handles would churn public identity | **R6/R7** |
| `/s/:slug/barbers/:barberId` remains the public URL | existing links and deep links must not break | **R6/R7**, which adds a handle route and keeps this one redirecting |
| `customers.user_id` still consulted as a bridge | still how `get_my_appointments` resolves | **booking lot** — after D-1 is fixed |
| `queue_entries` client timestamp columns stay writable | the app writes them; server now overwrites | **R2**, once the client stops sending them |
| `customer_favorites` alongside the follow edge | genuinely different concepts, not a bridge | not scheduled |
| Untyped Supabase client | pre-existing | **R2** — codegen + `Database` generic |

---

## 9. Rollback

R1 contains **no irreversible transformation** — nothing dropped, no type
changed, no row deleted. Preference order:

1. **Corrective forward migration.** The relationship aggregate is rebuildable
   from `appointments`/`queue_entries`, so even total corruption is repairable
   by recomputation rather than restore.
2. **Disable behaviour without dropping data.** The attribution triggers can be
   dropped in a one-line forward migration; booking and queue then behave
   exactly as pre-R1.
3. **Restore from a verified backup** — only needed if a later lot introduces a
   destructive change. R1 does not.

The one genuinely behaviour-changing item is Phase 0 #1: after it, deleting a
`barbers` row with appointments **fails** instead of silently destroying
history. That is the intent. No frontend path deletes barbers, so no UI
regression is expected — but it must be stated to the operator, because a shop
that previously "removed" a barber by deletion must now deactivate instead.

**Before any production application:** a verified, restore-tested `pg_dump`.
R1 is not deployed in this lot.
