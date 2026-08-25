# R1 — Security Model

Status: reviewed (Phase 2 — post Agent-B database review and Agent-C security review)
Companion to `R1_DOMAIN_DECISIONS.md`.

This document is the access-control contract for every structure R1
introduces. Mission §52 requires an explicit access matrix *before* the table
exists; §53 requires RLS at creation time, not later.

---

## 0. Platform invariants R1 inherits and must not weaken

Verified against a disposable replay of all 61 migrations, not assumed:

| Invariant | Measured |
| --- | --- |
| RLS enabled **and forced** on every `public` table | 89 / 89 |
| Policies granting to `anon` or `PUBLIC` | **0** |
| `SECURITY DEFINER` functions without `set search_path` | **0** |
| `rolbypassrls` | `postgres` **true**, `service_role` true; `authenticated`, `anon`, `prospect_worker` **false** |

The last row is load-bearing: a `SECURITY DEFINER` function owned by
`postgres` writes through `FORCE` RLS, while ordinary sessions cannot. The
established precedent is `appointment_claim_tokens` — owned by `postgres`,
`enable` + `force` RLS, and **zero policies of any kind** — yet
`book_public_appointment` inserts into it. R1 reuses exactly this shape for
its trigger-maintained tables.

**R1 keeps all four counters at their current values.** VERIFY asserts each.

---

## 1. The primary threat R1 had to design around

### T0 — social attribution from a caller-typed phone number

`link_customer_from_contact_info()` (BEFORE INSERT on **both** `appointments`
and `queue_entries`) resolves the CRM row from *caller-supplied* contact
details. Attributing follows or relationships through
`appointments.customer_id → customers.user_id` therefore lets an
**unauthenticated** attacker act in a victim's name:

1. Victim V books once while signed in; `resolve_customer_for_user` stamps V's
   phone/email onto V's linked CRM row `R` (`R.user_id = V`).
2. Attacker A, signed out, calls `book_public_appointment` at that shop typing
   V's phone. `auth.uid()` is null → `customer_id` null → the trigger matches `R`.
3. That row is inserted **already `status='confirmed'`**
   (`20260819210000_booking_auto_confirm.sql`). Naive attribution creates
   `professional_follows(follower_user_id = V, source='auto')` — a public
   social action forged in V's name.
4. On completion, V gains a verified-client relationship with a barber V never
   met, and the shop learns V's `auth.users` UUID.
5. The barber requests a showcase against that relationship; only V's mis-tap
   separates the attacker from "Already cutting V ✓".

The `join_public_queue` variant is cheaper — no slot, no service, and shops
complete queue entries routinely.

### Mitigation adopted

Attribution never reads `customers.user_id`. R1 adds explicit provenance
stamped **only** from `auth.uid()` inside the two self-service RPCs:

```
appointments.booked_by_user_id  uuid null -> auth.users on delete set null
queue_entries.booked_by_user_id uuid null -> auth.users on delete set null
```

Both attribution triggers require `booked_by_user_id is not null` **and**
`booked_by_user_id = customers.user_id`. The attacker's anonymous booking
carries `NULL`, so it attributes to nobody.

This also neutralises the amplifier Agent C raised — `customers_update` lets
any owner/manager set `customers.user_id` to an arbitrary UUID. Since
attribution no longer trusts that column, a shop cannot mint social facts by
editing it. That policy's breadth is **pre-existing**, not introduced by R1;
it is logged for R2 rather than changed here, because tightening `customers`
write rules is a booking-path change outside this lot.

### Mitigation deliberately REJECTED

Agent C proposed adding `and c.user_id is null` to both lookups inside
`link_customer_from_contact_info()`. R1 does **not** do this. Two reasons,
both verified in source:

1. **It would not work.** The `insert ... on conflict do nothing` is followed
   by an *unfiltered* re-select fallback (lines 82–96). Filtered lookups would
   miss `R`, the insert would conflict on `customers_org_phone_unique`, and
   the fallback would land straight back on `R`.
2. **Filtering the fallback too would regress booking.** A legitimate customer
   booking anonymously (has an account, not signed in) would stop being linked
   to their own CRM row, silently breaking `get_my_appointments`. Mission §48
   forbids regressing booking.

The root defect is real but belongs to the lot that owns that trigger. It is
recorded in `DEPRECATIONS.md`. R1's `booked_by_user_id` closes the
R1-introduced exposure completely without touching booking's matching
semantics.

---

## 2. Trigger execution model (Agent-B C2)

