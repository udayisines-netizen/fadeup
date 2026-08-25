# R1A — Integrity & Security Foundation

Date: 2026-08-25
Branch: `rebuild/social-first-v2`

## Status

R1A implementation and local validation are complete.

R1A deliberately contains no Social-First R1B schema. Its purpose is to
harden the existing booking, queue, customer identity, service history,
Passport and worker foundations before durable social entities are added.

## Database migrations

R1A consists of nine migrations:

- `20260825100000_customer_link_ownership.sql`
- `20260825100100_appointment_completion_integrity.sql`
- `20260825100200_queue_service_integrity.sql`
- `20260825100300_appointment_history_durability.sql`
- `20260825100400_attribution_provenance.sql`
- `20260825100500_customer_identity_binding.sql`
- `20260825100600_integrity_indexes.sql`
- `20260825100800_passport_persistence.sql`
- `20260825100900_internal_least_privilege.sql`

The missing `20260825100700` number is deliberate.

The previously considered public-professional search INNER→LEFT JOIN change
was not included in R1A because it changes anonymous marketplace product
semantics rather than fixing an integrity/security invariant.

## Integrity changes

### Contact ownership

Anonymous booking and public queue customer resolution no longer adopt a
customer row already owned by another authenticated user.

This closes the contact-detail squatting path while preserving legitimate
unowned-contact linking.

### Appointment lifecycle

Appointment status transitions are now guarded independently of existing
role-specific self-update restrictions.

Illegal lifecycle transitions are rejected even for privileged shop roles.

`appointments.completed_at` is authoritative and database-stamped.

Historical completed appointments are backfilled only where trustworthy
completion evidence already exists. Scheduled `starts_at` is never used as
fabricated evidence of completion.

### Queue lifecycle

Queue lifecycle timestamps are server-controlled.

New/updated rows must respect lifecycle monotonicity.

Pre-existing inconsistent historical rows are deliberately not rewritten.

`customer_id` is frozen after creation so service history cannot later be
reattributed.

### Durable service history

The appointment → barber foreign key no longer cascades service-history
deletion.

Deleting a barber that still owns historical appointments is restricted.

The supported offboarding/account-removal path detaches the roster identity
without deleting historical service records.

### Customer identity and attribution

`customers.user_id` cannot be arbitrarily repointed by staff.

`appointments.booked_by_user_id` is protected from client forgery while
remaining usable by the legitimate booking flow.

### Passport persistence

The customer Passport delete policy was removed.

Passport uniqueness and PostgREST-compatible upsert behavior remain enforced.

### Worker least privilege

The acquisition worker cannot directly SELECT the email outbox.

Email claiming remains available through the dedicated claim function.

Internal-note and related least-privilege boundaries were tightened.

## Worker email safety

The database currently emits eight email template identifiers:

- `professional_application_approved`
- `professional_application_rejected`
- `booking_request_created`
- `booking_confirmed`
- `booking_declined`
- `booking_expired`
- `booking_cancelled`
- `booking_rescheduled`

Only the two professional-application templates currently have reviewed
rendering copy.

Previously, every non-approved template fell through to the rejection copy,
which could cause a booking notification to be delivered as an application
rejection email.

The dispatcher now treats the database template value as an untrusted runtime
string.

`renderEmail()` explicitly validates whether copy exists and fails closed for
booking, unknown, or future templates rather than delivering incorrect copy.

Dedicated regression tests cover this behavior.

Implementation of actual booking email copy remains a separate product task.

## Kong exposure

The Supabase Kong HTTP listener has been changed in Compose from:

`0.0.0.0:18100`

to:

`127.0.0.1:18100`

so public traffic must traverse the host nginx boundary.

This configuration change has NOT yet been applied to the running Kong
container. The container must be recreated as an explicit deployment action
after the R1A code/review gate.

## Validation

### Test A — fresh database replay

- Complete migration chain replayed
- 70 migrations applied
- VERIFY result: `PASS=70 FAIL=0 INFO=2`

Coverage includes contact squatting, lifecycle transitions, completion
authority, queue integrity, account/barber deletion semantics, customer
identity binding, column privileges, Passport persistence, worker least
privilege, RLS/FK/index/security-definer checks.

### Test B — pre-R1A upgrade

Upgrade path:

1. Replay 61 pre-R1A migrations
2. Load deliberately problematic historical fixtures
3. Apply the generated R1A MASTER
4. Execute the complete VERIFY suite

Result:

`PASS=78 FAIL=0 INFO=2`

Upgrade-specific assertions confirm:

- trustworthy `decided_at` is preserved as completion evidence;
- no completion time is invented where evidence does not exist;
- `starts_at` is not misused as a completion timestamp;
- pre-existing inconsistent queue evidence is not silently rewritten;
- the NOT VALID queue constraint still protects new rows;
- the appointment/barber FK validates against historical rows;
- historical customer associations are not guessed/re-written.

### Worker regression

- Typecheck: PASS
- Lint: 0 errors (3 unrelated existing warnings)
- Tests: 13 files PASS
- Tests: 225/225 PASS
- Production TypeScript build: PASS

A dedicated email runtime-contract suite verifies that all six currently
unimplemented booking templates and unknown future values fail closed.

### Web regression

- Typecheck: PASS
- Lint: 0 errors (existing Fast Refresh warnings)
- Tests: 68 files PASS
- Tests: 578/578 PASS
- Production Vite build: PASS

jsdom emits expected unsupported browser API noise for media playback,
`window.scrollTo`, and several React `act(...)` warnings, but the test suite
completes successfully.

### Static validation

- `generate-master-r1a.sh --check`: PASS
- MASTER exactly synchronized with the nine R1A migrations
- `bash -n scripts/generate-master-r1a.sh`: PASS
- `bash -n scripts/disposable-db-test.sh`: PASS
- `git diff --check`: PASS

## MASTER / test tooling

`MASTER_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql` is generated directly from
the nine committed R1A migrations.

`SEED_R1A_PRE_UPGRADE_2026_08_25.sql` exists only to construct a disposable
pre-R1A database containing historical edge cases.

`VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql` uses disposable fixtures and
rollback-based assertions. It must not be treated as production seed data.

## Remaining operational actions

- Do not deploy/recreate Kong as part of this validation commit.
- Do not begin R1B until the R1A review/gating policy is satisfied.
- Apply the Kong loopback binding during a deliberate deployment step.
- Implement real booking email templates before enabling booking email
  delivery expectations.
- The anonymous marketplace search LEFT JOIN/product-behavior decision remains
  deferred.

## Review note

This report records local implementation, migration, regression and manual
review performed for R1A.

It does not claim that a fresh independent external/ECC review has occurred.
If the roadmap requires an independent DB/security/code review as a formal
R1B entry gate, that gate remains separate from the successful implementation
and test results recorded here.
