# R3 — Analytics and Event Engine

**Status:** Complete (2026-08-27)
**Branch:** `rebuild/social-first-v2`
**Supersedes:** `ANALYTICS_DRAFT.md` (R0 sketch). Where the two disagree, this
document is authoritative; §15 below records every place R3 departed from the
draft and why.

---

## 1. What R3 is, and what it deliberately is not

Before R3, FadeUp measured **nothing**. Not "measured badly" — the R0 audit
verified there was no PostHog, no GA/gtag, no Segment, no Mixpanel, no Sentry,
no `navigator.sendBeacon`, and no `fetch()` to any third-party host anywhere in
`apps/web/src`. The browser bundle reached exactly two hosts: Supabase and the
map tile server. Every number about the product was a hand-written SQL query
against operational tables.

R3 is the **data and event foundation** that makes the product measurable. It
is not a dashboard, not a BI surface, not Worker V2, not a mobile app, not a
CRM and not billing. Those are named as non-goals throughout, and §16 lists
what was deliberately left undone.

The single most important property of the whole design:

> **If `analytics_events` were dropped tomorrow, the product would behave
> identically and only the reporting would go dark.**

Nothing in FadeUp reads analytics to decide behaviour. Analytics is derived
from state; it never replaces it.

---

## 2. The four streams, and why this is only the second

FadeUp already had three kinds of durable record. Keeping the boundary explicit
is the most important thing this lot does, because every event-sourcing
accident starts by blurring it.

| Stream | Tables | Answers | Retained |
| --- | --- | --- | --- |
| **1. Current product state** | `organization_follows`, `professional_follows`, `customer_favorites`, `appointments`, `queue_entries` | What is true **now** | Forever — it is the product |
| **2. Product analytics history** ← R3 | `analytics_events` | What **happened**, when, under which commercial terms | Policy-driven (§13) |
| **3. Security / admin audit** | `audit_logs`, `platform_audit_log`, `commercial_plan_changes`, `service_mode_changes` | Who did an administrative thing | Compliance-driven |
| **4. Worker execution logs** | `prospect_events`, `outreach_events`, `prospect_jobs` | How the acquisition machine ran | Operational |

R3 converted **no** state table into an event-sourcing table, added no event id
to any of them, and created no read path that replays events to answer a
product question. `organization_follows` is still the only answer to "is this
customer following this shop".

---

## 3. The event table

`public.analytics_events` — append-only, one row per thing that happened.

### 3.1 Columns

| Group | Columns |
| --- | --- |
| Identity | `id`, `event_name`, `event_version` |
| Time | `occurred_at`, `ingested_at` |
| Actor | `actor_type`, `actor_user_id`, `customer_id`, `professional_id` |
| Business context | `organization_id`, `location_id`, `barber_id`, `appointment_id`, `queue_entry_id`, `passport_id` |
| Acquisition | `prospect_id`, `acquisition_source`, `acquisition_source_record_id` |
| Surface | `event_origin`, `platform`, `session_id`, `locale`, `country_code` |
| Commercial snapshot | `plan_key`, `commercial_family` |
| Metadata | `properties`, `correlation_id`, `causation_id`, `dedupe_key` |

`occurred_at` is when the thing **happened** — for a server event, the instant
of the authoritative state transition. `ingested_at` is when the row was
written. They differ for anything replayed or backfilled, which is how pipeline
lag is measured without contaminating `occurred_at`.

### 3.2 Why there are no foreign keys — a deliberate departure

Every other business table in the repository carries FKs, and `CLAUDE.md` asks
that they always be considered. They were. This is the one table where they are
wrong, for three independent reasons:

1. **History must outlive its subject.** `ON DELETE CASCADE` would let deleting
   one barber erase the record that four hundred services were delivered —
   precisely the defect R0 found on `appointments.barber_id` and R1A fixed.
   `ON DELETE SET NULL` is no better: it silently rewrites an append-only row
   and destroys the attribution that made the event worth keeping.
