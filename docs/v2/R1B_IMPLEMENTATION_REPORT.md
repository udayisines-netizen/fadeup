# R1B — Social-First Identity & Relationship Foundation

Date: 2026-08-26
Branch: `rebuild/social-first-v2`

## Status

R1B implementation and local validation are complete.

R1B is **not** the social frontend. It is the durable data model that a social
frontend, a public professional profile and a Worker publication rollout can
later be built on without any of them having to invent the identity, the
provenance or the consent semantics for themselves.

---

## 1. What R1B adds

Five tables, three columns, twenty-nine functions.

| Structure | What it answers |
| --- | --- |
| `professionals` | who this person is, independent of any shop |
| `barbers.professional_id` | which durable identity a roster seat belongs to |
| `professional_follows` | the follow graph, with a durable explicit-unfollow tombstone |
| `customer_professional_relationships` | services that actually happened, per shop |
| `customer_passports.passport_number` / `issued_at` | the Passport's durable public identifier |
| `professional_claims` | taking control of an existing identity |
| `prospect_professionals` | acquisition provenance, one direction only |

### Migrations

| File | Responsibility |
| --- | --- |
| `20260826100000_professional_identity.sql` | R1A precondition assertions; `professionals`; claim state machine; publication eligibility; identity guard; RLS |
| `20260826100100_barber_professional_linkage.sql` | `barbers.professional_id`, assignment trigger, column privilege hardening, widened identity SELECT policy |
| `20260826100200_professional_identity_backfill.sql` | deterministic backfill + completeness assertion |
| `20260826100300_social_graph_follows.sql` | follow edge, follow/unfollow RPCs, auto-follow triggers |
| `20260826100400_customer_professional_relationships.sql` | tenant-scoped aggregate, maintenance triggers, reconciliation |
| `20260826100500_fade_passport_identity.sql` | `passport_number`/`issued_at`, stamping, freeze, automatic issuance |
| `20260826100600_fade_passport_backfill.sql` | set-based issuance and numbering, then `SET NOT NULL` |
| `20260826100700_acquisition_professional_linkage.sql` | `prospect_professionals`, `create_external_professional`, conversion writer |
| `20260826100800_professional_claims.sql` | claim lifecycle and its three RPCs |
| `20260826100900_public_projections.sql` | claimed and unclaimed public contracts |
| `20260826101000_r1b_privilege_hardening.sql` | cross-cutting REVOKE/GRANT sweep that asserts itself and fails the migration |

`MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql` is generated from exactly these
eleven files by `scripts/generate-master-r1b.sh` and is never hand-edited.

---

## 2. The invariants, and where each is actually enforced

An invariant enforced by "every write path remembers to check" is not enforced.
Each of these is a constraint, an index, or a trigger with no role exemption.

| Invariant | Enforced by |
| --- | --- |
| one human = one professional identity | `professionals.user_id` UNIQUE + `ON CONFLICT (user_id)` in the assignment trigger and the backfill |
| a person holds at most one roster seat per shop | `barbers_org_professional_unique` |
| claim state cannot contradict ownership | `check ((claim_state='claimed') = (user_id is not null))` |
| claim state cannot contradict its timestamp | `check ((claim_state='claimed') = (claimed_at is not null))` |
| an unclaimed identity cannot be published | `check (not is_public or claim_state='claimed' and …)` |
| explicit unfollow beats later automation | auto-follow is `ON CONFLICT DO NOTHING` with **no** `DO UPDATE` branch anywhere |
| a follow timestamp is never invented | `check ((state='following' and followed_at is not null and unfollowed_at is null) or (state='unfollowed' and unfollowed_at is not null))`, with `followed_at` nullable |
| exactly one approved claim, ever | `professional_claims_one_approval` UNIQUE on `(professional_id) WHERE state='approved'` |
| no duplicate pending claim | `professional_claims_one_pending` UNIQUE on `(professional_id, claimant_user_id) WHERE state='pending'` |
| a decided claim is terminal | `enforce_professional_claim_transition()`, no role exempt |
| a Passport number is unique and permanent | UNIQUE index + `stamp_passport_identity()` + `guard_passport_identity()` |
| one Passport per account | the pre-existing `customer_passports_user_id_key`, plus `ON CONFLICT DO NOTHING` issuance |
| one external identity per canonical prospect | `prospect_professionals_prospect_unique` |
| a relationship cannot be repointed | `guard_customer_professional_relationship()`, no role exempt |
| service history cannot cascade away | `barbers.professional_id` RESTRICT, on top of R1A's `appointments.barber_id` RESTRICT |

