# FadeUp Social-First V2 — Roadmap

Status: **R0 reconstructed and corrected after independent adversarial review. R1A, R1B, R2, Service Mode, the Customer API freeze, R3, R4 and R5 implemented and validated. R4 and R5 are deployed to the live database and the Worker is running.**

> **Provenance.** No `docs/v2/` directory existed in any commit reachable from
> `git log --all` before this reconstruction. The R0 artifacts named in the R1
> brief were never committed. Everything in `docs/v2/` was rebuilt from the
> repository itself — schema introspection, source reading, and executing both
> test suites — not recovered.

---

## Lot status

| Lot | Scope | Status |
| --- | --- | --- |
| **R0** | Architecture baseline, product constitution, target model, migration strategy | **Complete (reconstructed 2026-08-25)** |
| **R1A** | Data integrity & security foundation | **Complete (2026-08-25)** — see `R1A_IMPLEMENTATION_REPORT.md` |
| **R1B** | Social + acquisition domain foundation | **Complete (2026-08-26)** — see `R1B_IMPLEMENTATION_REPORT.md` |
| **R2** | Pricing, plans, capability catalogue, entitlement gating | **Complete (2026-08-26)** — see `R2_IMPLEMENTATION_REPORT.md`. Supersedes `ENTITLEMENTS_DRAFT.md`, whose per-location billing unit R2 reverses. |
| **Service Mode** | Booking + Live Queue admission model, enforced server-side | **Complete (2026-08-26)** — interstitial lot between R2 and R3. See `SERVICE_MODE_IMPLEMENTATION_REPORT.md`. Also closes the entitlement bypass R2 left open: booking and queue admission now consult `private.org_has_capability`, which nothing had called. |
| R3 | Product analytics and event architecture | **Complete (2026-08-27)** — see `R3_ANALYTICS_EVENT_ENGINE.md`. Canonical append-only `analytics_events`, a 40-contract taxonomy as data, 13 authoritative instrumentation triggers, one typed web adapter, four aggregation contracts. Backfills nothing: every funnel starts empty and fills from application forward. |
| **R4** | Worker V2 core & acquisition engine | **Complete (2026-08-28)** — see `R4_WORKER_ACQUISITION_ENGINE.md`. Builds Constitution §5.1's missing PUBLIC ELIGIBILITY stage as an eleven-reason gate enforced by a `BEFORE INSERT` trigger with no role exemption, wires R3's two deferred acquisition contracts, ships the publication and claim review screens, and deploys the Worker for the first time — which is how it found the Overpass silent-zero defect in §7. |
| **R5** | Design system & experience foundation | **Complete (2026-08-28)** — see `R5_EXPERIENCE_FOUNDATION.md`. Web only: there is no mobile application in this repository, and the lot says so rather than pretending otherwise. Fixes 69 colour utilities that named undefined token steps and therefore generated no CSS at all; rebuilds customer navigation around a central BOOK; makes marketplace cards expand in place into a shop's team and book without leaving the results; moves Fade Passport into Profile as a card rather than a form; gives the Pro dashboard six rearrangeable modules whose order belongs to the SHOP. Two migrations, both read-shaped, both verified by performing the operations as real roles through RLS. |
| R6 / R7 | Social UI — Follow, verified customers, social proof | Not started |
| R10 | Worker discovery at scale → external profiles | Not started |
| R16 | Subscription capabilities | Not started |
| R17 | Outreach and closer system | Not started |
| R18 | Multi-location experience | Not started |

---

## The R0 artifacts

