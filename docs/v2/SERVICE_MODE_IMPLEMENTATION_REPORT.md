# Service Mode Foundation — Implementation Report

Status: **Complete and validated (2026-08-26).** Interstitial lot between R2 and R3.

Branch: `rebuild/social-first-v2`. Base: `2b1219b` (tag `backup/post-r2-20260826`).

---

## 1. Starting state, measured

Every claim below was verified by replaying the migration chain into a
disposable database and introspecting it — not by reading the application.

| Question | Answer found |
| --- | --- |
| Does a service mode exist? | **No.** Booking and the queue both admitted unconditionally, everywhere, always. |
| Does `queue_open` or any runtime queue state exist? | **No.** Nothing in the 89 committed migrations. `is_open_now` in the marketplace RPCs is derived from `location_hours` — that is *opening hours*, a different fact, and not writable. |
| Is the R2 entitlement gate wired into admission? | **No.** `private.org_has_capability` / `assert_org_capability` had no caller outside R2's own assertion lists. |
| Where does a barber's establishment come from? | `barbers.staff_profile_id → staff_profiles.location_id`. `barbers` itself is **organization**-scoped with no `location_id`. |
| Is there a canonical establishment timezone? | Yes — `locations.timezone`, `not null default 'UTC'`. |
| Are today's closing hours reliably available? | Yes — `location_hours`, including an optional second window for shops that close over lunch. |
| Does rescheduling create a new row? | **No.** `reschedule_appointment` UPDATEs in place and preserves the status. |

### The admission paths, all of them

Found by searching every migration, not by trusting the app.

**Booking:** `book_public_appointment` (SECURITY DEFINER, granted to `anon`);
direct PostgREST INSERT into `appointments` by staff (column grant + RLS org
role); `service_role` / `postgres` (both `BYPASSRLS`).

**Queue:** `join_public_queue` (SECURITY DEFINER, granted to `anon`); direct
INSERT into `queue_entries` by owner/manager/receptionist; the same two
privileged roles.

That inventory is what forced the enforcement shape. A check inside the two
RPCs covers two paths of four. An RLS `with check` covers three and evaporates
for exactly the privileged writers §34 says must not be exempt. A `BEFORE
INSERT` trigger covers all of them, including psql.

### The entitlement bypass

R2 built the commercial gate and hung it on nothing. Its own MASTER header says
so, and says the fix "is a product decision with its own migration". This is
that migration.

Not exploitable in current data — R2's backfill (`20260826110200:112-119`)
assigns `free` only to an organization with **zero** active locations **and**
zero active professionals, and both admission paths require a valid active
location. Every organization that can take a booking today is on `solo` or
better, and every one of those plans includes `booking`. But nothing prevented
one from being put on `free`, and §16 is explicit that a known bypass gets
wired up here.

---

## 2. Schema model

| Object | Purpose |
| --- | --- |
| `public.service_mode` | `hybrid \| reservation_only \| queue_only \| unavailable`. Durable machine identities. |
| `public.service_mode_scope` | `location \| barber`. |
| `public.location_service_settings` | PK `location_id`. `default_service_mode`, `queue_open`. **Also the mutex.** |
| `public.barbers.service_mode_override` | Nullable. NULL = inherit. |
| `public.service_mode_overrides` | Temporary exceptions, either scope. Never deleted. |
| `public.service_mode_changes` | Append-only history, enforced by trigger. |

### Why the mode lives on the barber placement, not on the Professional

R1B deliberately split the durable, organization-independent
`public.professionals` identity from the operational `public.barbers`
placement. Service mode is operational state, and putting it on the identity
would be wrong twice:

1. **A professional will work in more than one establishment** (R18). Their
   mode can legitimately differ per shop — walk-ins at the busy high-street
   branch, appointments only at the quiet one. A column on the durable identity
   holds exactly one answer and forces both shops to agree.