### R1B refuses to install on an un-hardened database

`20260826100000` asserts, and raises `55000` if any is missing:
`appointments.completed_at`, the `appointments_enforce_transition` trigger,
`appointments.booked_by_user_id`, and that `appointments_barber_id_fkey` no
longer cascades. A durable identity built over deletable appointment history
and forgeable completion state would be theatre, so this is checked rather than
assumed from filename ordering.

---

## 3. Security model

### The default-privilege hazard, and why it needed its own migration

Probing the running image showed `pg_default_acl` grants **anon,
authenticated and service_role every privilege on every new table in
`public`**:

```
postgres | public | r | {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
                          authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
```

A `create table` with flawless RLS therefore still ships with `authenticated`
holding INSERT, UPDATE, DELETE and TRUNCATE, leaving RLS as the only barrier.
Every R1B table revokes at creation, and `20260826101000` re-asserts the entire
matrix and **raises `P0001`, failing the migration**, if any part of it is
wrong — including RLS enabled+forced, `search_path` pinned on all 29 functions,
anon holding no EXECUTE on any mutation, and the R1A column protections still
intact.

### Final privilege matrix

| Table | anon | authenticated | prospect_worker | service_role |
| --- | --- | --- | --- | --- |
| `professionals` | — | SELECT (11 of 13 cols), UPDATE (6 presentational cols) | — | ALL |
| `professional_follows` | — | SELECT (8 of 9 cols) | — | ALL |
| `customer_professional_relationships` | — | SELECT | — | ALL |
| `professional_claims` | — | SELECT (10 of 11 cols) | — | ALL |
| `prospect_professionals` | — | — | SELECT | ALL |

Withheld from client SELECT: `professionals.source` (acquisition provenance),
`professionals.user_id`, `professional_follows.follower_user_id`,
`professional_claims.decided_by`. Withheld from client INSERT **and** UPDATE:
`barbers.professional_id`, `customer_passports.passport_number`,
`customer_passports.issued_at` — each via a table-level revoke and selective
re-grant, because a column-level REVOKE cannot subtract from a table-level
grant.

`customer_passports.user_id` remains UPDATE-grantable. This is R1A's finding
and it is load-bearing: `apps/web/src/lib/queries/passport.ts` saves with
`.upsert({ user_id, … }, { onConflict: 'user_id' })`, and `ON CONFLICT DO
UPDATE` requires UPDATE on every column in its SET list. The freeze that the
grant cannot express — "same value resent by upsert" versus "repointed at
someone else" — is enforced by `guard_passport_identity()` instead.

`service_role` retains full privileges on the new tables, matching every other
table in this schema. It bypasses RLS by definition and must never reach
frontend code (CLAUDE.md).

### Zero anon policies, still

The database has never had an `anon` RLS policy and R1B adds none. Every
anonymous read goes through a curated `SECURITY DEFINER` projection. Verified
both at migration time and in VERIFY.

### SECURITY DEFINER surface

All 29 R1B functions pin `search_path = ''`. 24 are `SECURITY DEFINER`; the
five that are not are pure guard triggers that touch no table.

Seven definer trigger functions carry the broad EXECUTE grant that Supabase
default privileges give every new function. That grant is **inert**, and this
was confirmed by probe rather than assumed — calling any of them directly as
`authenticated` returns `0A000 trigger functions can only be called as
triggers`. It matches the existing convention in this schema
(`guard_professional_application_update` has the same grants).

Every non-trigger definer function validates the actor through `auth.uid()` or
`private.is_platform_admin()`. **None takes an organization id as a
parameter** — the claim path derives the conversion organization from the
claimant's own single owner membership, so a reviewer cannot attribute someone
else's conversion. VERIFY asserts this structurally, by scanning
`proargnames`.

### One design note worth stating plainly