| File | What it is |
| --- | --- |
| `PRODUCT_CONSTITUTION.md` | **Frozen product law.** Sixteen binding rules. Amendments must be explicit. |
| `R0_ARCHITECTURE_AUDIT.md` | What exists, measured. Nine defects (D-1…D-9) and the KEEP/EXTEND/REFACTOR/REPLACE/REMOVE matrix for 26 subsystems. |
| `TARGET_DOMAIN_MODEL.md` | Concept-by-concept: reusable / extend / new / derived. Answers A–O. Public/private data map. |
| `MIGRATION_STRATEGY.md` | Answers P–T. Exact migrations, backfills, RLS, indexes, tests, bridges, rollback. |
| `ENTITLEMENTS_DRAFT.md` | R2 sketch, **superseded**. Its per-location billing unit and `subscription_seat` table were reversed by R2; the banner at its top says which parts survived. |
| `ANALYTICS_DRAFT.md` | R3 sketch, **superseded** by `R3_ANALYTICS_EVENT_ENGINE.md`. Its funnel list and its idempotency instinct survived; its `product_event` shape, its separate client-telemetry stream and its month-partitioning did not — §15 of the R3 report says why for each. |
| `ROADMAP.md` | This file. |
| `R1A_IMPLEMENTATION_REPORT.md` | What R1A actually did, and its validation results. |
| `R1B_IMPLEMENTATION_REPORT.md` | What R1B actually did, its validation results, and the two places it deliberately departs from `MIGRATION_STRATEGY` §2 Phase 3 (public customer profiles and showcases deferred to R6/R7). |
| `R2_IMPLEMENTATION_REPORT.md` | What R2 actually did: the commercial model, the eight canonical plans, the capacity enforcement, its validation results, and the Constitution §6 amendment it required. |
| `R3_ANALYTICS_EVENT_ENGINE.md` | What R3 actually did: the four-stream boundary, the event table and why it deliberately carries no foreign keys, the taxonomy as data, the server/client emission wall, the two idempotency disciplines, the commercial snapshot, the privacy gate, the read contracts, and the five event contracts documented but not wired. |
| `SERVICE_MODE_IMPLEMENTATION_REPORT.md` | What the Service Mode lot did: the four modes, the establishment default and the two override layers, the one resolver, `queue_open` as a separate fact, the two `BEFORE INSERT` guards, the shared/exclusive mutex, and why R1A's VERIFY needed an entitled fixture afterwards. |
| `R5_EXPERIENCE_FOUNDATION.md` | What R5 actually did: the audit and the sixty-nine dead colour utilities it found, the token scales added, why BOOK is an action rather than a tab, why no availability time appears before a service is chosen, the two migrations and the two things the disposable database run found that reading the DDL would not, the acceptance-criteria table with its three qualified rows, and the deferred work. |
| `R4_WORKER_ACQUISITION_ENGINE.md` | What R4 actually did: the eleven-reason publication gate and why it is a trigger rather than a check inside the RPC, trust anchors as data, why the cache is deliberately not the guarantee, the machine-evaluates/human-decides split expressed as a revoked grant, the two acquisition event contracts, the Overpass silent-zero defect that deploying it surfaced, and the three closed-lot fixture corrections it required. |

---

## What R0 changed about R1

R0 was reconstructed from the repository as it stands. Three independent audits
and a three-specialist adversarial review found the following, each verified
against the live schema — several by executing the exploit, not merely reading
constraints:

1. **`appointments.barber_id` is `ON DELETE CASCADE`** — deleting a barber
   destroys their appointment history. A durable identity table over deletable
   evidence is theatre. R1 must fix the cascade.
2. **Completion is not trustworthy state** — no `completed_at`, queue timestamps
   written by the browser, and no transition guard, so any staff `PATCH` can
   assert a completed service.
3. **`customers.user_id` is forgeable two ways** — squatting (CRITICAL, proven
   end-to-end) and direct staff UPDATE. It cannot be a verification predicate.
4. **Typecheck and the 578 app tests cannot detect a schema break** — the
   Supabase client is untyped and the suite mocks it. Compatibility must be
   argued from database-level tests.
5. **A professional has no shop-independent public address**, and cannot edit
   their own public profile.

Consequence: **R1 is split.** R1A hardens integrity first; R1B builds the social
domain on top, only after R1A has landed and been observed. Verified Client is
scoped to the one attribution path that is forgery-resistant, and the coverage
limitation is stated in the product rather than hidden — early coverage is
plausibly a single-digit percentage of served customers, because staff-created
bookings, anonymous walk-ins and unredeemed anonymous bookings all fail to
qualify.

---

## Cross-lot notes

**R2 — done, with three items deliberately NOT done.** R2 built the commercial
model (see `R2_IMPLEMENTATION_REPORT.md`). Three things this section had
assigned to it were reassessed and left alone, each for a stated reason:

* `barbers.professional_id` → `NOT NULL` is **not** done. R1B's
  `assign_barber_professional()` deliberately leaves the column NULL for a
  roster row whose staff profile is an account-erasure tombstone, because
  inventing a claimed identity for a deleted account would be fabrication.
  Making the column NOT NULL therefore requires deciding what such an insert
  should do — refuse it, or mint an unclaimed identity — which is an identity
  decision, not a pricing one. It belongs with the lot that owns identity.
* DB type codegen + the `Database` generic is **not** done. It is a
  cross-cutting change to every query in the app and would have made R2's diff
  unreviewable; it remains open and is still worth doing.
* The pre-existing write-authorization gaps R1 logged are **not** fixed. R2
  added no bypass around them and asserts the R1A/R1B column protections still
  hold, but closing them was never R2's scope.

**R3** — auto-follow is best-effort and lossy by design; if it ever needs an
at-least-once guarantee, that is an outbox, and R3 owns event architecture.

**R4 — done.** R4 honoured this exactly: it added **no** Worker observation,
matching or dedupe structure, and the discovery/enrichment/scoring/outreach
pipeline is untouched. The one new surface is controlled external-profile
creation with safe defaults, idempotent per prospect. Nothing propagates
prospect data onto a claimed identity, and that write path was not created.

R4 went further than this note anticipated in one respect: it made the gate
**structural**. Publication is enforced by a `BEFORE INSERT` trigger on
`prospect_professionals` with no role exemption — not by a check inside the RPC
— so `create_external_professional`, a future auto-publish lane, and a direct
`psql` session as the table owner all hit the same wall.