2. **An FK is a write on the hot path.** Thirteen context columns means
   thirteen parent lookups and thirteen row locks per event, inside the same
   transaction as a booking.
3. **FKs would force thirteen more indexes**, since Postgres needs an index on
   the referencing column for a parent `DELETE` to avoid a seq scan. That is
   the over-indexing the brief forbids.

Integrity is enforced at **ingestion** instead, where no client can write at
all. The ids here are **recorded values**, not live references — which is what
an append-only log is.

### 3.3 Append-only, enforced

Two `BEFORE` triggers make `UPDATE` and `DELETE` fail for **every** caller
including `service_role`, `postgres` and a direct `psql` session. The
verification suite proves this as `postgres`, which is the strongest form of the
claim: if the table's owner cannot rewrite history, nobody can.

The one exception is retention (§13), which honours a transaction-local flag
set exclusively by `private.purge_analytics_events` — a function no client role
can reach, and which refuses any cutoff inside 90 days.

### 3.4 Indexes — six, and why each exists

| Index | Type | Serves |
| --- | --- | --- |
| `analytics_events_dedupe_key_unique` | unique, partial | Idempotency. Partial because the overwhelming majority of rows are views and searches with a NULL key |
| `analytics_events_org_name_time_idx` | btree | Every per-tenant primitive in §12. Leading with `organization_id` keeps one tenant's scan off another's rows |
| `analytics_events_name_time_idx` | btree | Platform funnels — acquisition and claim events have no tenant |
| `analytics_events_actor_time_idx` | btree, partial | Repeat/retention cohorts, and GDPR erasure |
| `analytics_events_professional_name_time_idx` | btree, partial | A professional's own numbers, keyed on the durable identity |
| `analytics_events_occurred_at_brin` | BRIN | Retention sweeps at volume |

**No JSONB index.** Nothing filters on a `properties` key today; every report
groups by `event_name` and a context column. A GIN index on `properties` would
be the most expensive object in the lot and would serve no query.

**Measured** (60 000 events across 60 tenants, disposable Postgres 17.6):

| Query | Plan | Time |
| --- | --- | --- |
| Per-tenant 30-day summary | Bitmap Index Scan on `org_name_time_idx`, 3 index buffers | 2.4 ms |
| Dedupe probe (the write path) | Index Only Scan, 1 buffer, 0 heap fetches | 0.03 ms |
| Retention sweep | Index Only Scan | 0.4 ms |

Total relation size 13 MB, of which 4.2 MB indexes and **24 kB** BRIN. At this
scale the planner prefers a btree for the retention sweep; the BRIN costs
almost nothing and is there for the volume at which it wins. That is an honest
reading of the plan, not a claim that it is being used today.

### 3.5 Partitioning

Not done, deliberately. The Postgres guidance bundled with this repository puts
the threshold at 100M rows and FadeUp has not emitted one event yet. The design
stays **partition-compatible** — no inbound FKs, append-only, `occurred_at` on
every row, BRIN rather than a clustered B-tree on time — so converting later is
a data move, not a redesign.

---

## 4. The taxonomy

`public.analytics_event_definitions` holds the vocabulary **as data**, not as an
enum. An enum cannot carry a version, cannot record whether an event is
server-authoritative or client intent, cannot say "documented but not wired
yet", and cannot have a value removed.

**40 event contracts across 7 families: 35 wired, 5 deferred; 28 server, 12
client.**