`fadeup.professional_claim_write` is a transaction-local GUC that the claim
RPCs set around their own UPDATE, following the convention R1A established with
`fadeup.appointment_reschedule`. Any role can set a custom GUC, so it is a
**coordination flag between server-side components, not an authorization
boundary**. The boundary is the column grant. Probed adversarially: a client
that sets the flag and then attempts to forge claim state still gets `42501
permission denied for table professionals`.

---

## 4. The claim state machine

```
                   submit_professional_claim
                            |
                            v
                        [ pending ] --- withdraw ---> [ withdrawn ]
                        /        \
                 approve          reject
                      /              \
                     v                v
              [ approved ]        [ rejected ]
```

All three leaves are terminal, enforced by a `BEFORE UPDATE` trigger with no
role exemption. The corresponding identity transition is the only one in the
system:

```
professionals:  unclaimed --(approved claim)--> claimed
                claimed   --(account erased)--> unclaimed   [detach only]
```

There is **no** path that moves a claimed identity from one account to another.
Taking over a claimed profile is not slow in this design; it is
unrepresentable.

**Concurrency.** Two reviewers approving two different claims for the same
identity is closed twice over: the professional row is taken `FOR UPDATE`
before anything is decided, so the second transaction blocks and then re-reads
a row that is already claimed and refuses; and
`professional_claims_one_approval` refuses a second approval independently with
`23505`. VERIFY proves the second guarantee by bypassing the RPC entirely and
forcing a direct UPDATE.

**Merge fails closed.** A claimant who already holds an identity is refused, at
submit time and again under the row lock at review time. Approving would
require merging two professional identities, and a silent merge would destroy
one person's history. R17 owns merge.

**No internal reviewer note exists.** R1A had to close exactly that leak on
`professional_applications.internal_note`, where a row-level policy plus a
table-wide SELECT grant handed an applicant the reviewer's private assessment.
A column that does not exist cannot be over-granted; `decision_note` is written
for the claimant to read.

---

## 5. The follow state machine

| Action | state | source | followed_at | unfollowed_at |
| --- | --- | --- | --- | --- |
| manual follow (new) | following | manual | now | null |
| manual follow (already following) | following | manual | **unchanged** | null |
| manual follow (after unfollow) | following | manual | now | **cleared** |
| manual unfollow (existing edge) | unfollowed | manual | preserved | first refusal |
| manual unfollow (no edge) | unfollowed | manual | **null** | now |
| repeat unfollow | unfollowed | manual | preserved | **first refusal kept** |
| auto-follow, no row | following | auto | now | null |
| auto-follow, row exists | *unchanged* | *unchanged* | *unchanged* | *unchanged* |

`followed_at` is nullable precisely so that unfollowing something never
followed does not record a follow that never happened.

### Unfollow precedence

Auto-follow is `ON CONFLICT DO NOTHING` with **no `DO UPDATE` branch anywhere
in the codebase**. It can only ever create an edge, never transition one.
Constitution §3.4 is therefore a property of one clause rather than of every
write path remembering it, and the race is safe in both interleavings:

* auto inserts first, unfollow then updates → `unfollowed`;
* unfollow lays the tombstone first, auto conflicts → `DO NOTHING` →
  `unfollowed`.

### Auto-follow provenance

Attribution comes from `booked_by_user_id` and nothing else — stamped only from
`auth.uid()` inside `book_public_appointment` / `join_public_queue`, with INSERT
**and** UPDATE revoked at table level by R1A.

Explicitly not used, and why:

| Rejected source | Why |
| --- | --- |
| `customers.user_id` | squattable (R1A D-1) and staff-settable (D-8) |
| `created_by` | both self-service RPCs insert NULL |
| contact match | a phone number is not an account |

Qualifying events: an appointment reaching `confirmed` (Constitution §3.3
permits a confirmed booking to establish a follow), and a queue entry reaching
`completed` with a named barber (a served walk-in). A `waiting` queue entry
does not qualify — joining a line says nothing about who served you.

**This is lossy by design.** An anonymous booking, a kiosk walk-in and a
receptionist-typed appointment produce no follow at all. The alternative is
fabricating a relationship on behalf of someone who never acted.

