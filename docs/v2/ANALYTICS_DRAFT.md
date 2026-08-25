# R0 — Analytics Draft

Status: **draft for R3**. R1 implements none of this.
Its only job is to ensure the events R3 needs will be *derivable*.

---

## 1. What exists today

**Nothing. Zero tracking calls in the entire product.** Verified: no PostHog, no
GA/gtag, no Segment, no Mixpanel, no Sentry, no `navigator.sendBeacon`, and no
`fetch()` to any external host from `apps/web/src`. The only identifiers
containing "analytics" are `competitor_analytics` — an internal acquisition view
— and an illustrative marketing mockup.

This is a **clean sheet**, and that is an advantage: the decision can be made on
merit rather than inherited.

---

## 2. The recommendation, and why

**First-party events written server-side, in the same transaction as the
business fact.** Not a client SDK.

The codebase already has this pattern and it works: `notifications` rows are
written by `private.emit_booking_notification()` inside the transaction that
changes the appointment, with a `dedupe_key` making emission idempotent. An
event stream should be the same shape.

Reasons this fits FadeUp specifically:

* **The interesting events are server-side facts.** "Booking confirmed",
  "service completed", "claim approved", "prospect converted" all happen in
  PostgreSQL. A browser SDK cannot observe them, and would have to be told —
  which is how analytics starts disagreeing with the database.
* **A client SDK cannot see the acquisition funnel at all.** Half the funnel R3
  must measure (discovered → normalized → qualified → contacted → replied) never
  touches a browser.
* **Privacy.** Constitution §4.3 forbids exposing customer operational data. A
  third-party SDK in the customer app is a standing risk of shipping exactly
  that. First-party keeps it inside the trust boundary.
* **RLS already gives the right default.** An events table with
  platform-admin-only SELECT inherits the discipline of the other 89 tables.

Client-side telemetry is still needed for *interface* questions — which CTA was
tapped, where a funnel is abandoned. That is a smaller, separate stream and
should stay separate rather than being merged into the business event log.

---

## 3. Shape

Sketch. R3 decides.

```
product_event
  id, occurred_at
  name              'booking.confirmed', 'service.completed', 'follow.created', …
  actor_user_id     nullable — anonymous events are real events
  subject_type      'appointment' | 'professional' | 'prospect' | …
  subject_id
  organization_id   nullable — platform-scoped events have none
  properties        jsonb
  dedupe_key        nullable unique — idempotent emission, as notifications does
```

**Naming: `domain.past_tense`.** An event records something that *happened*, not
something requested.

**Emission is idempotent.** A retried transaction must not double-count. The
`dedupe_key` convention already exists in `notifications`.

---

## 4. The two funnels R3 must measure

**Product**
```
discover → view profile → start booking → confirm → complete → follow → return
```

**Acquisition** (Worker)
```
discovered → normalized → qualified → external profile published
           → contacted → replied → claim started → claim approved
           → activated → paid
```

The acquisition funnel is largely *already* derivable — `prospect_pipeline_stage`
has ten states, and `prospect_events` and `outreach_events` exist. What is
missing is the tail: **publication, claim and activation**, because those stages
do not exist yet.

---

## 5. What R1 must preserve for R3 to be possible

R1 emits no events. It must, however, leave the *facts* recoverable:

| R3 needs | R1 provides |
| --- | --- |
| when a service was completed | `appointments.completed_at` (Phase 0 #2) — today there is **no** such column and `decided_at` is overloaded across approve/cancel/complete |
| whether a booking was self-made | `booked_by_user_id` — distinguishes customer-initiated from staff-created, which no column does today |
| when a follow happened, and how | `followed_at` + `source` (manual/auto) on the follow edge |
| when a relationship began and last occurred | `first_completed_at` / `last_completed_at` on the aggregate |
| when a claim was filed and decided | `submitted_at` / `decided_at` / `decided_by` on the claim |
| publication of an external profile | the identity row's `created_at` + `source='worker'` |
| verification decisions | `platform_audit_log` rows written atomically with the state change |

Every one of those is a timestamp or a discriminator that would be **impossible
to reconstruct after the fact** if R1 omitted it. That is the whole of R1's
analytics obligation.

---

## 6. Explicit non-goals for R1

No event table, no emission, no instrumentation, no dashboards, no SDK, no
external host. R1 must not add a `fetch()` to any third party — the browser
bundle currently reaches exactly two hosts (Supabase and the map tile server) and
that should remain a deliberate decision.

---

## 7. Open questions for R3

* Retention and PII: does `properties` ever hold personal data, and what expires
  it? Recommendation: never store PII in `properties`; store subject ids and join
  at query time under platform RLS.
* Anonymous identity: how is a pre-signup session stitched to an account after
  registration, without creating a tracking identifier that outlives consent?
* Does the events table live in `public` under platform-only RLS, or in a
  separate schema? Volume argues for partitioning by month either way.
* Client telemetry: separate stream, and does it require a consent banner in the
  jurisdictions FadeUp operates in? (Ten locales are shipped; several are EU.)
* Is any event ever exposed to a tenant — e.g. a shop seeing its own funnel — and
  if so, through which projection?
