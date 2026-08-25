# FadeUp Social-First V2 — Roadmap

> **Note on provenance.** This file is created by R1, not by R0. No `docs/v2/`
> directory existed on any branch or in any commit reachable from `git log
> --all` before R1 — see `R1_DOMAIN_DECISIONS.md` §D1. The lot numbering below
> is taken from the R1 mission brief, which references R2–R19; the content of
> those lots is **not** restated here beyond what the brief specifies, because
> inventing their scope is not R1's to do.

---

## Status

| Lot | Scope | Status |
| --- | --- | --- |
| R0 | Architecture direction | **No artifacts found.** R1 proceeded from schema evidence instead. |
| **R1** | **Domain model, database foundation, acquisition foundation** | **Complete** — see `R1_IMPLEMENTATION_REPORT.md` |
| R2 | Pricing, plans, capability catalogue, entitlement gating | Not started |
| R3 | Product analytics and event architecture | Not started |
| R4 | Worker engine foundations (adapters, pipeline, dedupe service, jobs, budgets) | Not started |
| R6 / R7 | Social UI — Follow, verified customers, social proof | Not started |
| R10 | Worker discovery at scale → external profiles | Not started |
| R16 | Subscription capabilities | Not started |
| R17 | Outreach and closer system | Not started |
| R18 | Multi-location experience | Not started |

---

## R1 — what actually shipped

Six new tables, four extended, eleven additive migrations. Nothing dropped,
no column removed, no row deleted, no type converted.

* **Durable professional identity** (`professionals`) that outlives shop
  membership, serving claimed *and* external/unclaimed profiles from one table.
* **Social graph** (`professional_follows`) with explicit, sticky unfollow
  intent, idempotent under retry and concurrency.
* **Genuine completed-service relationships**
  (`customer_professional_relationships`), keyed per shop, rebuildable from
  `appointments`/`queue_entries`.
* **Opt-in public customer identity** (`customer_public_profiles`) with
  platform-only verification, audited through the existing `platform_audit_log`.
* **Consent-gated social proof** (`professional_client_showcases`).
* **Fade Passport identity** — extended the existing `customer_passports`
  rather than creating a table; now issued automatically with a stable
  non-enumerable number.
* **Claim lifecycle** (`professional_profile_claims`) with three independent
  guards against duplicate or hostile ownership.
* **Trustworthy attribution provenance** (`booked_by_user_id`) — the security
  change the rest of the lot depends on.

Verified by 106 assertions on a seeded pre-R1 database and 91 on a fresh one,
0 failures in both.

---

## What R1 changed about later lots

**R2 must know:**

* `barbers.professional_id` is nullable and should become `NOT NULL` — recipe
  in `DEPRECATIONS.md` D1.
* There is no generated DB TypeScript type (D5). Adding one is R2's call.
* R1 deliberately contains **no** plan, price, subscription, tier or
  entitlement column. `claim_state` answers *who controls this identity*, never
  *what they have paid for*. A claimed profile is Free.
* Two pre-existing write-authorization gaps are logged for R2: D3 and D4.

**R3 must know:** auto-follow is best-effort and lossy by design (D8). If it
ever needs an at-least-once guarantee, that is an outbox, and R3 owns the
event architecture.

**R4 / R10 must know:** R1 added **no** Worker observation, matching or dedupe
structure — that pipeline already existed and is untouched. The only new
surface is `create_external_professional()`, which enforces safe defaults in
code (unowned, unclaimed, not public, not verified) and is idempotent per
prospect. Nothing in R1 propagates prospect data onto a *claimed* professional;
that write path does not exist, and R4/R10 must not create one.

**R6 / R7 must know:** `handle` and `username` exist, are unique and format-
checked, and are unpopulated (D7). Follower counts are capped at 1000+ (D6);
materialising a real counter later is purely additive.

**R17 must know:** the professional merge path is a **hard prerequisite** (D2).
`approve_professional_claim()` currently fails closed when the claimant already
has an identity — which is the most common real claim scenario.

**R18 must know:** `professionals` is already organization-independent and a
single identity already spans multiple `barbers` rows across organizations, so
multi-location does not require an identity redesign.

---

## Not started, and deliberately so

R1 built no UI, no feed, no scrapers, no outreach, no analytics pipeline, no
entitlements, no Stripe, no wallet, no search infrastructure, no job
infrastructure, and introduced no SMS. It was not deployed to production.