**Unclaimed identities cannot be followed** — required by both the RPC and the
auto-follow helper — so an external profile's follower count is structurally
zero rather than filtered to zero at render time.

---

## 6. The relationship aggregate

`customer_professional_relationships` is the only tenant-scoped table R1B adds:
"customer X was served by professional Y **at shop Z**" is a statement about a
shop's business, so `organization_id` is NOT NULL, sits in the unique key, is
immutable, and is the RLS anchor.

Follower is never derived from verified-client and vice versa (Constitution
§3.2). Nothing in this file reads the follow graph.

**Why duplicate delivery cannot inflate a counter:** not because the writer is
careful, but because R1A made `completed` terminal for every caller. A row can
enter `completed` exactly once in its lifetime, and the trigger fires only on
that entry. Concurrency is handled by `ON CONFLICT DO UPDATE` — a row lock,
never a read-modify-write — with `least()`/`greatest()` so out-of-order arrival
cannot corrupt the first/last window.

**Reconciliation.** `reconcile_customer_professional_relationships(uuid)` is
platform-only and recomputes the whole aggregate from `appointments` and
`queue_entries` in a single statement with three data-modifying CTEs whose
targets are disjoint by construction. Optionally scoped to one professional.
It **excludes** completed rows whose `completed_at` is NULL — R1A recorded
those as genuinely unknown and R1B does not invent them.

**No verified-client column exists.** Verified-client is a predicate over this
table; storing it would let the two drift. **No public count** — withdrawn in
`TARGET_DOMAIN_MODEL` §6.2, because restricted to self-booked evidence it
measures customer signup behaviour rather than craft.

---

## 7. Fade Passport

Constitution §2.2 says a Passport cannot be missing. Before R1B one existed
only if the customer opened the Passport screen and saved something.

* Issued automatically by an `AFTER INSERT` trigger on `customer_profiles` —
  this codebase's own definition of a registered customer, so a professional's
  or platform admin's login correctly gets nothing.
* `passport_number`: 80 bits of `gen_random_bytes`, formatted
  `FP-XXXX-XXXX-XXXX-XXXX-XXXX`, non-sequential, unique, **server-generated**.
  The stamping trigger overwrites any caller-supplied value — verified for
  `postgres`, not merely for `authenticated`.
* An **identifier, not an authenticator**. The credential remains the
  revocable, expiring, sha256-at-rest token in `customer_passport_shares`, and
  R1B adds no lookup-by-number path.
* Issuance is `insert … on conflict (user_id) do nothing`, never
  select-then-insert, so concurrency and retry yield exactly one row by
  construction.
* No DELETE path is reintroduced. R1A's revoke and policy removal stand.

The freeze guard permits `NULL → value` on `passport_number` because the
backfill has to perform exactly that write, and the allowance closes itself:
the same MASTER transaction ends with the column `NOT NULL`, after which
`old.passport_number is null` is unreachable and the freeze is unconditional.
No GUC bypass was needed.

**Known residual, stated rather than hidden:** the stamping trigger's collision
check cannot see an uncommitted concurrent row, so two simultaneous issuances
could in principle draw the same number and the second would fail on the unique
index with `23505` rather than retrying. At 80 bits this needs on the order of
10^12 Passports before it is even a 1-in-1000 event; the unique index remains
the authority, so the failure mode is a refused write, never a duplicate.

---

## 8. Claimed vs unclaimed, and the public contract

**Two projections with different `RETURNS TABLE` shapes, not one with a flag.**

```
get_public_professional(uuid)          -> (id, display_name, handle, headline, bio, avatar_url, follower_count)
get_public_professional_by_handle(text)-> (id, display_name, handle, headline, bio, avatar_url, follower_count)
get_public_external_professional(uuid) -> (id, display_name, handle, headline, bio, avatar_url, is_claimed)
```

The single-shape design was rejected on failure mode rather than taste: with
one shape, adding a wait time or an "available today" column later silently
adds it to the *unclaimed* contract too, and the only thing between a
Worker-discovered barbershop and a fabricated wait time is whoever writes that
migration remembering to special-case it. With two shapes the unclaimed
projection *physically cannot* carry it.