Queue completion is **not** an RPC. `apps/web/src/lib/queries/queue.ts:206`:

```ts
const { error } = await supabase.from('queue_entries').update(payload).eq('id', input.id)
```

That is a raw PostgREST `PATCH` executing as role `authenticated`. A trigger
function that is not `SECURITY DEFINER` runs with the invoker's privileges;
`authenticated` has no write grant on the new tables, and `FORCE` RLS applies
regardless. The insert would raise `42501`, the AFTER trigger would abort the
statement, and **a barber could not mark a client done** — precisely the
§48/§49 regression this lot must avoid.

Therefore **all three attribution triggers are `SECURITY DEFINER` with
`set search_path = ''`**, matching the existing precedent
`link_customer_from_contact_info()` and `notify_new_appointment()`.

Two further consequences, both adopted:

* **Fire on `INSERT OR UPDATE`.** Rows are *born* `confirmed` (and a manager
  can insert a `completed` row via PostgREST), so an UPDATE-only trigger is
  dead code on the primary path. Guard:
  `(TG_OP='INSERT' and NEW.status=...) or (TG_OP='UPDATE' and OLD.status is distinct from NEW.status and NEW.status=...)`.
* **Total failure containment.** Early returns handle a missing customer or
  professional, but not unique/FK violations, `statement_timeout`, deadlock or
  serialization failure — any of which would abort a booking or a queue
  completion. Each trigger body is therefore wrapped in
  `exception when others then raise warning ...; return new;`.

  Swallowing is defensible **here and nowhere else**, because
  `customer_professional_relationships` is a *rebuildable aggregate* over
  `appointments`/`queue_entries`: a dropped side-effect is recoverable, a
  rolled-back haircut is not. To make that claim real rather than rhetorical,
  R1 ships `rebuild_customer_professional_relationships()` in the same
  migration. The `raise warning` keeps the failure visible in logs rather than
  truly silent.

  Auto-follow is **not** rebuildable (§20 forbids deriving follows from
  bookings, and reconciliation could not distinguish "never followed" from
  "explicitly unfollowed"). It is therefore explicitly best-effort and lossy,
  and documented as such.

**Trigger naming.** PostgreSQL fires same-timing triggers in alphabetical
order. `appointments` already has `appointments_notify_new`. The social
triggers are named `appointments_social_auto_follow`,
`appointments_social_relationship`, `queue_entries_social_relationship` so
they sort *after* existing operational triggers by design rather than by
accident.

**Recursion:** none. The triggers write only to `professional_follows` and
`customer_professional_relationships`, neither of which has triggers, and
neither writes back. This invariant is stated in SQL comments so a later lot
does not break it.

---

## 3. RLS access matrix (§52)

Roles: **anon**, **cust** (authenticated customer), **pro** (the professional
themselves), **shop** (member of the owning organization), **owner**
(owner/manager), **plat** (platform admin via `private.is_platform_admin()`).

`—` = no policy grants it. `RPC` = reachable only through a
`SECURITY DEFINER` projection, never by direct table access.

### `professionals`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | RPC | RPC | own row | org's linked pros | org's linked pros | all |
| INSERT | — | — | — | — | — | RPC |
| UPDATE | — | — | own row, **restricted columns** | — | — | RPC |
| DELETE | — | — | — | — | — | RPC |

RLS has no column granularity, so column grants are the only real control:

```sql
revoke update (user_id, prospect_id, source, claim_state, verification_state)
  on public.professionals from authenticated, anon;
revoke select (prospect_id, user_id, source)
  on public.professionals from authenticated, anon;
```

plus `guard_professional_update()` (BEFORE UPDATE) rejecting changes to those
columns unless `private.is_platform_admin()` — modelled on the existing
`guard_professional_application_update()`.

The `revoke select` matters because `prospect_id` is a join key into the whole
Worker sales estate, and its presence silently discloses "this tenant was
scraped before they signed up".

**Derived-state drift guard (Agent-B H4).** `claim_state` is determined by
`user_id`, so the two can disagree and the projection would happily serve a
`claimed` professional with `user_id IS NULL`. Encoded as a constraint rather
than a convention:

```sql
check ((claim_state = 'claimed') = (user_id is not null))
```

### `professional_follows`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | count via RPC | own edges | count via RPC | — | — | all |
| INSERT/UPDATE/DELETE | — | — | — | — | — | — |

**No client write policy at all.** Mutation goes through
`follow_professional()` / `unfollow_professional()` (`SECURITY DEFINER`,
owner-scoped) and the auto-follow trigger. A raw `PATCH` setting
`has_explicit_unfollow = false` would permanently erase the §17 opt-out.