2. **It would make durable identity mutable operational state**, which is
   precisely the coupling R1B paid to remove. A professional whose account has
   been erased still has appointments and a Passport; they must not still hold
   an opinion about today's walk-in policy.

`barbers` rather than `staff_profiles` specifically: a receptionist has a staff
profile and has no service mode. `barbers` is exactly the population for which
the question is meaningful.

VERIFY asserts `public.professionals` has no service-mode column (check 1.05).

### Establishment default, per establishment

`location_service_settings` is keyed on `location_id`. A multi-salon
organization gets one row per salon; one salon going `queue_only` says nothing
about the others. VERIFY §4 proves this with a two-salon fixture, and the
generator refuses any `ALTER TABLE public.organizations`.

### Persistent barber override: inheritance is real

NULL is the default and the common value. It is **not** backfilled with the
establishment's mode — copying it would turn a live inheritance edge into a
snapshot, and changing the establishment default would then require finding and
updating every barber who had chosen nothing. Check 3.18 moves the
establishment default and asserts an inheriting barber moves with it, with no
barber row written.

No revoke was needed for the new column: `authenticated`'s INSERT/UPDATE on
`barbers` are **column-level** grants (R1B already removed the table-level
privilege when it protected `professional_id`), so a new column arrives
unwritable. Re-granting "all the columns" — the technique R1A needed for
`booked_by_user_id`, where the grant *was* table-level — would have silently
re-granted `professional_id` and undone R1B. The migration asserts both facts
instead of assuming them.

### Temporary overrides

`scope`, an always-present `location_id`, a `barber_id` set iff scope is
`barber`, `mode`, `starts_at`, nullable `expires_at`, `cleared_at`,
`created_by_user_id`.

`location_id` is NOT NULL even for barber scope, for three reasons: it is the
tenant anchor (`staff_profiles.location_id` is nullable and `ON DELETE SET
NULL`, so the chain could break under ordinary offboarding), it is the mutex
key, and it is half of the `(location_id, barber_id)` pair the resolver reads.

**At most one active override per target is a database guarantee**, via partial
unique indexes on the uncleared rows. Two active overrides would make the
effective mode genuinely ambiguous — they sit at the same precedence level, and
ordering by `created_at` would hide a data bug behind an arbitrary tiebreak.
Setting an override clears the previous one and inserts a new one inside the
mutex; superseded rows stay as history.

---

## 3. Precedence, expiration, timezone

### The resolver

One implementation, `private.effective_service_mode(location_id, barber_id)`,
returning `(mode, source, starts_at, expires_at)`.

```
1. active BARBER temporary override
2. active LOCATION temporary override
3. BARBER persistent override
4. LOCATION default
```

The specific beats the general and the temporary beats the standing
arrangement, at every level. A barber saying "not me, not right now" is the
most specific statement anyone can make about a chair, so it wins outright —
including over a manager's location-wide temporary override. That is not an
authorization hole: a manager who needs to override a barber can set that
barber's override directly, and the history records who did it. Silently
outranking a barber's own "I'm unavailable" would produce bookings for someone
who has said they cannot take them.

It resolves on the `(location_id, barber_id)` pair carried by the row being
admitted. A queue entry with no barber therefore answers at location scope with
no special case anywhere, and enforcement judges the establishment the booking
is actually *for* rather than wherever the barber's staff profile points.

Every caller — the two guards, both read RPCs, and the frontend — consumes this
and its provenance. Nothing reimplements the ordering.

### Expiration

A pure resolver predicate: `cleared_at is null AND starts_at <= now() AND
(expires_at is null OR expires_at > now())`.

No cron, no worker, no browser. If a sweeper were down for an hour, a barber who
said "unavailable for 30 minutes" is still taking bookings at minute 31. Rows
are never deleted on expiry, so "why did we stop taking walk-ins at 3pm last
Tuesday" stays answerable. The function is `STABLE`, never `IMMUTABLE` — marking
it immutable would let the planner fold a mode into a cached plan and serve an
expired override forever.

