# FadeUp — Database

Describes the schema that actually exists today, the migration convention, and the RLS
model. Updated as each build lot lands — it does not describe planned or speculative
work. See `docs/architecture.md` for how this fits into the rest of the repo and
`docs/testing.md` for how it's tested.

## Migration convention

All schema changes live in versioned SQL files under `db/migrations/`, named:

```
YYYYMMDDHHMMSS_description.sql
```

The timestamp prefix is the sort/apply order — file names are the source of truth for
ordering, not `git log` or file mtimes. There is no migration-runner tool yet; migrations
are applied in filename order with `psql -f`. Every migration in this repo is written to
be **idempotent** (`create table if not exists`, `create index if not exists`,
`create or replace function`, `drop policy if exists` + `create policy`, `do $$ ... $$`
guards around `alter table ... add constraint`) so re-running the full set is always
safe — this was verified directly (see "Verification" below).

Apply migrations against the local stack with:

```bash
docker cp db/migrations fadeup-supabase-db:/tmp/fadeup_migrations
docker exec fadeup-supabase-db sh -c '
  for f in /tmp/fadeup_migrations/*.sql; do
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f "$f"
  done
'
```

`-1` runs each file in its own transaction so a failing migration doesn't leave a
half-applied file committed.

## LOT 2 migrations (multi-tenant foundation)

| File | Adds |
|---|---|
| `20260809100000_extensions.sql` | `pgcrypto` (declared explicitly for `gen_random_uuid()`, though it ships pre-installed) |
| `20260809100100_util_updated_at_trigger.sql` | `public.set_updated_at()` trigger function, shared by every mutable table |
| `20260809100200_profiles.sql` | `profiles`, `handle_new_user()` trigger on `auth.users`, RLS |
| `20260809100300_organizations.sql` | `organizations`, RLS enabled/forced (policies land later) |
| `20260809100400_memberships.sql` | `membership_role` enum, `memberships`, `handle_new_organization()` trigger on `organizations`, RLS enabled/forced |
| `20260809100500_locations.sql` | `locations`, RLS enabled/forced |
| `20260809100600_audit_logs.sql` | `audit_logs`, RLS enabled/forced, `UPDATE`/`DELETE` revoked from `anon`/`authenticated` |
| `20260809100700_platform_admins.sql` | `platform_admins`, RLS + policy |
| `20260809100800_authz_helper_functions.sql` | `private` schema, `is_org_member()`, `has_org_role()`, `is_platform_admin()` |
| `20260809100900_tenant_rls_policies.sql` | SELECT/INSERT/UPDATE/DELETE policies for `organizations`, `memberships`, `locations`, `audit_logs` |
| `20260809101000_create_organization_rpc.sql` | `public.create_organization()` RPC (see "A real bug found and fixed" below) |

Tables are created with RLS enabled and forced *before* their policies exist (policies
for `organizations`/`memberships`/`locations`/`audit_logs` depend on the `private`
helper functions, which depend on `memberships` existing, so they're necessarily a
later migration). Between a table's creation and its policy migration there are zero
policies, which under `force row level security` means zero access for every role —
a safe, if temporarily inert, state. This was true only transiently while applying the
migration set in order; the deployed schema has every table's policies in place.

## Schema

### `profiles`

One row per `auth.users` row (`id` is both the primary key and the FK to
`auth.users.id`, `on delete cascade`). Holds only basic, non-tenant identity data —
`full_name`, `avatar_url`. Organization membership/roles live in `memberships`, not
here: a profile is not itself tenant data, it's the identity a membership points at.

Row lifecycle is entirely automatic: `handle_new_user()` is a `SECURITY DEFINER` trigger
function on `auth.users` (`AFTER INSERT`) that creates the matching profile row; there is
no client-facing `INSERT` path. Deletion cascades from `auth.users`.

### `organizations`

The tenant root. `name`, `slug` (unique, lowercase/hyphenated, `check`-constrained —
will back public booking URLs `/s/{slug}` in a later lot, not built yet).

### `memberships`