The state table in `R1_DOMAIN_DECISIONS.md` §3 shows that
`state='following' AND has_explicit_unfollow` is never legal. Encoded:

```sql
check (not (state = 'following' and has_explicit_unfollow))
```

### `customer_professional_relationships`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | — | own rows | rows naming them | rows for **their own** `organization_id` | same | all |
| INSERT/UPDATE/DELETE | — | — | — | — | — | — |

**No write policy at all** — trigger-maintained only. Without this, an
authenticated user could `POST` themselves a relationship with
`completed_interaction_count = 99`, forging verified-client status outright.

Uniqueness is **`(customer_user_id, professional_id, organization_id)`** — not
the two-column key an earlier draft proposed. Both reviewers found this
independently. With a two-column key, `on conflict do update` overwrites
`organization_id` with whichever shop most recently completed a service.
Concretely: barber P serves customer C twenty times at shop A, moves to shop B
(the exact scenario `professionals` exists for), and serves C once. Shop B
would read `completed_interaction_count = 21` with `first_completed_at` from
two years earlier — **twenty services transacted at a competitor** — while
shop A loses access to history that genuinely occurred at A. A row's tenant
would be reassigned by a write from a different tenant, breaking CLAUDE.md's
immutable-ownership rule.

`organization_id` is additionally immutable via a BEFORE UPDATE guard.

The cross-org "is a verified client" boolean and total count are computed by
aggregating rows **inside the projection RPC**. The aggregate is the
professional's fact; the per-org row is the tenant's fact; they are not the
same row.

**FK action, decided explicitly (Agent-B H5).** `organization_id` stays
`NOT NULL` with `ON DELETE CASCADE`, consistent with `appointments`,
`customers`, `barbers` and `queue_entries`. Rationale: this table is an
aggregate whose *evidence* (`appointments`, `queue_entries`) already cascades
from `organizations`. Retaining the aggregate after its evidence is gone would
assert unrebuildable history. §2's durability guarantee applies to *identity*
— `professionals` rows survive, as does the professional's relationship
history at every shop that still exists — not to per-shop service history
whose underlying records have been erased. This is a deliberate trade,
recorded here so it is not mistaken for an oversight.

### `customer_public_profiles`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | RPC, `is_public` only | own row | RPC | RPC | RPC | all |
| INSERT | — | own row | — | — | — | — |
| UPDATE | — | own row, **restricted columns** | — | — | — | RPC |
| DELETE | — | own row | — | — | — | — |

```sql
revoke update (verification_state) on public.customer_public_profiles
  from authenticated, anon;
```

plus a BEFORE UPDATE guard. Without **both**, the owner-row UPDATE policy of
the established shape (`using (user_id = auth.uid()) with check (...)`) permits
updating *every column of that row* — so
`PATCH /rest/v1/customer_public_profiles?user_id=eq.<me>` with
`{"verification_state":"verified"}` self-verifies. A platform-only RPC cannot
prevent a direct table write; only the column grant and the guard can.

Verification changes **only** via `set_customer_verification()` (platform-only),
which writes the state and its audit record in one transaction.

### Verification audit — reuses `platform_audit_log` (Agent-B M5)

An earlier draft proposed a dedicated `customer_verification_events` table.
**Dropped.** The existing `public.platform_audit_log`
(`id, actor_user_id, action, target_type, target_id, metadata jsonb,
created_at`) is append-only, indexed on `(actor_user_id)` and
`(created_at desc)`, and carries a single `is_platform_admin()`-only SELECT
policy — a verbatim match for what §24 requires. Verification writes
`action='customer_verification.changed'`,
`target_type='customer_public_profile'`, `target_id=<user_id>`, with
`from_state`/`to_state`/`reason` in `metadata`.

This drops R1 from seven new tables to six and honours §29's principle: do not
create a table because a concept has a name.

### `professional_client_showcases`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | RPC (approved + public only) | rows about them | own rows | — | — | all |
| INSERT | — | — | own, `pending` only | — | — | — |
| UPDATE | — | **consent columns only, own rows** | — | — | — | — |
| DELETE | — | — | **—** | — | — | — |

INSERT `WITH CHECK` pins `consent_state='pending'`, `decided_at is null`,
`revoked_at is null`, and
`professional_id in (select id from professionals where user_id = auth.uid())`.
Only the customer moves consent. Per-command policies are mandatory — a single
`FOR ALL` policy would let the professional update consent.