| Family | Count | Wired events |
| --- | --- | --- |
| discovery | 4 | `discovery_viewed`, `search_performed`, `search_result_viewed`, `public_profile_viewed` |
| social | 6 | `organization_followed/unfollowed`, `professional_followed/unfollowed`, `organization_favorited/unfavorited` |
| booking | 9 | `booking_started`, `booking_service_selected`, `booking_barber_selected`, `booking_slot_selected`, `appointment_created`, `appointment_confirmed`, `appointment_cancelled`, `appointment_no_show`, `appointment_completed` |
| queue | 8 | `queue_viewed`, `queue_join_started`, `queue_joined`, `queue_called`, `queue_service_started`, `queue_completed`, `queue_cancelled`, `queue_no_show` |
| passport | 3 | `passport_issued`, `passport_relationship_created` (+1 deferred) |
| acquisition | 7 | `external_profile_created`, `claim_submitted`, `claim_approved`, `claim_rejected` (+3 deferred) |
| commercial | 3 | `plan_assigned`, `plan_changed` (+1 deferred) |

The registry **is** the ingestion allowlist: `private.emit_analytics_event`
refuses any name absent from it or marked `deferred`, so a typo is an error
instead of a new category that silently splits a funnel in half.

### 4.1 Two events beyond the brief's minimum

`appointment_no_show` and `queue_no_show` were added. Both statuses are real
authoritative values that the product already writes (`apply_appointment_no_show_rule`
writes one in bulk). Folding them into `*_cancelled` would report abandonment as
customer choice and make no-show rate — a number shops actually manage —
uncountable.

### 4.2 The five deferred contracts

Written down so the surface that eventually emits them inherits a definition
rather than inventing a name. **A deferred definition cannot produce a single
row**, by construction: the allowlist refuses it.

| Event | Why deferred |
| --- | --- |
| `prospect_discovered`, `prospect_enriched` | Worker V2 is R4/R10; the brief forbids starting it |
| `claim_started` | `professional_claims` has no "started" state, only a submit. Inventing one from a page view would be the fabrication the brief forbids |
| `passport_viewed` | No server-side passport read path to hook, and the Passport rule in §10.5 forbids exposing private Passport history through analytics |
| `entitlement_blocked_action` | **Technical, not editorial.** The entitlement guards refuse by `RAISE` from a `BEFORE INSERT` trigger, which aborts the subtransaction and would discard any event written inside it. Recording a refusal needs an emission path that survives the abort — an autonomous transaction, or a client-side report of the refusal received. Both are real work; neither belongs in a foundation lot |

---

## 5. Server events versus client events

> **CLICK ≠ BUSINESS SUCCESS.**

Every conversion event originates from a real state transition in a table that
is already the product's truth. A customer who taps Follow and whose request
then fails does not appear in the follower funnel, because the event and the
fact are written by the same transaction.

### 5.1 The thirteen instrumentation triggers

All `AFTER` triggers, so the event describes a fact already accepted by every
constraint in front of it.

| Table | Triggers | Emits |
| --- | --- | --- |
| `organization_follows` | 1 | `organization_followed` / `unfollowed` |
| `professional_follows` | 1 | `professional_followed` / `unfollowed` (carries `source`: manual vs auto) |
| `customer_favorites` | 1 | `organization_favorited` / `unfavorited` (carries `scope`: shop vs barber) |
| `appointments` | 2 (insert, update-of-status) | `appointment_created` / `confirmed` / `cancelled` / `no_show` / `completed` |
| `queue_entries` | 2 (insert, update-of-status) | `queue_joined` / `called` / `service_started` / `completed` / `cancelled` / `no_show` |
| `customer_passports` | 1 | `passport_issued` |
| `customer_professional_relationships` | 1 | `passport_relationship_created` |
| `prospect_professionals` | 1 | `external_profile_created` |
| `professional_claims` | 2 (insert, update-of-state) | `claim_submitted` / `approved` / `rejected` |
| `commercial_plan_changes` | 1 | `plan_assigned` / `plan_changed` |

**Why triggers and not edits to the RPCs:** there are four ways to create an
appointment and three to create a queue entry. Instrumenting the RPCs would
leave the other paths silent and would put analytics inside two hundred lines of
twice-hardened booking code. This is the pattern the repository already uses for
`notifications` and for `customer_professional_relationships`.