**Why an unclaimed profile cannot imply operational truth.** All operational
data — availability, services, working hours, appointments, queue entries —
hangs off `barbers`/`organizations` and never off the identity. An unclaimed
professional has no `barbers` row, so there is no column in which a fabricated
wait time could be stored. Constitution §5.5 is satisfied by the absence of the
modelling.

**Unclaimed publication is off, in the schema.** `check (not is_public or
claim_state = 'claimed' and …)` makes the state unrepresentable, so
`get_public_external_professional` is correct today *and* returns zero rows for
every input. R10 turns publication on by removing that one clause,
deliberately, having already had this contract reviewed.

Neither projection exposes: future appointments, current queue participation,
live presence, private visit timestamps, contact details, verified-client
counts, acquisition provenance, or claim workflow state. A non-public
professional returns zero rows, never an error — indistinguishable from one
that does not exist.

The follower count is **computed and capped** (`LIMIT 10000` inside the
subquery), never materialized, so it cannot drift from the canonical edges.

---

## 9. Acquisition linkage

**The FK lives on the acquisition side**, and the reason is a privilege
argument. `professionals` is tenant-readable and publicly projected;
`prospects` is FadeUp's own sales data across 51 structurally disjoint tables.
A FK from the platform-only side into the tenant-readable one leaks nothing.
The reverse leaks the moment a column grant is forgotten, and would put "FadeUp
scraped this shop and scored it as a lead" one join from a barber's own profile.

`create_external_professional(uuid)` takes a prospect id **and nothing else**.
The display name is copied from `prospects.canonical_name` server-side; there
is no parameter that could carry an invented availability, rating or client
count, because there is no column for one. It is idempotent per canonical
prospect (`unique (prospect_id)`), and a concurrent second job loses on the
index and receives `40001` so it retries into the idempotent branch.

Authorization is `is_platform_admin()` **or** (`auth.uid() IS NULL` **and**
`session_user = 'prospect_worker'`). Both halves of the worker arm matter:
`current_user` inside a `SECURITY DEFINER` function is the owner, so testing it
would admit everyone; and requiring the absence of a JWT closes the case where
a superuser session has merely `SET ROLE`d to `authenticated`, which
`pg_has_role` would have accepted. This was found by the test suite, not by
inspection.

### `prospects.converted_organization_id` — the first writer

That column has existed since the acquisition schema shipped, and
`private.cancel_outreach_on_conversion` already watches it to stop prospecting
a business that has become a customer. **Nothing has ever written it.** R1B's
claim approval is the first writer.

The organization is **derived, never supplied**: the claimant's own owner
memberships are counted, and only an unambiguous count of exactly one is used.
Zero or several declines to guess rather than picking one. An existing
conversion is never overwritten — a prospect converts once and sales has
already acted on it.

No fuzzy matching, no auto-merge, no scoring is acted on. Constitution §5.3: a
false merge of two real shops is worse than a temporarily unresolved duplicate.
And there is **no write path from prospect data onto a claimed identity** — no
trigger, no sync, no `ON CONFLICT DO UPDATE` — so Constitution §5.4 holds
because the conflict cannot occur.

---

## 10. Backfills

| Backfill | Rule | Verified by |
| --- | --- | --- |
| professional identity, account-backed | one **claimed** identity per distinct barber-holding `staff_profiles.user_id`, deterministic tie-break `(user_id, created_at, id)`; `claimed_at` = the earliest roster `created_at` | 11.1–11.4 |
| professional identity, detached | one **unclaimed** identity per `barbers` row whose staff profile has `user_id IS NULL` (an R1A account-erasure tombstone) | 11.5–11.6 |
| Passport issuance | one per `customer_profiles.user_id` lacking one | 11.12–11.13 |
| Passport numbering | every unnumbered Passport, content untouched | 11.10–11.11 |

`claimed_at` is the earliest roster date, not `now()`. Stamping `now()` would
assert that a ten-year-old shop's entire staff were claimed the day the
migration ran. The roster row is real evidence of when that began.

Passport `issued_at` for a backfilled row **is** `now()`, and that is the
honest value: the *number* was issued today. `created_at` still records when
the Passport content first existed.

`is_public` is never inherited from `staff_profiles`. No handle is invented for
anyone.