Two further guards, both essential:

* **Binding trigger.** `relationship_id NOT NULL` proves only that *some*
  relationship exists, not that *this* one binds these parties. A BEFORE
  INSERT OR UPDATE trigger asserts the referenced relationship has the same
  `professional_id` **and** `customer_user_id` **and**
  `completed_interaction_count >= 1`. Without it a professional supplies any
  relationship UUID they have seen, and "genuineness is a foreign key" is
  worthless.
* **No DELETE for the professional**, and `revoked` is terminal in the
  transition trigger — otherwise `declined`/`revoked` reset by
  delete-then-reinsert, giving unlimited re-solicitation of a customer who
  already said no.

Publishability requires **four** conditions: a genuine relationship,
`consent_state='approved'`, `customer_public_profiles.is_public`, and — for the
✓ — `verification_state='verified'` evaluated **live** in the RPC. `is_public`
is required because otherwise a customer who is private by default (§23) but
once approved a showcase is rendered on a public page. Live evaluation makes a
`revoked` badge disappear immediately.

### `professional_profile_claims`

| | anon | cust | pro | shop | owner | plat |
| --- | --- | --- | --- | --- | --- | --- |
| SELECT | — | own claims | own claims | — | — | all |
| INSERT | — | own, `pending` only | own, `pending` only | — | — | — |
| UPDATE | — | own, withdraw only | own, withdraw only | — | — | all |
| DELETE | — | — | — | — | — | — |

Modelled directly on `20260813170000_professional_applications.sql`, whose
header states the governing principle: **AUTHENTICATED != AUTHORIZED — the
application row is the workflow, never the permission.** That table is a close
cousin (applications create a *new organization*; claims take over an
*existing identity*), so R1 copies its index and guard-trigger conventions
rather than inventing new ones.

* INSERT `WITH CHECK`: `claimant_user_id = auth.uid() and state = 'pending'
  and decided_at is null and decided_by is null and rejection_reason is null`,
  plus a trigger rejecting claims whose target already has
  `professionals.user_id is not null`.
* Two UPDATE policies (`_update_own` limited to `state='pending'`,
  `_update_platform` gated on `private.is_platform_admin()`), and
  `guard_professional_profile_claim_update()` rejecting changes to `state`,
  `decided_by`, `decided_at`, `professional_id`, `claimant_user_id` by a
  non-platform-admin. Without this the claimant self-approves in one `PATCH`;
  the partial unique index enforces *at most one* approval, not a legitimate one.

**Race and takeover safety.** An earlier draft argued
`professionals.user_id UNIQUE` was a third independent guard. **That argument
was backwards** (Agent-B H3): it prevents one *user* owning two identities, not
one *identity* being handed to a second user. Every backfilled professional
already has `user_id` set, and approving a claim for user A on professional P
where `P.user_id = B` would succeed — silently transferring B's identity,
followers and verified clients to A. The real guards are:

```sql
unique index (professional_id) where state = 'approved'            -- one approval, ever
unique index (professional_id, claimant_user_id) where state = 'pending'
check/guard: approval rejected unless professionals.user_id is null -- no takeover
professionals.user_id unique                                        -- one identity per account
```

plus `select ... for update` on the `professionals` row inside the approval
transaction. Withdrawal of an approved claim must null `professionals.user_id`
in the same statement, or the partial unique frees a slot that reality does not.

---

## 4. Threat model outcomes (§87)

| | Threat | Outcome |
| --- | --- | --- |
| S1 | Enumerating private customer profiles | Mitigated — no table SELECT for non-owners; projection requires `is_public`. **Residual (LOW, accepted):** globally-unique handle/username is an existence oracle via unique-violation errors. Documented; every major social product shares it. |
| S2 | Professional reading another shop's customers | Mitigated — relationship uniqueness includes `organization_id`, RLS keys on the row's own org, org immutable. |
| S3 | Forging verified-client status | Mitigated — no write policy on the relationship table; trigger-only; attribution requires proven booker identity. |
| S4 | Forging verified public-profile status | Mitigated — column `revoke update` + guard trigger; state changes only via platform RPC that also writes the audit record. |
| S5 | Publishing a celebrity relationship without consent | Mitigated — professional may only insert `pending`; only the customer moves consent; binding trigger ties the relationship to both parties; `is_public` required; no professional DELETE; `revoked` terminal. |
| S6 | Worker raw data leaking | Mitigated — `prospect_*` untouched and non-public; `revoke select (prospect_id, …)` on `professionals`; projections use explicit column lists; no `prospect_worker` grant on `professionals`. |
| S7 | Claiming another shop's external profile | Mitigated — claim insert pinned to `pending`; already-claimed targets rejected; approval platform-only. |
| S8 | Duplicate claim race | Mitigated — partial uniques + takeover guard + `for update` in the approval RPC. |
| S9 | Cross-tenant membership modification | Mitigated — `barbers.professional_id` is **derived by trigger, never client-supplied**, plus `revoke update (professional_id)`. Without this, shop B's owner could `PATCH` their barber row to point at shop A's star professional, minting follows and showcases in A's name. |
| S10 | Passport ID enumeration | Mitigated — 80-bit random base32, owner-only RLS, exposed by no anonymous path; `get_shared_passport` returns a fixed curated list excluding it. **Forward risk documented on the column:** `passport_number` is an *identifier, not an authenticator*; any future lookup-by-number must go through the revocable, expiring `customer_passport_shares` mechanism. |

