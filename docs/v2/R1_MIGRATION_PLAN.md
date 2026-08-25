# R1 — Migration Plan

Status: proposed (Phase 2)
Companion to `R1_DOMAIN_DECISIONS.md`.

---

## 1. Principles applied

* **Additive only.** No `DROP TABLE`, no `DROP COLUMN`, no type conversion, no
  row deletion, no identifier replacement (mission §11).
* **Schema and backfill are separate migrations** (§10). A backfill never
  shares a file with the DDL that created its target.
* **Migration history is immutable** (§9). No existing file under
  `db/migrations/` is edited. Every change is a new file.
* **RLS is created with the table, never "added later"** (§53). Each new table
  gets `enable` + `force row level security` and its full policy set in the
  same migration that creates it.
* **Every file is idempotent and safe to re-run**, matching the existing
  convention (`create table if not exists`, `drop policy if exists` before
  `create policy`, `create or replace function`, guarded `do $$` blocks for
  enums and `add column`).

## 2. Migration sequence

Filenames follow the repository's `YYYYMMDDHHMMSS_snake_case.sql` convention
and sort after the last existing migration (`20260819220000_currency_exposure.sql`).

| # | File | Purpose | Kind |
| --- | --- | --- | --- |
| 1 | `20260824100000_professional_identity.sql` | `professionals` table, enums, `barbers.professional_id`, RLS, indexes | DDL |
| 2 | `20260824100100_professional_identity_backfill.sql` | one professional per distinct barber-holding `staff_profiles.user_id`; link `barbers` | BACKFILL |
| 3 | `20260824100200_attribution_provenance.sql` | `booked_by_user_id` on `appointments`/`queue_entries`; re-`create or replace` the two self-service RPCs to stamp it | DDL + compat |
| 4 | `20260824100300_social_graph_follows.sql` | `professional_follows`, follow/unfollow RPCs, auto-follow function, RLS, indexes | DDL |
| 5 | `20260824100400_customer_professional_relationships.sql` | relationship aggregate, completion triggers, RLS, indexes | DDL |
| 6 | `20260824100500_customer_public_profiles.sql` | `customer_public_profiles`, `customer_verification_events`, verification RPC, RLS | DDL |
| 7 | `20260824100600_professional_client_showcases.sql` | consent-gated social proof, consent transition trigger, RLS | DDL |
| 8 | `20260824100700_fade_passport_identity.sql` | `passport_number`, `issued_at`, `ensure_customer_passport()`, auto-create trigger | DDL |
| 9 | `20260824100800_fade_passport_backfill.sql` | issue passports + numbers to existing customers | BACKFILL |
| 10 | `20260824100900_external_professional_claims.sql` | `professional_profile_claims`, claim RPCs, race constraints, RLS | DDL |
| 11 | `20260824101000_public_projections.sql` | anon-facing `SECURITY DEFINER` projection RPCs | DDL |

Ordering constraints that actually matter:

* 2 after 1 (backfill needs the table).
* 3 before 4 and 5 — the follow and relationship triggers read
  `booked_by_user_id`, so the column and the RPC stamping it must already exist.
* 5 before 7 — `professional_client_showcases.relationship_id` is a `NOT NULL`
  FK onto the relationship table.
* 9 after 8.
* 11 last — projections read every preceding table.

## 3. Locking and production safety (§91)

Every statement is one of: `CREATE TABLE`, `ADD COLUMN ... NULL` (no default,
no rewrite on PG 11+), `CREATE INDEX`, `CREATE TRIGGER`, `CREATE OR REPLACE
FUNCTION`, or a bounded `UPDATE` in a backfill.

* `ALTER TABLE appointments ADD COLUMN booked_by_user_id uuid NULL` — takes a
  brief `ACCESS EXCLUSIVE` lock but performs **no table rewrite**, because the
  column is nullable with no default. This is the only DDL touching a
  large hot table.
* Indexes in the migration files are plain `CREATE INDEX` (they run inside the
  migration transaction, consistent with every existing FadeUp migration and
  with the disposable-container test harness). For a genuine production
  application against a large `appointments`, the operator should prefer
  `CREATE INDEX CONCURRENTLY` outside a transaction; this is called out in
  the rollback/runbook section below rather than silently assumed.
* The backfills touch `barbers` and `customer_passports`, both small tables.

## 4. Backfill safety (§31, §70, §71)

Both backfills are:

* **idempotent** — driven by `insert ... on conflict do nothing` /
  `update ... where <target> is null`, so re-running changes nothing;
