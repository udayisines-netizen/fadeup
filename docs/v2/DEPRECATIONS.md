# FadeUp — Deprecation and Debt Register

Opened by R1. Each entry names the concept, what replaces it, who still
consumes it, what has to be true before it can be removed, and which lot owns
that removal.

R1 deleted nothing. Everything below is deliberately still live.

---

## D1 — `barbers.professional_id` is nullable

**Legacy concept.** The column is nullable, so a `barbers` row can in
principle exist without a durable identity.

**Replacement.** None — the column is new. The nullability is transitional.

**Why it is nullable today.** A `NOT NULL` constraint could not be added in
the same migration that creates the column: existing rows have no value until
the backfill runs, and the backfill is deliberately a separate migration.

**Current consumers.** The three attribution triggers treat `NULL` as "no
professional" and return early, so a missing link silently loses
verified-client evidence rather than raising.

**Removal prerequisite.** `select count(*) from barbers where
professional_id is null` returns 0 and has stayed 0 through a release cycle.
`assign_barber_professional()` already guarantees this for every new row.

**Removal method** (avoids a full-table `ACCESS EXCLUSIVE` scan):

```sql
alter table public.barbers
  add constraint barbers_professional_id_present
  check (professional_id is not null) not valid;
alter table public.barbers validate constraint barbers_professional_id_present;  -- SHARE UPDATE EXCLUSIVE
alter table public.barbers alter column professional_id set not null;            -- uses the validated CHECK
alter table public.barbers drop constraint barbers_professional_id_present;
```

**Target lot.** R2.

---

## D2 — no merge path between two `professionals` rows

**The problem.** `professionals.user_id` is `UNIQUE`, and
`approve_professional_claim()` refuses to proceed when the claimant already
has an identity. That is the correct *safe* behaviour, but it means the single
most likely real claim — a barber Worker scraped, who later signed up natively
and so already has a backfilled identity — **fails closed with an explicit
error** rather than succeeding.

**What is actually needed.** A platform-only merge that, in one transaction:
repoints `barbers.professional_id`, `professional_follows.professional_id`,
`customer_professional_relationships.professional_id` and
`professional_client_showcases.professional_id` from the duplicate onto the
survivor; resolves the resulting unique-key collisions (a customer may follow
*both* identities); tombstones the loser rather than deleting it; and writes a
merge audit record carrying source, destination, reason, confidence, timestamp
and responsible actor (mission §40).

**Current consumers.** `approve_professional_claim()` raises with a message
pointing at this file.

**Removal prerequisite.** The merge RPC exists, is covered by tests including
the follow-collision case, and the audit record is in place.

**Target lot.** R17 — and this is a **hard prerequisite**, not a nice-to-have.
The outreach/closer flow cannot convert a scraped professional who has since
signed up until it exists.

---

## D3 — `link_customer_from_contact_info()` trusts caller-typed contact details

**Legacy concept.** The `BEFORE INSERT` trigger on `appointments` and
`queue_entries` (from `20260809180100_link_customers_to_bookings.sql`)
find-or-creates the `customers` row by matching the *caller-supplied*
`customer_phone`, then `lower(customer_email)`. An anonymous caller who knows
a victim's phone number gets their booking attached to the victim's CRM row.

**Status.** Pre-existing, **not introduced by R1**, and R1 does not fix it.

**What R1 did instead.** It refused to build on it.
`appointments.booked_by_user_id` / `queue_entries.booked_by_user_id` carry the
only trustworthy account attribution, and every social fact is derived from
those. The contact-matching edge remains untrusted rather than being trusted
more.

**Why R1 did not fix it.** Two reasons, both verified in source rather than
assumed. First, the obvious fix — adding `and c.user_id is null` to the two
lookups — does not work: the function's `insert ... on conflict do nothing` is
followed by an *unfiltered* re-select fallback that lands straight back on the
victim's row. Second, filtering that fallback as well would stop a legitimate
customer who books anonymously from being linked to their own CRM row,
silently breaking `get_my_appointments` for that booking. That is a booking
regression, which mission §48 forbids R1 from causing.