### Timezone

Everything is `timestamptz`; VERIFY 1.09 asserts no naive timestamp exists in
any of the three tables. The backend accepts and returns **absolute instants
only** — it never receives "today" or "until closing".

Durations are resolved client-side against the **establishment's** timezone
(`locations.timezone`), never the browser's and never the server's. A manager in
Paris setting "until closing" for a shop in Nice gets Nice's closing time.

**"Until closing" is offered**, because `location_hours` genuinely provides it —
this lot did not have to defer that option. It uses the *last* closing time of
the day (`second_close_time` when a shop closes over lunch), and it disappears
entirely rather than guessing when the shop has recorded no hours for today, or
when today's closing time has already passed.

---

## 4. queue_open is a separate fact and stays one

It did not exist before this lot and is created here because §15/§22 require it
as an independent input to admission.

Every combination is representable, and two of them look odd and must remain
so:

| | Result |
| --- | --- |
| `hybrid` + `queue_open=false` | Booking open, walk-ins paused |
| `queue_only` + `queue_open=false` | Walk-in shop, line paused right now |
| `reservation_only` + `queue_open=true` | Mode still refuses new joins |
| `unavailable` + `queue_open=true` | Mode still refuses new joins |

`set_location_service_mode` never reads or writes `queue_open`, and
`set_location_queue_open` never reads or writes the mode. A shop that pauses
walk-ins for lunch and then switches to `reservation_only` for the afternoon
finds the queue still paused when it switches back. Silently forcing the toggle
would destroy a setting the shop wants back in an hour.

The queue guard reports the two refusals **distinctly**, because each has a
different control and a different fix — a shop told "walk-ins are closed" when
the real reason is a ten-minute pause goes looking in the wrong screen.

---

## 5. Entitlement composition

Composed from R2's own helpers. This lot adds **no** commercial logic, names no
plan (the generator fails the build if a plan key literal appears), and changes
no pricing.

* **Booking** requires `booking`.
* **Queue** requires `walkIns` **OR** `liveQueue`.

The disjunction is deliberate. R2's matrix gives `salon_essential` `walkIns`
*without* `liveQueue`; demanding `liveQueue` would silently withdraw a walk-in
channel that plan pays for, which is a pricing change §60 forbids. The gate asks
"is this organization entitled to operate a walk-in/queue channel at all" —
`free` has none of the three keys and is refused. VERIFY 8.04–8.06 assert the
premise *and* the consequence.

Service mode cannot create entitlement, and entitlement cannot override mode.
Checks 8.01–8.02 prove `free` + `hybrid` gains nothing; 8.07–8.09 prove an
entitled plan is still refused by the mode, and by `queue_open`.

---

## 6. Enforcement

`BEFORE INSERT` triggers `appointments_enforce_service_mode` and
`queue_entries_enforce_service_mode`, both SECURITY DEFINER with a pinned
`search_path`.

**INSERT only.** Service mode governs NEW admissions and says nothing about
commitments that already exist. In every mode including `unavailable`:

* the full R1A appointment lifecycle still runs — check-in, start, completion,
  cancellation, no-show;
* everyone already in the queue is still called, served and completed;
* `reschedule_appointment` UPDATEs rather than inserting, so it never reaches
  the trigger and needs no exemption — **and therefore no caller-controlled
  skip flag has to exist anywhere.**

Checks 7.01–7.09 make real commitments, then slam the establishment shut every
way there is (location default, barber override, and a location temporary
override, all to `unavailable`, with the queue closed), and assert nothing was
deleted, nothing was cancelled, and every lifecycle step still succeeds. 7.10
and 7.11 assert the triggers are INSERT-only by reading `pg_trigger.tgtype`.