Both backfills assert their post-condition and `raise P0001` rather than
shipping a silently incomplete link — an empty backfill reports success
vacuously, so the assertion is on the end state, not on how many rows moved.

### Deliberately not backfilled

The **relationship aggregate** is not populated from history at migration time.
It is fully derivable, and the alternative is a long write across the whole
`appointments` table for data no product surface reads yet. Bringing history in
is one command:

```sql
select * from public.reconcile_customer_professional_relationships();
```

VERIFY 11.14–11.17 assert both halves: that the migration did not do it, and
that reconciliation reproduces exactly the right numbers from the seeded
history when it is run.

---

## 11. Foreign key deletion semantics

Every action chosen and stated, none inherited.

| Constraint | Action | Why |
| --- | --- | --- |
| `barbers.professional_id → professionals` | **RESTRICT** | an identity that still backs a roster seat cannot be removed; same reasoning R1A applied to `appointments.barber_id` |
| `prospect_professionals.professional_id → professionals` | **RESTRICT** | provenance is evidence |
| `professionals.user_id → auth.users` | **SET NULL** | erasure must not dead-end on a FK, and must not cascade away the identity appointment history depends on |
| `professional_follows.follower_user_id → auth.users` | CASCADE | a follow is the follower's own personal data and means nothing without them |
| `professional_follows.professional_id → professionals` | CASCADE | an edge to an identity that no longer exists is not evidence |
| `customer_professional_relationships.customer_user_id → auth.users` | CASCADE | derived, and rebuildable from evidence that survives erasure |
| `customer_professional_relationships.professional_id → professionals` | CASCADE | rebuildable; a second dead-end would protect data that is not itself evidence |
| `customer_professional_relationships.organization_id → organizations` | CASCADE | matches every other tenant-scoped table |
| `professional_claims.professional_id → professionals` | CASCADE | a claim on a nonexistent identity records nothing |
| `professional_claims.claimant_user_id → auth.users` | CASCADE | the claimant's own submission; erasure withdraws it and makes the identity re-claimable |
| `professional_claims.decided_by → auth.users` | **SET NULL** | erasing a reviewer must not erase the fact that a decision was taken (Constitution §4.4) |
| `prospect_professionals.prospect_id → prospects` | CASCADE | the link is a statement *about* a prospect |

### Account erasure, and the dead-end it would otherwise create

`check ((claim_state='claimed') = (user_id is not null))` plus `ON DELETE SET
NULL` would make `DELETE FROM auth.users` fail on `23514` forever; `RESTRICT`
would block erasure outright. Resolution: the guard trigger detects the
RI-driven transition and reverts the row to a coherent
`unclaimed / claimed_at null / is_public false`.

**A defect found by testing, not by inspection:** the first version keyed that
branch on `user_id → NULL` alone, which any privileged direct UPDATE could
write by hand to unclaim an identity the guard exists to protect. The
distinguishing fact is that the *account is gone* — `ON DELETE SET NULL` runs
after the `auth.users` row is removed, so it is invisible to the trigger,
whereas a hand-written detach leaves it standing. The guard now checks exactly
that, and became `SECURITY DEFINER` so it can.

---

## 12. Validation

### Test A — fresh database

Complete migration chain replayed from zero. **81 migrations applied.**

```
VERIFY_R1B: PASS=161 FAIL=0 INFO=1
VERIFY_R1A: PASS=70  FAIL=0 INFO=2
```

The single INFO is the upgrade section correctly reporting that seeded
pre-R1B fixtures are absent on a fresh database.

### Test B — pre-R1B upgrade

```
scripts/disposable-db-test.sh \
  --skip-from 20260826100000 \
  --seed   supabase/SEED_R1B_PRE_UPGRADE_2026_08_26.sql \
  --master supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql \
  --verify supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
```

70 pre-R1B migrations replayed, 11 skipped; realistic R1A-era fixtures loaded;
MASTER applied as one transaction; both suites run.

```
VERIFY_R1B: PASS=179 FAIL=0 INFO=1
VERIFY_R1A: PASS=70  FAIL=0 INFO=2
```

