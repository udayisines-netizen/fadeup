# Worker V2 — Acquisition Intelligence

How FadeUp discovers barbershops, works out what software they already
use, decides whether they are worth approaching, and contacts them —
without ever guessing, fabricating a signal, or letting a model write a
word of the message.

Companion documents:
- [`competitor-intelligence.md`](./competitor-intelligence.md) — the competitor registry, detection and discovery policy
- [`whatsapp.md`](./whatsapp.md) — the WhatsApp Cloud API integration and Meta setup
- [`data-science.md`](./data-science.md) — the phased ML strategy, dataset and model registry
- [`planity.md`](./planity.md) — reading a provider's own public page, and the source-independence rule it forced

---

## The pipeline

```
SEARCH REQUEST
  ↓ prospect_searches                         (operator, from /platform)
SEARCH PLANNER                                 src/planner/
  ↓ prospect_search_partitions                (geo × keyword × provider tree)
MULTI-SOURCE DISCOVERY                         src/sources/
  ↓ prospect_source_records                   (raw, provenance preserved)
NORMALIZATION                                  src/normalize/
IDENTITY RESOLUTION                            src/dedupe/
  ↓ prospects, prospect_identity_matches      (auto-link or human review)
WEBSITE ENRICHMENT                             src/crawler/
  ↓ (SSRF-guarded, bounded)
COMPETITOR INTELLIGENCE                        src/competitors/
  ↓ booking_provider_observations             (historical, never a flat boolean)
FEATURE ENGINEERING                            src/features/
  ↓ prospect_features                         (TRUE/FALSE/UNKNOWN/NOT_APPLICABLE)
DATA QUALITY                                   ↓ prospect_data_quality
FADEUP FIT SCORING          ┐                  src/scoring/fit-scores.ts
MIGRATION POTENTIAL SCORING ┘ two DISTINCT scores → prospect_fit_scores
PROSPECT SEGMENTATION                          src/scoring/segments.ts
  ↓ prospect_segments
LOCALE RESOLUTION                              src/locale/
  ↓ prospect_locales
OUTREACH ELIGIBILITY          ← enforced in SQL, not application code
  ↓ public.outreach_block_reason()
TEMPLATE SELECTION            rules → experiment → ML (ranking only)
  ↓ outreach_templates (administrator-approved copy ONLY)
WHATSAPP BUSINESS CLOUD API                    src/whatsapp/
  ↓ whatsapp_messages, outreach_recipients
DELIVERED / READ / REPLY                       webhook, signature-verified
POSITIVE REPLY / CLAIM / ACTIVATION / PAID     outreach_events
  ↓
DATA SCIENCE FEEDBACK LOOP                     ml/
```

R4 added the branch that turns a prospect into marketplace supply rather than a
sales lead. It hangs off CANONICAL PROSPECT and runs in parallel with outreach:

```
CANONICAL PROSPECT
  ↓ PUBLICATION ELIGIBILITY   ← enforced in SQL, by a BEFORE INSERT trigger
  ↓ public.publication_block_reason()      eleven reasons, first hit wins
  ↓ prospect_publication_eligibility       a CACHE, refreshed by the Worker
OPERATOR DECISION                          publish_external_professional()
  ↓ prospect_professionals                 one identity per canonical prospect
EXTERNAL UNCLAIMED PROFILE                 professionals, claim_state=unclaimed
  ↓ CLAIM                                  professional_claims
CLAIMED PROFESSIONAL
```

See `docs/v2/R4_WORKER_ACQUISITION_ENGINE.md`. Two properties matter here:
**the Worker evaluates but cannot publish** — `prospect_worker` is explicitly
revoked from `publish_external_professional`, asserted in the migration — and
the gate is a trigger rather than a check inside the RPC, so no caller, role or
direct session can route around it.

---

## The four rules that shape everything

### 1. UNKNOWN is not FALSE

The single most consequential decision in this system.

A website crawl that timed out tells us **nothing** about whether a
business has online booking. Recording that as `booking_detected = FALSE`
would manufacture a signal out of an infrastructure failure, and then feed
it to scoring, to segmentation, and to the ML dataset. A barber who has
paid for Planity for three years would land in a campaign telling them
they cannot take bookings online.

So every derived boolean is a `public.prospect_tribool`:

| Value | Meaning |
|---|---|
| `TRUE` | Observed present |
| `FALSE` | Observed **absent** — we looked, successfully, and it was not there |
| `UNKNOWN` | Not observed. Says nothing either way. |
| `NOT_APPLICABLE` | The question does not apply to this business |

`private.tribool_is_true()` and `private.tribool_is_false()` exist as
separate functions precisely so the asymmetry is unavoidable in SQL:
`NOT tribool_is_true(x)` is **not** `tribool_is_false(x)`.