**Why the queue timestamps are trustworthy at all:** R1A's
`enforce_queue_transition` stamps them server-side and discards client-supplied
values. Before R1A the browser wrote them and a single `UPDATE` could claim a
service completed before it started, ten days in the past. Analytics on those
columns is only defensible because that is fixed.

### 5.2 Client intent events

Ten, emitted through `public.track_analytics_event` by the web adapter (§14):
`discovery_viewed`, `search_performed`, `search_result_viewed`,
`public_profile_viewed`, `booking_started`, `booking_service_selected`,
`booking_barber_selected`, `booking_slot_selected`, `queue_viewed`,
`queue_join_started`.

These locate **abandonment**. They are never a conversion, and the emission wall
in the ingestion layer makes it impossible for a browser to send a business
fact: a `client` definition cannot be emitted from a backend origin, and a
`server` definition cannot be emitted from a web origin.

---

## 6. Idempotency

`dedupe_key` with a unique partial index, absorbed via `ON CONFLICT DO NOTHING`
— the same mechanism `notifications` already uses. **NULL means "repeats of this
event are legitimate and must stay separate"**, which is the case for every view
and search.

Two disciplines, chosen per transition kind:

**Once-only transitions** — completion, cancellation, creation, issuance — get a
**permanent entity-scoped key**: `appointment:<id>:completed`. R1A's transition
guards make a terminal state unleavable for every caller, so the key can never
legitimately be reused, and any retry or duplicated trigger collapses onto the
existing row.

**Repeatable transitions** — following, favoriting, re-confirming after a
reschedule — get a key scoped to the **transition instant**:
`org_follow:<user>:<org>:followed:<epoch microseconds>`. A second genuine follow
next month is a different instant and stays a separate event; a duplicated
trigger inside one transaction shares `now()` and collapses.

**Microseconds, not seconds.** A follow → unfollow → re-follow can all land
inside one second, and a whole-second key would silently collapse the last two
into the first — a monotonic undercount with no symptom. This was found by the
verification suite, not by review.

There is also a layer **before** idempotency: the triggers fire only on a
genuine state change. A second Follow RPC on an already-followed shop updates no
state, so no arm runs and no event is written. The double-click case never
reaches the dedupe key.

---

## 7. Versioning

Every definition carries `event_version`; every row carries the version it was
written under, **denormalized at emit time and never joined at read time**. If
the version were resolved by joining the registry, bumping a contract would
retroactively relabel every historical row and destroy the ability to interpret
old data.

**Rules for changing an event contract:**

| Change | Action |
| --- | --- |
| Add an optional property | No version bump. Readers must tolerate its absence in older rows |
| Remove a property | No version bump. Readers must tolerate its presence in older rows |
| Change the **meaning** or type of an existing property | **Bump `event_version`.** Reports must branch on version |
| Change what the event *means* (when it fires, what it counts) | **New `event_name`.** Never reuse a name for a different fact |
| Retire an event | Set `status = 'deferred'`. Historical rows stay readable; no new ones can be written |

---

## 8. Attribution and the commercial snapshot

### 8.1 Commercial snapshot

`plan_key` and `commercial_family` are resolved at emit time from
`private.effective_plan_key` (R2's function, composed rather than reimplemented,
so the canceled-degrades-to-free and past_due-keeps-plan semantics live in
exactly one place) and **frozen onto the row**.

A service completed while a shop was on `salon_pro` still reports as `salon_pro`
after the shop upgrades, downgrades or cancels. The verification suite proves
this by completing an appointment, changing the plan, and asserting the
historical row did not move while a new event records the new terms.

### 8.2 Actor attribution

Always derived server-side, never asserted by a caller. Three genuinely
different situations, and conflating them would corrupt every "who does this"
report:

| Situation | `actor_type` |
| --- | --- |
| A signed-in account | classified from real state: `platform_admin` → `staff` → `professional` → `customer` |
| A signed-out browser request (`session_user = 'authenticator'`) | `anonymous` — a real anonymous booking is a real customer action |
| No web session at all | `system` — a worker, a sweep, a migration |