The seed contains a barber working at two shops with the older profile at the
first, a roster row whose account R1A's erasure path already detached, a
Passport with real saved content, a customer who never opened the Passport
screen, an account that is not a customer, two genuinely completed self-booked
appointments, a pre-R1A completed appointment whose completion time is unknown,
an anonymous booking that landed on a squatter's CRM row, a served walk-in, an
unconverted prospect and an already-converted one.

### R1A regression — its own upgrade path

```
scripts/disposable-db-test.sh --skip-from 20260825100000 \
  --seed supabase/SEED_R1A_PRE_UPGRADE_2026_08_25.sql \
  --master supabase/MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql \
  --verify supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
```

```
PASS=78 FAIL=0 INFO=2
```

Exactly the documented R1A baseline.

### Two R1A VERIFY changes, and why they are not expectation-weakening

The brief requires that R1A test expectations are not adjusted merely to make
R1B pass. Two changes were needed and both are recorded here explicitly.

**1. The Passport fixture (line ~638).** It inserted a `customer_passports` row
after inserting `customer_profiles`. R1B implements Constitution §2.2, so the
profile insert now *already* issues the Passport and the bare INSERT collides
on `customer_passports_user_id_key`. Changed to an upsert, which is correct on
both schemas. **Assertions 8.1–8.5 are byte-identical.** The invariant that
changed is a product rule R1B was asked to implement.

**2. Check 10.7, "R1A introduced no new table".** It was written as an absolute
`count(*) = 89`. R1B legitimately adds five tables, so the literal would fail
for the right reason while hiding any wrong one behind it. Rewritten to allow
the 89 baseline plus however many of the five *named* R1B tables are present,
and nothing else. It passes at 89 pre-R1B, passes at 94 post-R1B, and still
fails on an unexpected ninety-fifth table — which the bare literal could no
longer detect. **This check is now stronger, not weaker.**

### Worker regression

- Typecheck: PASS
- Lint: 0 errors (3 pre-existing warnings, unchanged)
- Tests: **13 files, 225/225 passing** — exactly the R1A baseline
- Production TypeScript build: PASS

### Web regression

- Typecheck: PASS
- Lint: 0 errors (pre-existing Fast Refresh warnings, unchanged)
- Tests: **68 files, 578/578 passing** — exactly the R1A baseline
- Production Vite build: PASS

### Static validation

- `scripts/generate-master-r1b.sh --check`: **in sync**
- `bash -n scripts/generate-master-r1b.sh`: PASS
- Generator safety checks: no DROP TABLE / TRUNCATE / DROP COLUMN /
  DROP … CASCADE / RLS disable / unbounded DELETE; **no anon policy**; exactly
  the five expected tables and no others; no R1A function redefined; no
  out-of-scope (R2/R6/R7) object referenced; all 11 migrations present;
  transaction closed
- `git diff --check`: clean

---

## 13. Defects found and fixed during implementation

Every one of these was found by running the suites, not by reading the code.

| # | Defect | Fix |
| --- | --- | --- |
| 1 | The identity guard's erasure branch keyed on `user_id → NULL` alone, so any privileged direct UPDATE could unclaim an identity | require the `auth.users` row to be genuinely gone; guard became `SECURITY DEFINER` to read it |
| 2 | `stamp_passport_identity` was not `SECURITY DEFINER`, so a client INSERT would fail with `42501` on `private.generate_passport_number`, and its collision check ran under RLS seeing only the caller's own row | made it `SECURITY DEFINER` |
| 3 | `guard_passport_identity` used `is distinct from`, which rejects `NULL → value` — the backfill deadlocked against its own invariant. **Caught only by the upgrade test; the fresh-DB test structurally could not see it** | guard fires only when `old.passport_number is not null`; the `NOT NULL` at the end of the same transaction closes the allowance permanently |
| 4 | `create_external_professional` tested `current_user`, which inside a `SECURITY DEFINER` function is the *owner* — the check admitted everyone | `session_user = 'prospect_worker'` **and** `auth.uid() is null` |
| 5 | The relationship SELECT policy subqueried `professionals.user_id`, which clients deliberately cannot SELECT — a legitimate read raised `42501` instead of returning false | added `private.is_own_professional(uuid)`, following the `is_org_member` convention |
| 6 | `min(uuid)` does not exist — the claim approval path failed at runtime | count and fetch as two statements |
| 7 | The privilege-hardening `search_path` check filtered on `prosecdef`, silently skipping the five non-definer guard triggers | dropped the filter; all 29 functions are now checked |
| 8 | The VERIFY suite reported `PASS=0 FAIL=0` on any unexpected error — indistinguishable from "never ran" | every assertion block records a `FAIL` with its SQLSTATE in a subtransaction, so one regression can no longer blank the report |