**Removal prerequisite.** A booking-lot decision about what an anonymous
booking may match, plus a migration path for the re-select fallback.

**Target lot.** Whichever lot next owns the booking write path. Until then the
mitigation is that nothing security-sensitive reads this edge.

---

## D4 — `customers` may be re-pointed at any account by an owner or manager

**Legacy concept.** `customers_update`'s `WITH CHECK` constrains only
`organization_id`, so any owner/manager/receptionist can run
`update public.customers set user_id = '<any uuid>'`.

**Status.** Pre-existing. R1 does not change it.

**Why it matters less after R1.** Before `booked_by_user_id`, this would have
let a shop mint verified-client relationships for any account UUID it could
learn. Attribution no longer reads `customers.user_id`, so that lever is gone.

**Removal prerequisite.** A `BEFORE UPDATE` guard rejecting client-driven
changes to `customers.user_id`, in the same style as
`guard_professional_application_update()`.

**Target lot.** R2.

---

## D5 — no generated database TypeScript types

**Legacy concept.** `apps/web/src/lib/supabase.ts` creates an **untyped**
`SupabaseClient`. There is no `Database` generic, no `database.types.ts`, and
no `supabase gen types` script.

**Status.** Pre-existing. R1 does not introduce a codegen pipeline — that is
new tooling outside a domain+database lot, and every R1 schema change is
additive, so there was no type fallout to fix.

**Consequence.** Nothing catches a typo in a table or column name at compile
time. Every `.from('...')` and `.rpc('...')` call site is unchecked.

**Removal prerequisite.** A codegen step wired into the build, and the
`Database` generic threaded through `getSupabaseClient()`.

**Target lot.** R2 — flagged as a genuine gap.

---

## D6 — follower and verified-client counts are computed, not materialised

**Legacy concept.** `get_public_professional()` computes both counts with a
`LIMIT 1001` subquery and returns a `*_capped` flag.

**Status.** Deliberate for R1, and safe at any scale — the cost is O(1001), not
O(followers). It is listed here because it is a known interim.

**Why not materialise now.** A counter column adds write-path contention on
the follow path and a permanent drift-repair obligation, neither of which is
justified before there is traffic. The cap makes the interim genuinely bounded
rather than merely untested.

**Removal prerequisite.** Real traffic showing the cap is user-visible, i.e.
professionals routinely above 1000 followers.

**Target lot.** R6/R7. Adding a materialised counter later is purely additive.

---

## D7 — `professionals.handle` and `customer_public_profiles.username` are unpopulated

**Legacy concept.** Both columns exist, are nullable, and carry a
`unique (lower(...))` index and a format `CHECK`, but nothing populates them.

**Why they exist now.** The uniqueness and format rules must be in place from
the first row, or retrofitting them later means reconciling collisions across
live public identities. Backfilling invented handles would churn public
identity for no benefit.

**Removal prerequisite.** A handle-reservation flow, and a decision on whether
a handle is mandatory for a public profile.

**Target lot.** R6/R7.

---

## D8 — auto-follow is lossy by design

**Legacy concept.** `appointments_auto_follow()` swallows every exception and
returns `NEW`, so a follow can be silently dropped.

**Why.** A raised exception would roll back a real booking. Between losing a
follow edge and losing a customer's appointment, the follow loses.

**Why it cannot be reconciled.** Unlike
`customer_professional_relationships` — which is rebuildable from
`appointments`/`queue_entries` via
`rebuild_customer_professional_relationships()` — a follow cannot be
recomputed, because reconciliation could not distinguish "never followed" from
"explicitly unfollowed", and re-creating the latter would violate the §17
invariant.

**Mitigation in place.** The handler emits `raise warning`, so the loss is
visible in logs rather than truly silent.

**Removal prerequisite.** An outbox or event table if auto-follow ever needs
an at-least-once guarantee.

**Target lot.** R3, alongside the analytics event architecture.