### 8.3 Professional identity

Events record **both** `barber_id` (operational placement) and
`professional_id` (durable R1B identity), so "services delivered by this person"
survives them changing shop. Where the client only knows a placement — the
public barber profile page is routed by `barber_id`, and the frozen Customer API
deliberately does not expose `professional_id` — the **server** derives the
identity from `barbers.professional_id`. Widening a closed contract so the
browser could send an id it has no other use for would have been the wrong fix.

---

## 9. Worker V2 / acquisition contract

R3 implements **no** crawling, scraping, outreach or campaign execution. What it
provides is the attribution contract those phases will emit into.

The funnel R3 makes measurable:

```
source discovery → prospect → enrichment → external profile
                 → claim submitted → approved → activated → paying organization
```

**The multi-source guarantee.** The same real professional may be discovered
through several sources. `external_profile_created` hangs off
`prospect_professionals` — the **unified prospect-to-identity linkage**, unique
per prospect — and **not** off `professionals`. Consequently one person found by
four sources produces four `prospect_source_records`, **one** prospect, **one**
linkage and therefore **exactly one** conversion event.

The same guarantee is enforced again at read time:
`get_platform_analytics_funnel` counts `count(distinct professional_id)`, never
`count(*)` of approval events. A `count(*)` there would have quietly undone the
care taken in the emitter.

**Attribution is first-touch**: the earliest `prospect_source_records` row is the
anchor, because the question acquisition asks is which channel found a business
nobody had. A later re-observation by a second source did not find anything.

`campaign_id` was **not** added. The existing model has no campaign entity to
reference, and a dangling text column now would be the mechanical schema-filling
the brief warns against. When Worker V2 introduces campaigns it is one nullable
column.

---

## 10. Privacy

### 10.1 What is refused, in the database

`private.assert_analytics_properties_safe` enforces three rules on every
payload, from every path:

1. **Forbidden key names**, matched as substrings so `customer_email`, `email`
   and `contact_email_address` are all caught by one entry: email, phone,
   mobile, password, token, secret, credential, authorization, note, message,
   body, address, postcode, postal, latitude, longitude, lat_, lng, coordinate,
   geo_point, ip_, user_agent, fingerprint, birth, ssn, tax_id. Substring
   matching over-refuses slightly, which on a privacy gate is the correct
   direction to be wrong.
2. **No nested objects.** An object value is where a whole customer record gets
   pasted in "temporarily".
3. **No email-shaped string value**, because the realistic accident is not a key
   called `email` — it is a key called `identifier` with an address in it.

Plus a 4 KB payload ceiling, so "someone started shipping message bodies into
properties" fails loudly rather than quietly inflating the table.

### 10.2 Columns that deliberately do not exist

`ip_address`, `user_agent`, any device fingerprint, `latitude`/`longitude`,
`referrer`, `utm_*`. A column that exists will eventually be filled. Geography
is `country_code` only.

### 10.3 Session handles

`session_id` is a random opaque string in **`sessionStorage`**, generated per
tab session. Nothing about the device contributes to it — no user agent, no
screen size, no canvas, no font list, no timezone. It dies with the tab, and it
is never joined to an account.

The consequence — one person across two days counts as two sessions — is
accepted and documented rather than engineered away. The alternative is exactly
the durable identifier this refuses to create. This answers the open question
`ANALYTICS_DRAFT.md` §7 raised about stitching anonymous sessions to accounts:
**FadeUp does not stitch them.**

### 10.4 Viewer identity is never exposed

A profile view records **who was viewed**. The viewer appears only as
`actor_user_id`, and **no read contract in R3 projects it**. A shop learns how
many people looked at its profile and how many distinct accounts among them; it
never learns who. The verification suite asserts that no read contract has an
output named for an actor, a session id, an account or an address.

### 10.5 Passport