The core tenant-authorization table: `(organization_id, user_id)` → `role`, with a
`unique (organization_id, user_id)` constraint. `role` is `public.membership_role`, a
native Postgres enum with four values: `owner`, `manager`, `receptionist`, `barber` (per
`CLAUDE.md`). Every RLS policy on every other tenant table in this lot resolves through
this table.

**Enum vs. `text` + `check` — the tradeoff, made explicit:** an enum is compact (4
bytes), self-documenting, and rejects invalid values at the type level with no
per-table `check` to keep in sync across migrations. The cost is that adding a role
later needs its own migration (`alter type ... add value if not exists`, which on
Postgres 17 runs as a single statement but still can't be combined with a use of the
new value in the *same* transaction), and removing/renaming a value isn't supported
without a type swap. Given the four roles are fixed by `CLAUDE.md` and additions are
expected to be rare, the enum's compactness and enforcement won out.

An organization always gets its first `owner` membership automatically:
`handle_new_organization()`, an `AFTER INSERT` trigger on `organizations`, inserts a
`memberships` row for `auth.uid()` as `owner` whenever a new org is created by an
authenticated session (skipped when `auth.uid()` is null, e.g. an org inserted directly
by an operator/migration).

**Known, deliberate gap:** nothing yet prevents removing the last owner of an
organization (no `owner`-count invariant on `DELETE`/role-`UPDATE`). Enforcing
"an organization always has ≥1 owner" needs product behavior to be defined first
(block the removal? auto-transfer ownership? require an explicit transfer?) — left for
the lot that builds membership-management UI rather than assumed here.

### `locations`

A physical shop location belonging to an organization (`organization_id`, direct FK,
`on delete cascade`). One organization can have many.

### `audit_logs`

Append-only. No `updated_at` column — deliberately, unlike every other table — because
a log row is a fact about a point in time and is never edited; giving it a column that
implies mutability would be misleading. `organization_id` and `actor_user_id` both use
`on delete set null` (not `cascade`): deleting an organization or a user must not
destroy the audit trail, which may itself record that deletion.

There is **no client-facing `INSERT` policy at all** in this lot — see "RLS model"
below for why. `UPDATE`/`DELETE` are blocked both by having no policy (default deny)
and by an explicit `revoke insert, update, delete on audit_logs from anon, authenticated`
at the grant level, so immutability doesn't rely solely on "nobody wrote a policy for
this."

### `platform_admins`

Platform-level `super_admin` representation: an allow-list table of `user_id`s, **not**
a boolean column on `profiles`. Documented in full in the migration
(`20260809100700_platform_admins.sql`); short version: `profiles` is a table every user
can `UPDATE` their own row of, so a boolean "am I a super admin" flag living on that
same row would sit one missed `with check` tightening away from a privilege-escalation
bug, forever, on every future migration that touches `profiles`. A separate table can be
(and is) given **zero** client-facing write policies for any role — granting/revoking
platform-admin status is an operator action (direct SQL, or a future `service_role`-only
admin endpoint), never something sharing an RLS surface with user self-service.

Platform admins get a **read-only** override in RLS policies elsewhere (`organizations`,
`memberships`, `locations`, `audit_logs` all allow `SELECT` if
`private.is_platform_admin()`), for support/debugging. They get no special `INSERT`/
`UPDATE`/`DELETE` power anywhere — writes that need elevated privilege go through
`service_role` (server-side, outside RLS entirely), not through a client-visible RLS
bypass.

## Authorization helper functions (`private` schema)

`private.is_org_member(org_id)`, `private.has_org_role(org_id, roles[])`, and
`private.is_platform_admin()` are `SECURITY DEFINER`, `STABLE`, `SQL` functions used
inside RLS policies. `private` is **not** in `PGRST_DB_SCHEMAS` (confirmed against the
running `fadeup-supabase-rest` container: only `public,graphql_public` are exposed), so
none of this is reachable over PostgREST directly.

