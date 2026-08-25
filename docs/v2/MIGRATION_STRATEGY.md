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

So R1 has two honest shapes, and this is the decision to make at the gate:

| | **Option A — harden first (recommended)** | **Option B — identity only** |
| --- | --- | --- |
| Scope | Phase 0 hardening + identity + social + passport + Worker claim | identity + follow + passport + Worker claim |
| Verified Client | ships, and is trustworthy | **deferred** to a later lot |
| Migrations | 15 | 10 |
| Touches hot tables | yes — `appointments`, `queue_entries` | barely |
| Risk | higher blast radius, fully testable | lower, but leaves the product without its central social-proof claim |

**Recommendation: Option A.** Option B ships a durable identity that still
evaporates when a barber row is deleted, and defers the one feature the
social-first product is *for*. The hardening is small, additive and
independently valuable — it fixes real defects whether or not the social layer
ever ships.

Everything below specifies Option A. Phase 0 is separable if you choose B.

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
| 2 | `..._appointment_completion_state.sql` | add `appointments.completed_at timestamptz`; backfill from `decided_at` where `status='completed'`; add a `BEFORE UPDATE` **transition guard** rejecting illegal `appointment_status` moves regardless of caller; extend `restrict_appointment_self_update` to freeze `customer_id`. |
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
| `appointments.completed_at` | `= decided_at where status='completed' and completed_at is null` | count of completed rows with NULL `completed_at` = 0, **except** auto-confirmed rows where `decided_at` was always NULL — those get `starts_at` and are counted separately and reported, not silently filled |
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

**Do not "fix" `link_customer_from_contact_info()` by filtering on
`user_id is null`.** Two reasons, both verified in source: the function's
`on conflict do nothing` is followed by an *unfiltered* re-select fallback that
lands straight back on the matched row, so the filter is ineffective; and
filtering the fallback too would stop a legitimate customer booking anonymously
from linking to their own CRM row, breaking `get_my_appointments`. That is a
booking regression, which the Constitution forbids.

R1 instead **stops depending on that edge** via `booked_by_user_id`. The
underlying defect (D-1) is a booking-lot problem and is logged with an owner.

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
* **Column privileges** — assert the exact granted/withheld set per table. This
  is what catches a broken customer feature, and its absence is what let the
  passport upsert break in the first attempt.

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