**No bypass.** No GUC, no session variable, no parameter, no role exemption.
The generator fails if `current_setting(` or `set_config(` appears anywhere in
the lot. A restore that must reinstate rows the current mode would refuse is
`pg_restore --disable-triggers` — explicit, loud and auditable.

Trigger firing order is asserted rather than assumed: both new triggers sort
alphabetically after their table's `*_check_consistency` trigger, so tenant
consistency is established before a mode is resolved from the ids.

---

## 7. Authorization

Five RPCs are the entire mutation surface. The three tables have zero client
write privilege and no INSERT/UPDATE/DELETE policy.

| Operation | Who |
| --- | --- |
| Establishment default | owner / manager |
| `queue_open` | owner / manager / receptionist |
| Barber persistent override | owner / manager, or that barber |
| Location temporary override | owner / manager |
| Barber temporary override | owner / manager, or that barber |

`queue_open` is wider on purpose: "stop taking walk-ins, we're at capacity" is a
front-of-house judgement made a dozen times a week, and an owner-only control
would never get used — the queue would simply fill with people who cannot be
served. Changing how the shop *presents* itself is a different kind of decision
and stays with owner/manager.

**No RPC takes an `organization_id`.** That is deliberate rather than
incidental: an organization_id parameter invites authorizing against the value
the caller sent instead of the object they named. The tenant is looked up *from*
the location or the barber, and membership is checked against what was found.
`private.is_own_barber` (R1B) resolves a barber's self-claim from `auth.uid()`
through `staff_profiles`, so the supplied `barber_id` is the thing being
checked, never the thing doing the checking.

An unknown location raises the **same 42501** as a forbidden one (check 9.10),
so the error cannot enumerate location ids across tenants.

`prospect_worker` is granted nothing and asserted to hold nothing.

---

## 8. RLS, grants, SECURITY DEFINER

All three tables: `ENABLE` + `FORCE ROW LEVEL SECURITY`. FORCE matters — without
it the table owner (postgres, which is what every definer function runs as)
bypasses every policy.

* `anon`: **no** SELECT and no policy on any of the three tables. This lot adds
  zero anon policies; the database's count stays at zero.
* `authenticated`: SELECT only, scoped to org membership. `service_mode_changes`
  is narrower — owner/manager only, because it names who changed what and the
  roster does not need that.
* Exactly **one** function is anon-callable: `get_public_service_state`. The
  generator fails if any other `GRANT EXECUTE … TO anon` appears, *and* fails if
  that one is missing.
* Every function in the lot pins `search_path` — asserted for all 20, not
  filtered to SECURITY DEFINER, because an unqualified name resolves through the
  caller's `search_path` either way.
* The `private` helpers are not an API: no client role can call
  `effective_service_mode` or `assert_service_mode_authority` directly.

`20260826120700` re-asserts all of this, plus that the two guards still exist
and are still `BEFORE INSERT`, plus that the R2 capability helper is genuinely
consulted by both — so a future edit that quietly drops the check fails the
replay rather than reopening the bypass in silence.

---

## 9. Concurrency

**Mutex:** the establishment's `location_service_settings` row. Mode changes,
`queue_open` toggles and override writes take `FOR UPDATE`; admissions take
`FOR SHARE`.

Shared/exclusive rather than exclusive/exclusive because admissions conflict
with a *writer*, not with each other — an exclusive lock would serialise every
walk-in at a busy shop behind every other one for no correctness gain.

The guarantee: an admission holds its share lock from before it reads the mode
until it commits, so a mode change cannot commit in between. And under READ
COMMITTED a blocked row lock re-reads the row when granted, so an admission
that queues behind a mode change sees the **new** mode. There is no window in
which a mode change commits and an admission computed against the old mode
commits after it.

No transaction upgrades a share lock to exclusive, so the two modes cannot form
a deadlock cycle. `scripts/service-mode-concurrency-test.sh` checks the server
log for `deadlock detected` across every scenario as a belt to that braces.

---

## 10. Realtime

