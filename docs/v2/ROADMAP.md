# FadeUp Social-First V2 — Roadmap

Status: **R0 reconstructed and corrected after independent adversarial review. R1A implemented and validated. R1B implemented and validated. R2 not started.**

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
| R2 | Pricing, plans, capability catalogue, entitlement gating | Not started — see `ENTITLEMENTS_DRAFT.md` |
| R3 | Product analytics and event architecture | Not started — see `ANALYTICS_DRAFT.md` |
| R4 | Worker engine foundations | Not started |
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
| `ENTITLEMENTS_DRAFT.md` | R2 sketch. Constrains R1 only by what it must not preclude. |
| `ANALYTICS_DRAFT.md` | R3 sketch. Lists the facts R1 must leave recoverable. |
| `ROADMAP.md` | This file. |
| `R1A_IMPLEMENTATION_REPORT.md` | What R1A actually did, and its validation results. |
| `R1B_IMPLEMENTATION_REPORT.md` | What R1B actually did, its validation results, and the two places it deliberately departs from `MIGRATION_STRATEGY` §2 Phase 3 (public customer profiles and showcases deferred to R6/R7). |

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

**R2** — `barbers.professional_id` → `NOT NULL` (recipe in `MIGRATION_STRATEGY`
§8); DB type codegen + `Database` generic; the pre-existing write-authorization
gaps R1 logs but does not fix.

**R3** — auto-follow is best-effort and lossy by design; if it ever needs an
at-least-once guarantee, that is an outbox, and R3 owns event architecture.

**R4 / R10** — R1 adds **no** Worker observation, matching or dedupe structure;
that pipeline is production quality and untouched. The only new surface is
controlled external-profile creation with safe defaults, idempotent per prospect.
Nothing propagates prospect data onto a claimed identity, and that write path
must not be created.

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
| SEC-2 | The cold-outreach worker can read every tenant's transactional email stream | **HIGH** |
| SEC-1 | `professional_applications.internal_note` readable by the applicant | **MEDIUM** |
| APP-1 | Booking emails render as application rejections once SMTP is enabled | **HIGH** |
| SEC-3 | Kong on `0.0.0.0:18100` — **downgraded to MEDIUM**: credential-gated (basic-auth; key-auth+ACL), real `.env` not the placeholder; the loss is nginx's TLS/rate-limit boundary, not open data | MEDIUM |
| SEC-4 | **WITHDRAWN — disproved.** Every acquisition RPC re-derives `is_platform_admin()` in-body. Replacement: `prospect_effective_locale(uuid)` has no role check | LOW |
| SEC-5 | `customers.notes` readable by role `barber` | MEDIUM |
| APP-2 | Platform notification bell is inert — table not in the realtime publication | MEDIUM |
| — | Chair Mode is sold on `/pricing` and `/features` but marked `planned` in code | MEDIUM |
| — | No CI anywhere; Playwright installed but unconfigured | MEDIUM |

**Two items need no lot and should be done immediately:** bind Kong to
`127.0.0.1`, and fix the Worker email-template ternary before SMTP is ever
enabled — today six booking templates route through a two-branch boolean, so a
customer whose booking is *confirmed* would receive application-rejection copy.