`passport_issued` records that a Passport exists and nothing about what is in
it. No property reads a preference column, and the event carries no organization
— the Passport is customer-owned and portable, so attributing its issuance to
whichever shop the customer was looking at would be false.

---

## 11. Security model

### 11.1 The event log is unreachable by construction

RLS is **enabled and forced** on all three tables, there is **no permissive
policy** on `analytics_events`, and `anon` and `authenticated` hold **no
privilege on it whatsoever**.

That combination is stronger than a restrictive policy: PostgREST cannot expose
a table the client roles have no grant on, so there is no policy to get subtly
wrong, no `using (true)` to be added by accident later, and no path by which one
tenant reads another's rows.

### 11.2 Ingestion

Exactly two ways a row is written, and no third:

| Path | Function | Origin | Nature |
| --- | --- | --- | --- |
| Server | `private.emit_analytics_event` (strict) via `private.try_emit_analytics_event` (non-fatal) | `backend` / `worker` / `system` | Evidence |
| Client | `public.track_analytics_event` | `public_web` / `customer_web` / `customer_mobile` / `pro_web` | Intent |

**`public.track_analytics_event` has no actor parameter.** Not an ignored one,
not a validated one — the argument does not exist. It also accepts no
timestamp, no dedupe key, no plan and no country; all are server-derived. A
client cannot attribute an event to another user because there is nowhere to put
it. This is the "no client-provided arbitrary `actor_user_id`" requirement
expressed in the **signature** rather than in a check a later edit could relax.

The client RPC additionally validates context: the organization must be
genuinely **public** (the same `get_public_organization` gate
`follow_organization` uses), and any location or barber must actually belong to
it. This closes the incoherent-context hole — events pointing at a private
tenant, or at a barber from a different shop, which would corrupt both tenants'
reports at once.

**Residual risk, stated plainly:** an attacker can still inflate a *public*
shop's view count by repeatedly calling the RPC. That is a rate-limiting
problem, and the brief explicitly declines to build an anti-fraud system in R3.
The client-side throttle reduces accidental inflation; it does not stop
deliberate inflation.

### 11.3 Function safety

- Every R3 function pins `search_path` — deliberately **not** filtered to
  `SECURITY DEFINER`, matching R1B's reasoning: an unqualified name resolves
  through the caller's `search_path` either way.
- Every `SECURITY DEFINER` function that reads privileged tables lives in
  `private` with `EXECUTE` revoked from `public`, `anon` and `authenticated`.
- `20260827120500` sweeps the catalogue and revokes the default `PUBLIC`
  `EXECUTE` grant from every R3 function in `public`, then re-grants exactly
  five signatures by name — so adding a sixth is a decision somebody has to
  write down.
- `prospect_worker` is granted nothing. R1A removed a broader grant from that
  role for the same reason: a scraping worker is the highest-risk credential in
  the system.

### 11.4 Analytics can never break the product

Every trigger calls `private.try_emit_analytics_event`, which wraps emission in
a plpgsql exception block — a **subtransaction**. A malformed event, a missing
taxonomy row or a constraint violation rolls back the event and nothing else;
the follow, booking, completion and claim all still commit. The failure lands in
`analytics_ingestion_rejections` instead of on the customer.

This is proven, not asserted: the verification suite **deletes the
`organization_followed` contract**, performs a Follow, and asserts the Follow
succeeded and the rejection was recorded.

### 11.5 Measured cost on the hot path

200 appointment completions, with and without the analytics triggers attached:

| | 200 completions | Per completion |
| --- | --- | --- |
| With analytics | 375 ms | 1.87 ms |
| Without analytics | 126 ms | 0.63 ms |

**Instrumentation adds ~1.2 ms per appointment completion.** Reported precisely
rather than as "no measurable overhead": it is a real cost, it is dominated by
the taxonomy lookup, actor classification, commercial snapshot and six index
updates, and it is negligible against a network round trip.

---

## 12. The query layer