### Adversarial probes (all refused)

| Probe | Result |
| --- | --- |
| call a definer trigger function directly | `0A000 trigger functions can only be called as triggers` |
| set the claim-write GUC, then forge claim state | `42501 permission denied for table professionals` |
| insert a `barbers` row naming another's identity | `42501 permission denied for table barbers` |
| repoint `barbers.professional_id` | `42501 permission denied for table barbers` |
| anon reading `barbers` / `customer_passports` | 0 rows (no anon policy exists) |

---

## 14. Deferred, deliberately

| Item | Owner | Note |
| --- | --- | --- |
| `customer_public_profiles` (opt-in public customer identity) | R6/R7 | `MIGRATION_STRATEGY` §2 Phase 3 #10 placed it in R1B; the brief's §2 hard scope omits it and §3 forbids verified-celebrity UI. **Contradiction resolved in favour of the brief.** |
| `professional_client_showcases` (consent-gated social proof) | R6/R7 | Same. Its §6.1 constraint stands and is recorded here: consent must record professional **and organization**, and must not travel to a new shop. |
| public verified-client count | R6/R7 | Withdrawn in `TARGET_DOMAIN_MODEL` §6.2 |
| relationship aggregate historical backfill | operator, on demand | `select * from public.reconcile_customer_professional_relationships();` |
| `barbers.professional_id` → `NOT NULL` | R2 | needs `CHECK … NOT VALID` → `VALIDATE` → `SET NOT NULL` → drop |
| handle population and the `/@handle` route | R6/R7 | `/s/:slug/barbers/:barberId` keeps working; no handle is invented |
| unclaimed profile publication | R10 | remove one CHECK clause; the projection is already written and reviewed |
| professional merge | R17 | claims fail closed until it exists |
| Worker call site for `create_external_professional` | R4/R10 | the RPC and its grants exist; nothing calls it yet |

### Application changes

**None were required.** The untyped Supabase client and the existing query
layer are unaffected: `barbers` writes send only columns still granted, and the
Passport upsert path was explicitly preserved and re-tested end to end (VERIFY
6.15–6.16). Surfacing the Passport number and the follow graph in the UI is
R6/R7 work.

---

## 15. Deployment actions

**None.** R1B is not deployed in this lot. Nothing was pushed, no container was
recreated, and no production data was touched.

When R1B is deployed it will require, in order:

1. a verified, restore-tested `pg_dump`;
2. `psql -v ON_ERROR_STOP=1 -f supabase/MASTER_R1B_SOCIAL_FOUNDATION_2026_08_26.sql`
   — one transaction, applies fully or rolls back;
3. `psql -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql` → 0 FAIL;
4. `psql -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql` → 0 FAIL.

R1A's outstanding operational actions are unchanged and still outstanding: the
Kong loopback binding has not been applied to the running container, and real
booking email templates remain unimplemented.

### Rollback

R1B contains no irreversible transformation: no table or column dropped, no
type changed, no row deleted, and no existing row's meaning rewritten. The
relationship aggregate is rebuildable by recomputation. The auto-follow and
relationship triggers can be dropped in a one-line forward migration, after
which booking and queue behave exactly as they did before R1B.

The one behaviour change an operator can notice is that deleting a
`professionals` row that backs a roster seat now raises `23503`. No frontend
path deletes one, and no client holds the privilege.

---

## 16. Review note

This report records implementation, migration, regression and **self-review**
performed for R1B: a schema review, an RLS/privilege review, an adversarial
concurrency review, and direct probes of every `SECURITY DEFINER` function,
every GRANT/REVOKE, every foreign key deletion action and every public
projection.

It does **not** claim that a fresh independent external review has occurred.
If the roadmap requires an independent DB/security review as a formal R2 entry
gate, that gate remains separate from the implementation and test results
recorded here.