In scoring, an UNKNOWN awards zero points *and says so in the breakdown* —
it never counts as a negative. In the ML feature matrix, UNKNOWN encodes to
`NaN`, never `0`.

**The rule applies one stage earlier too, and R4 had to enforce it there.**
Overpass reports a server-side timeout as HTTP 200 with an empty `elements`
array and a `remark`. Read naively that is "there are no barbershops here" — a
zero manufactured from an infrastructure failure, exactly what this rule
forbids, and worse than a wrong tribool because `candidates_found` feeds the
search planner's saturation and yield-guard arithmetic. A timed-out geographic
cell would look exhausted and never be revisited. `src/sources/osm.ts` now
raises `OverpassRuntimeError` instead, classified retryable by name. A *failed
search is not an empty search*, and neither is a failed crawl.

### 2. Message copy is never generated

There is no LLM anywhere in the outreach path. The Worker has no AI
dependency at all.

Every outbound message is rendered from an administrator-written,
administrator-approved `outreach_templates` row by pure variable
substitution — no expression language, no conditionals, no `eval`, no
`Function` constructor. `src/outreach/template-engine.ts` substitutes a
whitelisted variable and nothing else, and rejects the send outright if any
placeholder cannot be filled (shipping `Bonjour, à {{city}} ?` to a real
barber is worse than not sending).

Machine learning may only **rank templates that the rules already deemed
eligible**. It cannot introduce a template, override a locale, bypass
eligibility, or alter a single character of copy.

### 3. Eligibility is enforced in the database

`public.outreach_block_reason(prospect_id, channel)` is the single source
of truth for "may we contact this business?". It is:

- **enforced** by a `BEFORE INSERT OR UPDATE` trigger on
  `outreach_recipients`, so neither the frontend, nor the Worker, nor a
  direct `psql` session can queue a message that violates it;
- **previewed** by `/platform`, using the same function, so the preview
  cannot drift from reality;
- **asserted** by `VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql`.

It blocks on: do-not-contact, prospect/phone/email suppression, prior
conversion, missing or withdrawn opt-in (per the operator-declared
per-country policy), an invalid destination, an unresolved locale, and a
locale flagged for human review.

A scraped phone number creates **no** eligibility. `is_eligible` defaults
to `false` and must be granted deliberately.

### 4. Two reports are not two observers

Added by R4.1, and it belongs beside the other three because it is the same
kind of rule: a guard against evidence that looks stronger than it is.

`publication_block_reason` requires two independent sources, and until R4.1 it
counted distinct source ROWS. Geoapify's places data is substantially derived
from OpenStreetMap, so a prospect seen by OSM and by Geoapify had been seen
ONCE and reported twice — and that cleared the bar and minted a durable public
identity.

`prospect_sources.independence_group` names the underlying observer. Sources
sharing a group count once; an ungrouped source is its own group, so nothing
else changed meaning. `osm` and `geoapify` share `openstreetmap`.

The same rule decides what Planity contributes, and the answer differs by role.
Planity DISCOVERY reads Planity's own category listing, which is a genuine
independent observation and counts as one observer. Planity ENRICHMENT reaches
its page by following a link the business published about itself, so it is the
`website` chain one hop longer and counts as nothing. The transport does not
determine independence; the underlying assertion does.

---

## Search planner

A search is a bounded tree of partitions: `(provider × keyword variant ×
geographic cell)`.

**Saturation** — a partition is saturated when the provider probably
truncated its answer (result count hit the documented per-response
ceiling, or the provider reported more pages). That is the only situation
where subdividing recovers businesses we would otherwise never see.

**The yield guard** — a saturated partition is *not* automatically
subdivided. If under 15% of its results were new, splitting it four ways
spends four times the API budget rediscovering the same shops. This is
where a naive quadtree crawler burns an entire Google Places budget, and
`assessSaturation()` refuses to.

**Cell subdivision** uses a child radius of `r × 0.6`, not `r / 2`: four
circles of exactly `r/2` centred on quadrant midpoints leave uncovered gaps
near the parent's edge. The ~20% overlap is deliberate — duplicates are
cheap (identity resolution collapses them), missed businesses are not.

**Hard limits** (`max_depth`, `max_partitions`, `max_requests`,
`max_runtime_seconds`) live on `prospect_searches` and are enforced both by
the planner and, independently, by a database trigger. A planner bug cannot
produce an unbounded tree.

---

## Feature engineering

`prospect_features` is a versioned store: one row per
`(prospect, feature_key, feature_version)`, each carrying value, evidence,
evidence source, observation time and confidence.

Features are grouped as:

- **Business** — rating, review count, estimated barber count, shop type,
  location count, source count
- **Digital** — has_website, website_quality_score, mobile_ready,
  https_enabled, contact_form, ecommerce_detected, publishes_pricing, cms,
  analytics_installed, broken_links_detected