Product surfaces **must not** query `analytics_events` directly — and cannot,
since the client roles hold no privilege on it. Four `SECURITY DEFINER`
contracts replace it, each authorizing its own caller and each returning
**aggregates only**.

| Contract | Who | Returns |
| --- | --- | --- |
| `get_organization_analytics_summary(org, from, to)` | owner / manager / platform admin | profile views, unique authenticated viewers, distinct anonymous sessions, booking starts, appointments created/confirmed/completed/cancelled/no-show, queue views/joins/completions/cancellations, follows, unfollows, favorites, unfavorites, unique customers, repeat customers, booking and queue conversion rates |
| `get_organization_retention_cohort(org, from, to)` | owner / manager / platform admin | first-time customers, returned at all, within 30/60/90 days |
| `get_professional_analytics_summary(pro, from, to)` | that professional / platform admin | profile views, unique viewers, follows, unfollows, completions, unique and repeat customers, relationships created |
| `get_platform_analytics_funnel(from, to)` | platform admin only | external profiles created, claims submitted/approved/rejected, **distinct** converted professionals, organizations with activity, platform product totals |

Design decisions worth recording:

- **Owner/manager, not every member.** A barber and a receptionist have no
  business reading the shop's conversion rates; `is_org_member` would have
  granted exactly that.
- **A professional's numbers are theirs, not their employer's.** R1B built a
  shop-independent identity precisely so it would not be readable by whoever
  they happen to work for.
- **Every window is bounded and capped at 730 days.** An unbounded aggregate
  over an append-only log is a scan whose cost grows forever; the cap makes the
  expensive query unwriteable rather than merely discouraged.
- **Conversion is completions over appointments *created*, never over
  `booking_started`.** Intent is a client event and no conversion metric may
  rest on one.
- **No bookings yields NULL, never 0%.** "No answer" and "0% success" are
  different statements and a shop reads them very differently.
- **Nothing here runs at ingestion.** No trigger, emitter or business path calls
  any of these.

---

## 13. Retention

`private.purge_analytics_events(cutoff)` is the only path by which an event is
ever removed, and the only holder of the flag the append-only `DELETE` guard
honours. It **refuses any cutoff inside 90 days** — a mis-signed interval, a
timezone slip or a typo'd unit in a future retention job cannot reach live data.

It is deliberately **not scheduled**. R3 installs no cron, and a retention
policy is an operator decision with legal weight. What R3 provides is a safe,
auditable, single-purpose primitive for whoever makes it.

**Recommended starting policy** (not implemented, for the operator to decide):
retain raw events 24 months; if longer history is needed, roll up to monthly
aggregates before purging rather than extending raw retention.

---

## 14. Mobile and Pro BI reuse

**Mobile.** `apps/web/src/lib/analytics/{events,client,session}.ts` are free of
React, of Supabase and of anything in `@/components`. `client.ts` takes its
transport as a function argument, so `apps/mobile` can hand it its own RPC
caller and reuse the entire contract. `analytics-context.tsx` is the only file
that knows about React and is the one file mobile will not import — web React
components are not shared. The `customer_mobile` origin already exists in the
enum and is inert until something emits it.

**Pro BI.** The four read contracts are the primitives a dashboard composes.
They return counts over a bounded window, authorize their own callers and
project no identity, so a BI surface built on them inherits the tenant isolation
and privacy posture for free rather than re-deriving it.

---

## 15. Departures from the R0 draft

| Draft said | R3 did | Why |
| --- | --- | --- |
| Table named `product_event` with `subject_type` / `subject_id` | `analytics_events` with explicit typed context columns | A polymorphic subject pair cannot be indexed usefully per entity and forces every report to cast. Explicit columns are what the §12 primitives actually group by |
| "Client telemetry: a separate stream" | One table, separated by the `emission` column on the registry and by `event_origin` | Two tables would mean two schemas, two retention policies and two query layers to keep in step — and the funnels in the brief cross the boundary (`booking_started` → `appointment_created`). The wall is enforced in the emitter instead, which is stronger than physical separation and cheaper to query |
| "Events table in `public` under platform-only RLS" | `public`, RLS forced, **no policy and no client grant at all** | A platform-only SELECT policy still requires a table grant to `authenticated`, which is a bigger surface than none |
| "Partitioning by month either way" | Not partitioned; design kept partition-compatible | Volume does not justify it yet, and the brief forbids premature partition complexity |