---

## 5. Tenant-scoping exemption (Agent-B H7)

CLAUDE.md requires every business resource to carry `organization_id` or an
immutable ownership chain to one. **Five of the six new tables have neither**,
and that is deliberate:

| Table | Why no `organization_id` |
| --- | --- |
| `professionals` | The entire point is to *outlive* org membership (§14). Org-scoping it would recreate the defect R1 exists to fix. |
| `professional_follows` | A customer↔professional social edge. Neither party is a tenant resource; the edge survives the professional changing shop. |
| `customer_public_profiles` | Customer-owned platform identity, org-agnostic — same posture as the existing `customer_profiles` and `customer_passports`, neither of which is org-scoped. |
| `professional_client_showcases` | Consent between a customer and a professional identity, not a shop. |
| `professional_profile_claims` | A platform-arbitrated workflow about identity ownership; the claimant may have no organization yet. |
| `customer_professional_relationships` | **Is** tenant-scoped — `organization_id NOT NULL`, in the unique key, immutable, and the RLS anchor. |

The isolation argument: no tenant *business* data lives in these tables. A
professional working at two organizations exposes nothing of org A to org B,
because nothing operational hangs off `professionals` — availability,
services, hours, appointments and queue entries all remain anchored to
`barbers`/`organizations`. The single table that records a tenant-scoped fact
carries the tenant column and is isolated on it.

---

## 6. Review adjudication

**Adopted from Agent C (security):** column-level `revoke` + guard triggers on
every client-reachable state column (C2, H2, H3); no write policies on
trigger-maintained tables (C3); `organization_id` in the relationship key,
immutable (H1); showcase binding trigger and pinned insert (H4); claims
modelled on `professional_applications` (H5); no professional DELETE and
terminal `revoked` (M2); `force` RLS on all new tables (M3); no
`prospect_worker` grant (M5); `is_public` as a fourth publishability condition
with live verification (M6); passport-number column comment (L2).

**Adopted from Agent B (database):** `INSERT OR UPDATE` trigger guards (C1);
`SECURITY DEFINER` triggers (C2); three-column relationship key (C3); `text` +
`lower()` unique instead of `citext` (H1); `barbers.professional_id` populated
by trigger for new rows (H2); claim-takeover guard (H3); derived-state CHECK
(H4); explicit FK actions (H5); exception containment plus a reconciliation
function (H6); tenant-exemption paragraph (H7); deterministic backfill
ordering, completeness assertion, and *not* copying `staff_profiles.is_public`
(H8); capped counts (M1); the concrete index list (M2); `NOT VALID` FK then
`VALIDATE`, `lock_timeout`, statement-level idempotency (M3); text+check for
evolving states (M4); collapsing verification events into `platform_audit_log`
(M5); deterministic trigger naming (M6); the wider limitation statement (M7);
the `has_explicit_unfollow` CHECK (L3); the MASTER generator (L4).

**Rejected:** the change to `link_customer_from_contact_info()` — ineffective
as proposed and regression-prone if completed (§1).

**Deferred to R17 with a documented fail-closed:** a Worker-scraped
professional who later signs up natively ends up with two identity rows, and
approving their claim raises a unique violation. The correct resolution is a
merge (repoint `barbers`, follows and relationships, tombstone, with an audit
row per §40). R1 does not build the claim engine (§43), so the approval RPC
**detects this case and fails closed with an explicit error** rather than
merging unsafely. Merge is a hard prerequisite for R17 and is recorded as such
in `DEPRECATIONS.md`.