**R10** still owns discovery at scale and auto-publication. Any bounded
auto-publish lane must sit **on top of** R4's gate, not replace it; the
`prospect_worker` role is explicitly revoked from
`publish_external_professional`, asserted inside the migration, so making the
machine able to publish requires deleting an assertion on purpose.

**R6 / R7** — handles exist but are unpopulated; follower counts are capped;
`/s/:slug/barbers/:barberId` must keep working when a handle route is added.

**R17** — the professional **merge** path is a hard prerequisite. Approving a
claim from someone who already has an identity must fail closed until merge
exists.

**R18** — `professionals` is already organization-independent, so multi-location
does not require an identity redesign. The shop/location incoherence (`/s/:slug`
cannot address a location; a location-less professional vanishes from search) is
R18's to resolve.

---

## Findings with no owner yet

These are **pre-existing** and unrelated to the social work. **R1A takes
ownership of D-1, D-2, D-3, D-8, SEC-1, SEC-2 and APP-1.** SEC-3 is a one-line
infrastructure change needing no lot. The rest are recorded so they are not
lost:

| | Finding | Severity |
| --- | --- | --- |
| D-1 | Contact-detail squatting — an attacker reads and cancels a victim's bookings | **CRITICAL, proven** |
| D-2 | Deleting a barber cascades away completed appointment history — **exploitable today over REST by any owner/manager** | **CRITICAL, proven** |
| D-3 | Completion + queue state forgeable by any `barber`-role member: status PATCH, causally-impossible backdated timestamps, and `customer_id` reassignment | **HIGH, proven** |
| D-8 | `customers.user_id` settable to any account by staff — **raised to HIGH**: composes with D-1/D-3 into a complete fabricated "verified client" about a real victim | **HIGH, proven** |
| SEC-2 | ~~The cold-outreach worker can read every tenant's transactional email stream~~ — **FIXED, verified 2026-08-28.** `email_outbox` is absent from `prospect_worker`'s 50 table grants; the dispatcher reaches the outbox only through `private.claim_next_email`. Closed by R1A's least-privilege migration. | ~~HIGH~~ CLOSED |
| SEC-1 | `professional_applications.internal_note` readable by the applicant | **MEDIUM** |
| APP-1 | ~~Booking emails render as application rejections once SMTP is enabled~~ — **FIXED, verified 2026-08-28.** `src/email/templates.ts` is an exhaustive fail-closed lookup, not the two-branch ternary. **Residual, MEDIUM:** the six booking templates have no copy at all, so once SMTP is enabled every booking email hard-fails to `failed` rather than sending the wrong thing. Failing loudly beats delivering a rejection to a confirmed booking; writing the copy belongs to whichever lot turns SMTP on. | ~~HIGH~~ → MEDIUM |
| SEC-3 | Kong on `0.0.0.0:18100` — **downgraded to MEDIUM**: credential-gated (basic-auth; key-auth+ACL), real `.env` not the placeholder; the loss is nginx's TLS/rate-limit boundary, not open data | MEDIUM |
| SEC-4 | **WITHDRAWN — disproved.** Every acquisition RPC re-derives `is_platform_admin()` in-body. Replacement: `prospect_effective_locale(uuid)` has no role check | LOW |
| SEC-5 | `customers.notes` readable by role `barber` | MEDIUM |
| APP-2 | Platform notification bell is inert — table not in the realtime publication | MEDIUM |
| — | Chair Mode is sold on `/pricing` and `/features` but marked `planned` in code | MEDIUM |
| — | No CI anywhere; Playwright installed but unconfigured | MEDIUM |

**Status of the two "do immediately" items, re-checked 2026-08-28 during R4:**

* The Worker email-template ternary is **already fixed** — `renderEmail` is an
  exhaustive lookup that throws rather than delivering the wrong message. What
  remains is the missing booking copy, recorded against APP-1 above.
* **Binding Kong to `127.0.0.1` is still open** (SEC-3). It is a one-line
  infrastructure change, it needs no lot, and R4 did not touch it because R4
  changed no Nginx or Kong configuration.

**Observation from R4 — no action, deliberately.** R1B's platform-staff SELECT
policy on `prospect_professionals` can never match a row, because the table has
no grant for `authenticated` and Postgres checks the grant first. R4 briefly
"fixed" this and R1B's VERIFY §8.16 caught it: the revoke and the policy are two
independent layers, and the policy is redundant rather than broken. The grant
was reverted and the publication queue derives what it needs from the cached
verdict instead. See `R4_WORKER_ACQUISITION_ENGINE.md` §9.1.

**New finding from R4 — closed.** The OSM adapter reported a server-side
Overpass timeout as "0 candidates found, source completed, no error", which the
search planner's saturation arithmetic would have read as an exhausted
geographic cell. Found by running a real discovery job, not by reading code.
See §7 of the R4 report.