---

## 16. What R3 did not start

Confirmed absent from this lot: Worker V2 implementation, crawling, scraping,
outreach, campaign execution, Customer Mobile, Marketplace UX changes, the
FadeUp Pro BI dashboard, CRM, billing, multi-location UI, SMS, any scheduled
job, any third-party analytics SDK, and any request to an external host. No
price, plan, capability packaging, identity semantic or Customer API contract
was changed.

---

## 17. Files

**Migrations** (append-only, none edited):

| File | Contents |
| --- | --- |
| `20260827120000_analytics_event_foundation.sql` | 4 enums, 3 tables, 6 indexes, append-only guards, RLS posture |
| `20260827120100_analytics_event_taxonomy.sql` | 40 event contracts + seed assertions |
| `20260827120200_analytics_ingestion.sql` | actor classification, commercial snapshot, privacy gate, strict emitter, non-fatal wrapper, client RPC |
| `20260827120300_analytics_business_events.sql` | 13 instrumentation triggers |
| `20260827120400_analytics_query_contracts.sql` | window helper, 4 read contracts, retention purge |
| `20260827120500_analytics_privilege_hardening.sql` | catalogue-driven revoke sweep + 8 posture assertions |

**Artefacts:** `supabase/MASTER_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql`
(generated by `scripts/generate-master-r3.sh`),
`supabase/SEED_R3_PRE_UPGRADE_2026_08_27.sql`,
`supabase/VERIFY_R3_ANALYTICS_EVENT_ENGINE_2026_08_27.sql`.

**Web:** `apps/web/src/lib/analytics/` (`events.ts`, `client.ts`, `session.ts`,
`analytics-context.tsx`, `index.ts`, `analytics.test.ts`), plus instrumentation
in the shop profile, public barber profile, discovery search, business listing
card, booking wizard, walk-in check-in and queue display.

---

## 18. Validation

| Test | Result |
| --- | --- |
| Fresh database, all migrations + `VERIFY_R3` | **114 PASS / 0 FAIL** |
| Upgrade: pre-R3 baseline + populated seed + MASTER + `VERIFY_R3` | **123 PASS / 0 FAIL** |
| MASTER generator safety assertions | pass (in sync, no forbidden statement, no backfill, no client grant, 13 triggers present) |
| R1A / R1B / R2 / Service Mode / Organization Follows / Customer API Freeze / Lots A–B / Worker V2 | **993 PASS / 0 FAIL** |
| Web unit tests | **703 PASS / 0 FAIL** (71 files, 17 of them new analytics tests) |
| TypeScript | clean |
| Production build | succeeds |

**Two pre-existing issues, both verified against a pre-R3 database and both
unchanged by R3:**

1. `VERIFY_LOT_C` (54 errors), `VERIFY_LOT_D` (91), `VERIFY_LOT_E` (48) fail
   with *"the booking capability is not available on the free plan"*. Their
   fixtures create free-plan organizations and the Service Mode lot made
   booking admission consult `org_has_capability`. Identical counts before and
   after R3. Fixing them means re-planning those lots' fixtures — Service Mode
   cleanup, not analytics work.
2. `VERIFY_R1A` check 10.7 (the public-table allow-list) had been failing since
   the Customer API lot added `organization_follows` without extending it. R3
   added both `organization_follows` and its own three tables, and the check now
   passes on a pre-R3 database (103 tables) and on an R3 database (106). This is
   a correction of an existing gap, not a relaxation made to fit R3.