- **Social** — instagram_presence, social_presence
- **Competitor** — booking_detected, booking_provider,
  competitor_switch_candidate
- **FadeUp fit** — online_booking_gap, live_queue_fit, marketplace_fit,
  shop_management_fit, digital_gap_score

Barber headcount is only ever taken from direct website evidence (a team
page), and `countTeamMembers()` deliberately returns `null` unless a page
genuinely looks like a team listing. An over-eager headcount would inflate
the multi-barber signal that both scores depend on.

---

## The two scores

They are **separate on purpose** and must never be blended.

### `fadeup_fit` — how valuable is this business to FadeUp?

0–100 across four groups whose maxima sum to exactly 100:

| Group | Max | What it measures |
|---|---|---|
| BUSINESS VALUE | 35 | rating, review volume, barber count, multi-location |
| DIGITAL GAP | 25 | booking gap, website gap, mobile gap |
| FADEUP FIT | 25 | live queue, marketplace, shop OS relevance |
| CONTACTABILITY | 15 | phone, email, social |

### `migration_potential` — how likely are they to switch?

Only meaningful for a business already on a third-party booking provider.
When there is nothing to migrate *from*, the score is **exactly 0 with an
explicit explanation** — not a low-but-nonzero number that could drift a
no-booking prospect into a migration campaign.

Note the deliberate inversion: for migration potential, digital *maturity*
scores **positively**. A business already running on software can evaluate
a replacement; one with no website rarely switches platforms on a cold
approach. That is the opposite of how maturity is treated in `fadeup_fit`,
and it is why the two scores cannot share a formula.

Every point awarded appears in the stored `breakdown`, and
`score = sum(breakdown[].points)` is asserted by the test suite.

### Score health

`public.prospect_score_distribution` exposes mean, median, standard
deviation and percentiles, plus `low_discrimination_warning` — which fires
when a score's standard deviation collapses below 5 points over a
meaningful sample. A score that assigns nearly everyone 85–95 is not a
score, it is a constant, and the operator is told rather than left to infer
it.

---

## Locale resolution

Evidence is consulted in a fixed priority order:

1. verified business country (a registry record, e.g. SIRENE)
2. business address
3. website `<html lang>`
4. provider-reported locale
5. phone country calling code
6. dominant website language

**The business name is never evidence.** "Le Barbier" in London is an
English-speaking business; "Gentlemen's Cut" in Lyon is a French one.

When evidence is ambiguous, contradictory, or resolves to a locale FadeUp
has no approved copy for, `language_review_required` is set and outreach is
**blocked** until a human decides. `+1` is deliberately not resolved: it is
ambiguous between US and CA.

---

## Job types

| Job type | Handler | Purpose |
|---|---|---|
| `search_plan` | `jobs/search-plan.ts` | Expand a search into partitions, fan out discovery jobs |
| `discovery` | `jobs/discovery.ts` | Run one provider over one partition |
| `website_enrichment` / `website_crawl` | `jobs/website-enrichment.ts` | Bounded crawl + competitor detection |
| `competitor_detection` | ↑ same handler | |
| `feature_computation` | `jobs/feature-computation.ts` | Features, data quality, locale, both scores, segments |
| `fit_scoring` / `segmentation` / `locale_resolution` / `data_quality` | ↑ same handler | One prospect snapshot, one pass |
| `identity_resolution` / `dedup_scan` | `jobs/dedup-scan.ts` | Fuzzy duplicate candidates for review |
| `outreach_preparation` | `jobs/outreach-preparation.ts` | Eligibility gate, template selection, rendering |
| `whatsapp_send` | `jobs/whatsapp-send.ts` | Drain a campaign's queued recipients |
| `outcome_processing` | `jobs/runner.ts` | Reconcile conversions back onto the funnel |
| `publication_evaluation` | `jobs/publication-evaluation.ts` | Refresh the operator's publication review queue (R4). **Evaluates only** — it holds no copy of the eligibility rules and cannot publish |
| `planity_enrichment` | `jobs/planity-enrichment.ts` | Read the public Planity page of prospects whose own website links to one. Enrichment only — see [`planity.md`](./planity.md) |

---

## Running it

```bash
cd apps/prospect-worker-v2

npm test                  # 217 tests
npm run typecheck
npm run build
npm run benchmark -- --country FR            # what the pipeline actually produced
npm run benchmark -- --country FR --json

python3 ml/test_ml.py     # ML pipeline tests, no database needed
```

Database:

```bash
# Replay every migration into a throwaway Postgres and run VERIFY
scripts/disposable-db-test.sh --verify supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql

# Prove MASTER upgrades the CURRENT production schema on its own
scripts/disposable-db-test.sh \
  --skip-from 20260818100000_prospect_competitor_intelligence.sql \
  --master supabase/MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql \
  --verify supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
```