* **restart-safe** — no intermediate state is required; an interrupted run
  simply resumes;
* **deterministic** — no random ordering, no time-dependent branching (the
  passport *number* is random, but assignment is one-per-row and never
  reassigned);
* **measured** — each emits `raise notice` with before/after counts, and the
  VERIFY script asserts count equality independently.

Verification queries per §70, asserted in
`supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql`:

* rows expected vs rows migrated;
* `barbers` with `professional_id is null` (must be 0 after backfill);
* distinct `staff_profiles.user_id` holding barber rows vs `professionals`
  rows with `source='fadeup'` (must be equal — proves no duplicate identity,
  §99);
* `customer_profiles` count vs `customer_passports` count (must be equal);
* duplicate `passport_number` (must be 0);
* orphan FKs across every new table (must be 0).

## 5. Migration test matrix (§68)

Both run through `scripts/disposable-db-test.sh`, never against the dev or
production stack (§73).

**TEST A — fresh database.** Replay the full chain including the 11 new files
from empty:

```
scripts/disposable-db-test.sh --verify supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
```

**TEST B — existing pre-R1 database.** Build the base *without* the R1
migrations, then apply the single generated MASTER on top, proving MASTER can
upgrade the current production schema on its own:

```
scripts/disposable-db-test.sh \
  --skip-from 20260824100000_professional_identity.sql \
  --master supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql \
  --verify supabase/VERIFY_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql
```

TEST B is the one that matters for a real upgrade, and it is the reason the
backfills must be idempotent: MASTER runs them against a database that
already contains real `barbers` and `customer_profiles` rows.

## 6. MASTER file (§83, repo convention)

Per the established convention, MASTER is **derived, never hand-edited** — a
generator concatenates the exact migration files in filename order inside one
transaction, so a fix cannot exist only in MASTER.

* generator: `scripts/generate-master-r1.sh` (sibling of the LOT C/D/E
  generators, not a modification of them — those lots are deployed and must
  keep generating byte-for-byte what the operator applied)
* output: `supabase/MASTER_R1_SOCIAL_ACQUISITION_FOUNDATION_2026_08_24.sql`
* `--check` verifies MASTER is in sync with `db/migrations/`.

## 7. Rollback / restore plan (§72)

R1 contains **no irreversible transformation**. Nothing is dropped, no column
changes type, no row is deleted or rewritten. Rollback options, in order of
preference:

1. **Corrective forward migration** (preferred, per §9). Because every R1
   structure is new and additive, a defect is corrected by a new migration —
   for example dropping a bad index, replacing a trigger function, or
   re-running a backfill after a fix. The relationship aggregate is
   *rebuildable from `appointments`/`queue_entries`*, so even total corruption
   of `customer_professional_relationships` is repairable by recomputation
   rather than restore.
2. **Disable behaviour without dropping data.** The two attribution triggers
   can be dropped in a one-line forward migration; the tables they populate
   remain, and booking/queue continue to work exactly as they did pre-R1,
   because the triggers are `AFTER` and non-raising.
3. **Restore from backup** — only if a future lot introduces a destructive
   change. R1 itself does not.

**Application compatibility during rollback:** the web app is unaffected by
dropping R1 structures, because R1 ships no UI and the Supabase client is
untyped (see `R1_DOMAIN_DECISIONS.md` D3). Existing RPC signatures are
unchanged; `book_public_appointment` and `join_public_queue` keep identical
parameter lists and return shapes.

**Backup prerequisite before any production application (out of scope for
R1, §73):** a verified `pg_dump` of the FadeUp database, restore-tested, taken
before MASTER is applied.

## 8. Compatibility bridges and their removal point (§89)

| Bridge | Why it exists | Removed by |
| --- | --- | --- |
| `barbers.professional_id` nullable | additive introduction; a `NOT NULL` constraint would fail on any row created between migration and backfill, and on future inserts by code that does not yet set it | R2, after `barbers` insert paths set it, via `SET NOT NULL` + `VALIDATE CONSTRAINT` |
| `professionals.handle` / `customer_public_profiles.username` nullable | the unique constraint must exist from day one, but forcing a backfilled handle would churn public identity | R6/R7 when handles become user-facing |
| `customer_favorites` alongside `professional_follows` | genuinely different concepts (private bookmark vs social edge); not a bridge and not scheduled for removal | — |

## 9. Explicitly out of scope

No UI, no feed, no scrapers, no outreach, no analytics pipeline, no
entitlements, no Stripe, no wallet, no search engine, no job infrastructure,
no ORM, no framework change, no SMS, no production deployment.