`location_service_settings` and `service_mode_overrides` are in the
`supabase_realtime` publication. `service_mode_changes` deliberately is not — it
is an audit trail read on demand, and broadcasting it would double every event.

Postgres Changes is RLS-aware; the SELECT policies are what make the
subscriptions tenant-safe, not the filter strings.

**The gap Realtime cannot cover, and how it is covered.** An override that
lapses at its own `expires_at` writes no row, so Postgres has nothing to
broadcast. Both reads therefore also schedule a one-shot refetch for that
instant (`useExpiryRefresh`, with a small grace period because the client's
clock is not the server's). Correctness stays server-side — the resolver refuses
an expired override whether or not any browser is awake — so a missed timer
degrades to a stale label, never to a booking that should not have happened.

The customer read has **no** subscription, and that is not an omission: `anon`
holds no SELECT on the underlying tables, so there is nothing Postgres could
deliver to a signed-out visitor. Freshness comes from the expiry timer plus a
slow poll, exactly as the public queue display already works.

Realtime fires on: establishment mode change, `queue_open` toggle, and any
override created, superseded or cleared.

---

## 11. The customer contract

`public.get_public_service_state(slug, location_id, barber_id)` — anon-callable,
and the contract the future mobile Customer app consumes.

Returns effective mode, `mode_source`, `mode_expires_at`, `mode_allows_booking`,
`mode_allows_queue`, `queue_open`, `queue_accepting_new_entries`,
`booking_accepting_new_entries`. No actor ids, no override history, no internal
authorization state.

**Zero rows is the refusal, uniformly** — unknown slug, foreign tenant, inactive
location, non-public barber, barber not placed here. A distinguishable error
would be an oracle for which location ids exist and which shops have closed.

**`booking_accepting_new_entries` means "not refused by entitlement or mode".**
It is **not** slot availability, which remains `get_public_available_slots`.
Conflating them would let the UI promise a time the availability engine never
offered. `queue_accepting_new_entries` *is* final, because joining a queue needs
no slot.

### Unclaimed and external professionals

Protected twice over, by construction rather than by a filter someone could
forget:

1. The function is reachable only through a real `public.barbers` placement — an
   actual roster row, in an actual organization, at an actual active location,
   with a public and active staff profile. A worker-discovered professional has
   no such row, so no query shape makes this invent availability for them.
2. R1B's `professionals_publication_eligibility` constraint makes it *impossible*
   for an unclaimed identity to be public at all. (Found while seeding: the
   fixture had to be corrected, which is the constraint doing its job.)

---

## 12. Pro UX and customer CTA

**Pro** — `ServiceModeControl` on `/app/queue`, the surface where the floor is
actually run. §26 asks for a quick control rather than a settings tree, and
whoever is watching the queue is exactly who decides to stop taking walk-ins.

Four full-width touch targets on a phone, two columns from `sm` up. The current
state is stated with its provenance ("queue only until 15:30, because you set
it"), so a professional never has to hold the precedence rules in their head.
The duration selector sits *above* the modes, because it changes what tapping
one means and a control that silently reinterprets the next tap is a trap. The
queue toggle is rendered apart, worded apart, and says what closing it does not
do. No enum value is ever shown.

**Customer** — `ServiceModeCtas`, derived from server truth:

| Effective state | What the customer sees |
| --- | --- |
| booking + queue accepting | Book (primary) and Join the queue (secondary) |
| booking only | Book |
| queue only | Join the queue (primary), plus a line explaining reservations are closed |
| queue mode but line shut | Non-actionable "Queue closed for now" — deliberately not a link |
| nothing accepting | "Not taking new bookings right now", said once, plainly |

The "closed for now" state appears **only** when the mode genuinely offers
walk-ins. In `reservation_only` the queue is not shut, it is not on offer, and
"come back later" would promise a return that is not coming.

Social actions are untouched. The Favorite control, bio and service list stay in
every mode — a barber not taking bookings today is still someone you follow, and
hiding that would punish them for closing early.

All copy is localized across all ten locales (`ar de en es fr it ja pt ru
zh-CN`), in `app.json` for the Pro surface and `booking.json` for the customer
surface — deliberately separate namespaces, so a signed-out visitor never loads
the professional workspace bundle to find out whether they can join a queue.
French uses the FadeUp vocabulary (coiffeur / professionnel / salon / équipe);
`terminology.test.ts` and a dedicated assertion both check "barbier" never
appears.

---

## 13. Backfill

Every existing location — **including inactive ones** — gets
`default_service_mode = 'hybrid'`, `queue_open = true`. Verified as the
compatibility choice: both channels currently admit unconditionally, so this is
the only default that changes no behaviour. Inactive locations are included so
that reactivating one does not silently change its service mode.

Every barber gets NULL (inherit). No temporary override is fabricated. **No
history row is fabricated** — nobody made these choices, and inventing an actor
would be a lie told to whoever reads the audit trail later. Check 13b.16 asserts
the upgrade wrote no authorless history for any seeded establishment.

New locations get their row by trigger (`locations_create_service_settings`), and
`private.ensure_location_service_settings` is a safety net on every read and
enforcement path. It creates the *permissive* default deliberately — a departure
from R2's `ensure_organization_commercial_state`, which creates the most
restrictive plan. R2's row is a commercial claim, where failing closed is right;
this row is an operational preference whose absence is a bookkeeping gap, and
failing closed would take a working shop offline over a missing row. The
commercial gate is enforced separately and is what actually stops an unentitled
organization.

---

## 14. Validation results

### Database

| Run | Result |
| --- | --- |
| **Fresh DB** — full chain from zero (97 migrations), then VERIFY | **PASS 172, FAIL 0, INFO 1** |
| **Upgrade from R2** — chain to `20260826110700`, SEED, MASTER, VERIFY | **PASS 188, FAIL 0, INFO 0** |

The INFO on the fresh run is the upgrade-preservation block correctly reporting
that no SEED census is present, rather than silently passing. On the upgrade run
those 16 checks execute, which is the +16 difference.

### Concurrency — `scripts/service-mode-concurrency-test.sh`

**All 9 scenarios PASS at RACERS=8 and at RACERS=24. Zero deadlocks at either.**

| Scenario | RACERS=8 | RACERS=24 |
| --- | --- | --- |
| 1. location → `reservation_only` vs queue joins | 0 admitted / 8 refused | 4 admitted / 20 refused |
| 2. location → `queue_only` vs bookings | 7 admitted / 1 refused | 0 admitted / 24 refused |
| 3. barber → `unavailable` vs bookings | 2 admitted / 6 refused | 0 admitted / 24 refused |
| 4. barber → `unavailable` vs queue joins | 0 admitted / 8 refused | 1 admitted / 23 refused |
| 5. `queue_open` → false vs queue joins | 4 admitted / 4 refused | 0 admitted / 24 refused |
| 6. simultaneous barber overrides | **1 active**, 8 kept as history | **1 active**, 24 kept |
| 7. simultaneous location overrides | **1 active**, 8 kept as history | **1 active**, 24 kept |
| 8. both scopes at once | 1 per scope, resolves to barber | 48 writers, 1 per scope, resolves to barber |
| 9. expiry boundary vs admissions | falls to `location_default`, fresh booking ADMITTED, lapsed row still on disk | same |

In every mode-vs-admission scenario the changer committed, zero racers failed
for any reason other than admission or refusal, and a **fresh** admission
afterwards returned 42501.

The varied splits (7/1, 2/6, 4/4, 4/20, 1/23) are what makes these meaningful:
the racers genuinely interleaved rather than serialising by accident. Any split
is a legal serialization; what must hold — and does — is that nothing deadlocked
and nothing leaked past the committed change.

### Regressions

| Suite | Baseline | Result |
| --- | --- | --- |
| R1A VERIFY | PASS 70 / FAIL 0 | **PASS 70 / FAIL 0** (see §15.1) |
| R1B VERIFY | PASS 161 / FAIL 0 | **PASS 161 / FAIL 0** |
| R2 VERIFY | PASS 197 / FAIL 0 | **PASS 197 / FAIL 0** |
| Worker V2 | 13 files / 225 tests | **13 files / 225 tests, PASS.** typecheck PASS, lint exit 0, build PASS |
| Web | 69 files / 644 tests | **70 files / 686 tests, PASS.** typecheck PASS, lint 0 errors, build PASS |

Web is +1 file and +42 tests, as §62 requires. All four MASTER generators
(`r1a`, `r1b`, `r2`, `service-mode`) report **in sync**. Every shell script
passes `bash -n`; `git diff --check` is clean.

### Known warnings, unchanged by this lot

* `window.scrollTo` not-implemented noise from `onboarding-page` under jsdom.
* Pre-existing `react(only-export-components)` Fast Refresh lint warnings.
  **None come from this lot's files** — checked by name.
* Vite chunk-size warning on `platform-acquisition-map-page`.

---

## 15. Defects found and fixed during this lot

### 15.1 The one that affected an earlier lot

**R1A's VERIFY aborted its entire transaction after this lot.** Its fixture
organization is newly created, so R2 gives it `free` commercial state — and
`free` packages neither `booking` nor `walkIns`/`liveQueue`. Once this lot wired
the entitlement gate into admission, every appointment fixture in R1A's suite
was refused with 42501 before a single integrity rule was reached, and the
result printed as `PASS=0 FAIL=0` — a suite reporting nothing while looking like
it had passed.

Two changes to `VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql`, both of which
**weaken no assertion**:

1. The fixture shop is given `salon_pro` — the smallest plan carrying all three
   capabilities, and a one-establishment plan, so no capacity rule is disturbed.
   Testing appointment integrity against an organization that may not legally
   accept an appointment would be testing nothing.
2. Check `10.7` — "R1A introduced no new table" — is an explicit allow-list that
   R1B and R2 each extended. It gains this lot's three table names, keeping the
   check exactly as strict: an unexpected 103rd table still fails it.

R1A is back to **PASS 70 / FAIL 0**, its exact baseline.

### 15.2 An implementation bug the new tests caught

`resolveDurationToExpiry` accepted a `now` parameter but called `todayInZone()`
for calendar durations, which reads the wall clock. In production `now` is always
the current instant so the bug was invisible — but an explicit instant produced
relative durations from one clock and calendar durations from another, and the
two would disagree at every midnight boundary. Fixed to derive the date key from
the given `now`; `closingHoursToday` gained the same parameter. **This was an
implementation fix, not a test fix.**

### 15.3 Fixture defects, each an earlier lot's guard working

Recorded because §66 requires it, and because every one of them is an R1A/R1B/R2
constraint correctly refusing an invalid fixture:

* VERIFY built locations before raising the plan — R2's establishment cap
  refused. Fixed by assigning plans first and splitting the fixture so one
  failure no longer cascades.
* VERIFY juggled plans on a three-location fixture — R2's downgrade guard
  refused. Fixed with a dedicated single-establishment tenant.
* SEED/VERIFY omitted the NOT NULL `organization_id` on `service_locations` and
  `barber_services`.
* SEED backdated `called_at` behind a defaulted `created_at` — R1A's monotonic
  timestamp constraint refused a causally impossible row.
* SEED used non-existent `professional_source` values and a hyphenated handle;
  tried to mint a second `professionals` row for an account that already had one;
  published an **unclaimed** professional (impossible by R1B constraint); and
  created a `following` row with no `followed_at`.
* Two VERIFY assertions were themselves wrong: one depended on `created_at`
  ordering that ties inside a single transaction, and two called the Pro read as
  `postgres`, where `auth.uid()` is NULL so it correctly returns nothing.

---

## 16. Deferred, explicitly

* **Recurring weekly service schedules.** The model leaves room for them —
  temporary overrides already carry `starts_at`/`expires_at` — and this lot
  builds none. No rule editor, no scheduler, no schedule engine, no
  recurring-mode table. The generator fails the build if any appears.
* **Mobile application, Expo, React Native.** None created. The customer
  contract is shaped so a second client consumes it without reimplementing
  precedence.
* **R3, Stripe, billing, checkout.** Untouched.
* **New pricing or plan-matrix changes.** None. The generator fails on a plan
  key literal or a reference to the pricing catalogue.
* **SMS.** None.
* **Nothing deferred for lack of business-hours data.** "Until closing" is
  implemented, because `location_hours` reliably provides today's closing time.
  It degrades to unavailable — rather than guessing — on a day with no hours row
  or when closing has already passed.

---

## 17. Deployment implications

1. **This closes a real entitlement bypass, and that is the most visible
   consequence.** After applying, a new appointment requires `booking` and a new
   queue entry requires `walkIns` OR `liveQueue`. No operating organization is
   affected today, for the reason given in §1 — but an organization deliberately
   moved to `free` will stop being able to book, which is the intended
   commercial behaviour and was previously unenforced.
2. **Every establishment lands on `hybrid` with the queue open**, which is
   exactly how they all behave now. No shop's behaviour changes on the day of
   deployment.
3. **Nothing is cancelled, ever.** The guards are INSERT-only.
4. **Two tables join the realtime publication.** Open Pro screens gain live mode
   updates.
5. **No cron or worker to install.** Expiry is a resolver predicate.
6. **Any test fixture or seed that creates an organization and then books must
   assign it an entitled plan.** R1A's VERIFY needed this; anything similar
   downstream will too.
7. MASTER runs in a single transaction and applies or rolls back whole.

---

## Files

**Migrations** (append-only after `20260826110700_r2_privilege_hardening.sql`)

```
20260826120000_service_mode_foundation.sql          type, settings, queue_open, backfill, RLS, realtime
20260826120100_barber_service_mode_override.sql     the nullable inherit column, + privilege assertions
20260826120200_service_mode_overrides.sql           temporary overrides + append-only history
20260826120300_effective_service_mode.sql           THE resolver + mode predicates + composers
20260826120400_service_mode_controls.sql            5 RPCs + the shared authority check
20260826120500_service_mode_enforcement.sql         the two BEFORE INSERT guards
20260826120600_service_mode_contracts.sql           customer + Pro read contracts
20260826120700_service_mode_privilege_hardening.sql revokes + 9 assertion blocks
```

**Artifacts**

```
supabase/MASTER_SERVICE_MODE_FOUNDATION_2026_08_26.sql
supabase/SEED_SERVICE_MODE_PRE_UPGRADE_2026_08_26.sql
supabase/VERIFY_SERVICE_MODE_FOUNDATION_2026_08_26.sql
scripts/generate-master-service-mode.sh
scripts/service-mode-concurrency-test.sh
supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql   (fixture entitlement + allow-list, §15.1)
```

**Application**

```
apps/web/src/lib/queries/service-mode.ts              typed hooks + pure helpers
apps/web/src/lib/queries/service-mode.test.ts         35 tests
apps/web/src/components/pro/service-mode-control.tsx  Pro control + barber row
apps/web/src/components/booking/service-mode-ctas.tsx customer CTA derivation
apps/web/src/pages/app-queue-page.tsx                 wires the Pro control
apps/web/src/pages/public-barber-page.tsx             wires the customer CTA
apps/web/src/pages/public-barber-page.test.tsx        updated + 7 new cases
apps/web/src/locales/{10 locales}/app.json            Pro copy
apps/web/src/locales/{10 locales}/booking.json        customer copy
```