Each function has `set search_path = ''` with a fully schema-qualified body (can't be
hijacked via search-path manipulation), resolves the caller via `(select auth.uid())`
(reads the `request.jwt.claims` session GUC — unaffected by `SECURITY DEFINER`'s role
switch, so it always checks the real caller, never the function's owner), and has
`EXECUTE` revoked from `PUBLIC`/`anon` and granted only to `authenticated`
(`service_role` never needs it — it has `BYPASSRLS` and skips policies entirely). Every
policy wraps calls to these as `(select private.fn(...))`, per Supabase's RLS
performance guidance, so each is evaluated once per statement rather than once per row.

## RLS model

Default deny everywhere: all six tables have `row level security` **enabled and
forced**, and every policy is scoped `to authenticated` — `anon` has no policy on any
of these tables and therefore no access at all (verified, see below). Public,
unauthenticated booking-page access (e.g. resolving `organizations.slug`) is explicitly
out of scope for this lot and will get its own narrowly-scoped `anon` policy when the
public-booking lot is built — not implied or pre-built here.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row only | — (trigger-only) | own row only | — (cascade-only) |
| `organizations` | org member, or platform admin | any authenticated user (see RPC note) | owner/manager of that org | owner of that org |
| `memberships` | any member of that org, or platform admin | owner/manager of that org, with a guard: only an owner can grant the `owner` role | owner/manager of that org, with the same owner-only guard | owner/manager of that org, or the row's own user (self-leave) |
| `locations` | org member, or platform admin | owner/manager of that org | owner/manager of that org | owner/manager of that org |
| `audit_logs` | owner/manager of that org, or platform admin | none (system-written only) | none | none |
| `platform_admins` | own row only | none | none | none |

Core invariant tested and holding: a member of organization A cannot read or write
organization B's rows in `organizations`, `memberships`, `locations`, or `audit_logs`,
regardless of their role in A.

### A real bug found and fixed: `INSERT ... RETURNING` vs. the bootstrap trigger

While writing the verification script for this lot, a genuine RLS interaction bug was
found (not hypothetical, reproduced against the live schema): PostgreSQL's
`INSERT ... RETURNING` re-checks the table's `SELECT` policy against the row being
returned, and it does this **before** any `AFTER ROW` trigger for that same statement
has fired. For `organizations`, the `SELECT` policy requires
`private.is_org_member(id)`, which only becomes true once `handle_new_organization()`
(the `AFTER INSERT` trigger) has created the owner membership — so a bare
`insert into organizations (...) returning *` for a brand-new org fails with
`new row violates row-level security policy for table "organizations"`, even though the
row itself was inserted successfully and the owner membership was correctly created. A
plain `INSERT` with no `RETURNING`, followed by a separate `SELECT`, works fine — the
failure is specific to requesting the row back in the same statement.

This matters beyond a test script: it's exactly what `supabase-js`'s
`.insert(...).select()` (and PostgREST's `return=representation`) generate under the
hood, so a naive direct-table-insert org-creation flow from the frontend would fail for
every single first-time signup.

Fix: `public.create_organization(name, slug)` (`20260809101000_create_organization_rpc.sql`)
is a `SECURITY DEFINER` RPC that performs the insert and returns the row from inside a
function running as its owner (`postgres`, which has `BYPASSRLS`) — RLS, including this
`RETURNING` interaction, doesn't apply inside it at all. Client code creating an
organization should call this RPC, not insert into `organizations` directly and expect
the row back. The direct-table `INSERT` policy is still in place (useful for inserts
that don't need the row back — admin scripts, future `service_role` backends) and the
"creator becomes owner" invariant is enforced in exactly one place either way (the
`handle_new_organization()` trigger), regardless of which path is used.

## Verification

`db/tests/verify_rls.sql` seeds five real `auth.users` rows (Alice/Bob as owners of two
separate orgs, Carol as manager and Dave as barber inside Alice's org, Eve as a platform
admin), then simulates each of their sessions with
`set local role authenticated; select set_config('request.jwt.claims', ...)` — the
approach Supabase documents for testing RLS — and runs the actual queries, printing
real result sets. It cleans its fixtures up in the same run. See the file header for how
to run it against the local stack.

What it proves, with query output (not just "a policy exists"):

- Alice (owner, org A) can read org A; reading org B by id returns zero rows; an
  unfiltered `select * from organizations` shows only org A.
- Alice can read all of org A's memberships (herself, Carol, Dave) but zero rows from
  org B's memberships.
- Alice can read org A's location but not org B's; an `INSERT` of a location into org B
  is rejected by RLS.
- Bob (owner, org B) can read org B but gets zero rows for org A (as an org and as
  memberships).
- Bob attempting to `INSERT` a membership row for himself into org A is rejected.
- Carol (manager, org A) attempting to `UPDATE` her own membership role to `owner` is
  rejected by the `with check` guard (only an existing owner can grant `owner`). A
  matching check exists on `INSERT`: a manager directly inserting a brand-new membership
  row with `role='owner'` for a third party is rejected the same way (tested manually
  outside the main fixture run, after this exact gap was found and closed in
  `20260809100900_tenant_rls_policies.sql` — a manager could otherwise have sidestepped
  the `UPDATE` guard entirely by inserting instead of updating); inserting that same
  user as `barber` succeeds.
- Alice can read her own profile; querying Bob's profile by id returns zero rows; an
  unfiltered `count(*)` on `profiles` as Alice returns `1` (herself only) — no
  cross-user PII leak.
- `audit_logs`: Alice (owner) sees org A's log rows; Dave (barber, same org) sees zero —
  the audit trail is role-gated to owner/manager, not every staff member; Bob sees zero
  rows for org A and only his own org B's rows.
- `platform_admins`: Eve sees her own row; Alice (not an admin) sees zero rows.
- Eve, as platform admin and a member of neither org, can `SELECT` both organizations
  and see membership counts for both — the documented read-only support override.
- `anon` (no session at all): zero rows from every one of the six tables.
- The `INSERT ... RETURNING` bug above, demonstrated directly: the bare form fails, the
  RPC/no-`RETURNING` form succeeds.

The migration set was also applied twice in full (fresh apply, then a full second pass)
to confirm every file is idempotent, and the resulting `pg_policies` / `relrowsecurity` /
`relforcerowsecurity` state was inspected directly to confirm RLS is enabled and forced
on all six tables with no stray policies.

## LOT 3 additions (authentication + onboarding)

| File | Adds |
|---|---|
| `20260809110000_invitations.sql` | `invitations` table, email-normalizing trigger, RLS enabled/forced, partial unique index against duplicate pending invites |
| `20260809110100_onboarding_rpcs.sql` | `get_invitation_by_token()`, `accept_invitation()`, `revoke_invitation()`, `complete_organization_onboarding()` |

### `invitations`

Lets an org owner/manager invite someone by email to join with a specific role.
`(organization_id, email, role, token, invited_by, expires_at, accepted_at, revoked_at)`.
`token` is a unique, high-entropy value generated by application code (not by the
database) and passed in on `INSERT` — see `docs/architecture.md` for how the frontend
generates it. Email is lowercased/trimmed by a `BEFORE INSERT OR UPDATE` trigger so
lookups and the partial unique index (`organization_id, email` where still pending) are
case-insensitive. There is **no client-facing `UPDATE` policy at all** — `accepted_at`
and `revoked_at` can only change via the RPCs below, and `UPDATE` is also explicitly
revoked from `anon`/`authenticated` at the grant level as defense in depth, mirroring
`audit_logs`' "no client write path" pattern from LOT 2.

RLS: `SELECT`/`INSERT`/`DELETE` restricted to owner/manager of the invitation's
organization (`INSERT` carries the same "only an owner may grant the `owner` role" guard
used on `memberships`, plus `invited_by` must equal the caller). The invitee is not yet a
member and has no `SELECT` access to this table at all — they use
`get_invitation_by_token()` instead.

### Onboarding / invitation RPCs

All four are `SECURITY DEFINER`, `set search_path = ''`, schema-qualified, with `EXECUTE`
revoked from `PUBLIC` and granted explicitly — same pattern as LOT 2's `private.*`
helpers and `create_organization()`.

- **`get_invitation_by_token(token)`** — `anon`-callable. Returns the org name, role,
  email, and expiry/accepted/revoked flags for a token, or zero rows for an unknown one.
  Lets an accept-invite screen render before the visitor has signed in.
- **`accept_invitation(token)`** — `authenticated`-only. The *only* path that turns an
  invitation into a membership. Locks the invitation row (`for update`) so two concurrent
  redemptions of the same token can't both succeed; requires the caller's
  `auth.users.email` to match the invitation's email (case-insensitively) so a leaked
  token can't be redeemed by an unrelated account; rejects revoked/already-accepted/
  expired invitations with a specific error each; upserts the membership
  (`on conflict (organization_id, user_id) do update set role = excluded.role`) so
  accepting always grants at least the invited role.
- **`revoke_invitation(id)`** — owner/manager-only cancellation of a pending invitation.
  Because the row lookup happens by `id` and the `id` is normally obtained via a `SELECT`
  on `invitations` (RLS-scoped to owner/manager), a non-owner/manager caller who somehow
  has an invitation's `id` gets `invitation not found` rather than `not authorized` — RLS
  hides the row from their query entirely before the function's own authorization check
  ever runs, which avoids confirming an invitation's existence to someone who has no
  business knowing about it.
- **`complete_organization_onboarding(org_name, org_slug, location_name, timezone)`** —
  atomic "create my shop" bootstrap: calls `create_organization()` (org + owner
  membership via the existing trigger) and inserts the first location in the same
  function call. If the location insert fails for any reason, the entire call rolls
  back — including the organization row and its owner membership — so onboarding can
  never leave a half-created organization behind. Client code should call this instead of
  separate `organizations`/`locations` inserts.

### LOT 3 verification

`db/tests/verify_onboarding_and_invitations.sql` seeds two `auth.users` fixtures (Frank
the founder, Grace the invitee) and, with real query output rather than assertions-only,
proves: onboarding creates an org + owner membership + location atomically; a failing
location insert rolls back the whole call (confirmed via an explicit orphan-org count
after); `anon` can preview an invitation by token with no session at all; Grace can
accept an invitation and receives the invited role; accepting the same token twice fails;
redeeming an invitation issued to a different email fails; a non-owner/manager cannot
revoke (and gets "not found," not "not authorized" — see above); an owner can revoke; and
a revoked invitation can no longer be accepted. RLS state and `SECURITY DEFINER` flags on
all four functions were also independently confirmed via `pg_class`/`pg_policies`/
`pg_proc`. Fixtures are fully cleaned up at the end of the run (verified: 0 remaining).

## LOT 6 additions (organization / locations / staff / chairs)

| File | Adds |
|---|---|
| `20260809120000_staff_profiles.sql` | `staff_profiles`, `handle_new_membership()` auto-provisioning trigger on `memberships`, location-consistency trigger, RLS |
| `20260809120100_barbers.sql` | `barbers`, staff-profile-consistency trigger, RLS |
| `20260809120200_chairs.sql` | `chairs`, location-consistency trigger, RLS |

### `staff_profiles`

The operational/public-facing staff record, deliberately distinct from two other tables
that look similar at a glance: `memberships` (pure authorization — user + org → role, no
name/bio/anything human-facing) and `profiles` (bare account identity, **not** org-scoped
and **not** visible to teammates — `profiles_select_own` only lets a user read their own
row, a deliberate LOT 2 gap). `staff_profiles` is org-scoped and readable by any member of
that org, which is what finally lets `/app/team` show real display names instead of the
`Member <8 chars>` placeholder from LOT 3.

Applies to any membership role (owner/manager/receptionist/barber), not barbers
specifically — `display_name`, `title`, `bio`, and a primary `location_id` are meaningful
for any staff member. `barbers` (below) is the further specialization for staff who
actually take appointments.

**Auto-provisioned, not manually created:** `handle_new_membership()`, an `AFTER INSERT`
trigger on `memberships`, creates the matching `staff_profiles` row automatically —
`display_name` defaults from `profiles.full_name` when available, falling back to
`'Team member'`. This fires for every path that creates a membership (org creation's
owner trigger, `accept_invitation`, or a direct owner/manager insert), so there is no
state where an organization has members without a usable roster. Owner/manager can edit
the auto-generated `display_name`/`title`/`bio` afterward via the normal update policy.
**Deliberately deferred:** the staff member editing their own `staff_profiles` row
(self-service bio/photo) is not built — only owner/manager can write, for now.

**Tenant-consistency guard:** a `BEFORE INSERT OR UPDATE` trigger
(`check_staff_profile_location_consistency`) rejects a `location_id` that doesn't belong
to the same `organization_id`, enforced at the trigger level (not only RLS `with check`)
so it holds even for `service_role`/direct-SQL writes.

RLS: `SELECT` open to any org member (the entire point of this table) or platform admin;
`INSERT`/`UPDATE`/`DELETE` restricted to owner/manager, and `INSERT` additionally requires
the target `user_id` to already hold a membership in that organization — a staff profile
can never be created for a non-member.

### `barbers`

Marks a `staff_profiles` row as a bookable barber. Kept as its own table rather than a
boolean column on `staff_profiles` because barber-specific concerns land in later lots
(service eligibility in LOT 7, commission rules in LOT 17) and will attach to this row
specifically. For LOT 6, deliberately minimal: just `is_bookable` and the tenant-
consistency guarantee that `staff_profile_id` belongs to the same `organization_id`
(same trigger-level enforcement pattern as above). Working hours, time off, and service
eligibility are explicitly out of scope — LOT 7's working-time engine. RLS: any org member
can `SELECT`; owner/manager only for writes.

### `chairs`

Structural inventory of physical chairs per location — **not** a live occupancy/session
state machine. `is_active` means "this chair currently exists in the shop's inventory,"
not "currently occupied." A real operational status (available/reserved/occupied) needs
concurrency-safe claiming logic (two barbers must never claim the same chair) that belongs
to Chair Mode (LOT 11) — adding a half-built status column now, with nothing behind it,
would be worse than not having one. Same `location_id`-consistency trigger pattern as
`staff_profiles`. RLS: any org member can `SELECT`; owner/manager only for writes.

### LOT 6 verification

`db/tests/verify_staff_locations_chairs.sql` seeds two `auth.users` fixtures (Henry the
founder, Ivy the invited barber) and proves, with real query output: `staff_profiles` is
auto-created for the owner on org creation *and* for an invitee via `accept_invitation`
(both paths through `handle_new_membership()`, not just one); an owner can add a second
location, a chair, and mark a teammate a barber — looking up that teammate via
`staff_profiles.display_name`, not `auth.users`/`profiles` (which correctly denies
cross-user access, confirmed as a real RLS error when the test script first tried the
wrong approach); a chair referencing another organization's location is rejected by the
consistency trigger; a barber (non-owner/manager) is rejected by RLS when attempting to
create a chair; `anon` has zero access to all three tables. RLS state
(`relrowsecurity`/`relforcerowsecurity`/`pg_policies`) was independently re-confirmed
against the live database, and the migration set was re-applied to confirm idempotency.
Fixtures fully cleaned up (verified: 0 remaining).

## Not yet built

- Public (anon) access path for booking-page org lookup by `slug` — later, public-
  booking lot.
- `services`, `appointments` — later lots, per `CLAUDE.md`'s LOT sequencing.
- Self-service `staff_profiles` editing by the staff member themselves (currently
  owner/manager-only writes).
- An "an org always has ≥1 owner" invariant (see `memberships` above) — still deferred,
  now also relevant to `revoke_invitation`/membership removal UI once built.
- A real occupancy/session state machine for `chairs` — LOT 11 (Chair Mode).
- Working hours, time off, and service eligibility for `barbers` — LOT 7.
- Any writer for `audit_logs` — no feature yet produces audit events; the table and its
  RLS exist so the first feature that needs to record one has a safe place to write to.
- Invitation delivery (email sending) — this lot creates and stores the invitation and
  its token; actually emailing the accept link is notification infrastructure, out of
  scope here (per `CLAUDE.md` LOT 46/19).
