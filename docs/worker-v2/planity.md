# Worker V2 — Planity

What FadeUp reads from Planity, what it deliberately does not, and why the
answers are shaped the way they are.

Companion documents:
- [`competitor-intelligence.md`](./competitor-intelligence.md) — the provider registry, detection and discovery policy this builds on
- [`acquisition-intelligence.md`](./acquisition-intelligence.md) — the pipeline and its three governing rules

---

## What was already there

Planity has been a seeded provider in `booking_providers` since the competitor
subsystem shipped, with domain signatures and full host-based matching. The
Worker already detected it from a business's **own** website — a booking link,
a script, an iframe, a JSON-LD `potentialAction` — and recorded an append-only
`booking_provider_observations` row with confidence and evidence.

R4.1 did not rebuild any of that. It adds the one fact that detection could
never produce.

## The fact that was missing

A link on a barber's website proves a **relationship** with Planity. It cannot
say whether that barber is actually bookable there, because that fact does not
live on their site — it lives on Planity's.

```
they use Planity                                    (website detection)
they use Planity and 67 of 97 services are bookable  (this)
```

The difference is the difference between a migration target and a listing that
outlived a subscription. Selling "migrate off Planity" to someone who already
left is worse than saying nothing.

## ACTIVE / LISTED_ONLY / UNKNOWN

`booking_provider_observations.booking_status`:

| Value | Meaning |
|---|---|
| `ACTIVE` | The provider's public page offers at least one bookable service. |
| `LISTED_ONLY` | The page exists and reliably shows nothing bookable online. An observed negative. |
| `UNKNOWN` | Not observed, or observed and not classifiable. |

`UNKNOWN` is the default and the value every website-derived detection keeps,
because a link cannot know. This mirrors the subsystem's existing
`NO_BOOKING` vs `UNKNOWN` discipline exactly: **a page existing is never
sufficient for ACTIVE.**

The signal is the per-service `"bookable": true|false` data key, plus the
rendered "cannot be booked online" copy. Never a CSS class name — Planity's are
build-hashed (`service-module_notBookable-fobrZ`), so a selector written
against one would break on their next deploy and break *silently*, degrading
every prospect to UNKNOWN with no error anywhere.

## How a page is reached

**One path only: the business's own website links to it.** That is a
first-party statement — "this is where you book us" — and it is the strongest
provenance available.

There is deliberately **no search-based discovery**. Worker V2 has six adapters
and none is a general web search; Google Places is a places API. Introducing a
search dependency to guess at Planity URLs would be a large, expensive addition
in service of a weaker signal. There is no URL construction from business
names either — that is brute-forcing.

The candidate query selects prospects with a current Planity observation whose
`evidence` is an establishment URL and whose `last_seen_at` is older than
`PLANITY_RECHECK_AFTER_HOURS` (default 30 days), or whose status is still
UNKNOWN. `last_seen_at` is maintained by the observation trigger that already
existed, so freshness needed no new state.

## Provenance, and what Planity may never do

**Planity evidence never counts toward publication.** The enrichment job writes
no `prospect_source_records` row at all, and the source is not an identity
trust anchor.

The reason is the evidence chain. The page was reached by following a link the
business published *about itself*, so it is the same chain as the `website`
source, one hop longer. Counting it separately would let a prospect known only
from its own website clear the two-independent-sources bar by way of a link it
wrote about itself.

This is the same principle R4.1 applies to `prospect_sources.independence_group`:

| Group | Sources | Why |
|---|---|---|
| `openstreetmap` | `osm`, `geoapify` | Geoapify redistributes OSM. One observer, two reports. |
| `planity` | `planity` | A hint and the page it points at are one chain, not two. |
| *(ungrouped)* | `sirene`, `google_places`, `website`, `instagram` | Independent observers, or not yet assessed. |

`publication_block_reason` counts distinct **independence groups**, not distinct
source rows. This tightened the gate: a prospect seen only by OSM and Geoapify
was eligible before R4.1 and is refused after it, which was the correct answer
both times — the gate simply could not express it.

## Crawling constraints

Everything is enforced in `PlanityClient`, not left to callers.

- **robots.txt is fetched once and honoured.** The `User-agent: *` group only;
  adopting a named agent's laxer rules would be evasion. **Unfetchable robots
  means no request** — fail closed.
- **Establishment pages only.** A category page, a marketing page or any other
  host is refused before a socket opens.
- **One request in flight**, with a 2s minimum gap. There is no volume target: a
  salon's listing does not change minute to minute.
- **20s timeout, 4 MB response cap.**
- **403 / 429 / challenge interstitial → stop.** After two consecutive blocks
  the batch ends. There is no retry with a different User-Agent, no proxy
  rotation, no CAPTCHA handling, and no code path that could be extended into
  one. A 200 that is actually a challenge is never parsed, because extracting
  nulls from an interstitial and recording them would be a fabricated
  observation.

Every request goes through the existing `withQuotaGuard`, so `api_source_health`
gets latency, success/failure and status codes, and an operator can pause the
source from `/platform` without a deploy.

## Identity matching

A first-party link is strong provenance, not proof. Real cases that break it: a
group site listing several salons' pages, an agency template with a demo link,
a domain that changed hands.

`matchPlanityEstablishment` requires **one strong signal, or two weak ones**:

- identical E.164 phone → match
- identical postcode **and** matching name → match
- matching name **and** matching city → match
- **name alone is never sufficient**, at any strength
- a conflicting phone, or a conflicting postcode with no phone, **rejects
  outright** however much else agrees — two salons in a chain share a name and
  a town, but not a phone number

A rejected page writes nothing at all and is counted as `noResult`.

## Team members

Planity exposes practitioners. FadeUp takes the **count** and discards the
names in the same expression.

An employee **never** becomes a standalone marketplace prospect. Marketplace
prospects are barbershops and independent barbers; a salon's staff are neither,
and creating profiles for them would manufacture supply that does not exist.
The count only ever raises `estimated_barber_count`, because a Planity page
shows the bookable team, which is a floor rather than a headcount.

## Job result semantics

`planity_enrichment` reports counters that mean what they say:

| Counter | Meaning |
|---|---|
| `selected` | Returned by the candidate query |
| `attempted` | An HTTP request was actually made |
| `enriched` | Evidence returned **and** matched **and** persisted |
| `noResult` | The request succeeded but produced nothing usable — including a page that did not corroborate the prospect |
| `skipped` | Never attempted: source disabled or paused, URL unusable, robots refusal |
| `failed` | A real transport, parse or persistence failure |

**`last_enriched_at` advances only on the `enriched` path.** Not on selection,
not on a skip, not on a robots refusal, not on a 404, not on an unmatched page.
R3's trigger on that column is what emits `prospect_enriched`, so setting it
anywhere else would fabricate a server-authoritative analytics event for an
enrichment that did not happen. The job emits no analytics event directly.

Operational detail — pages attempted/matched/unmatched, ACTIVE vs LISTED_ONLY
counts, parse failures, 403/429/challenge counts — is logged and returned as
`metrics`, not turned into product analytics events. R3's taxonomy is a closed
vocabulary and none of these belong in it.

## Idempotency

Re-running the job produces no duplicate rows. The observation insert relies on
the existing `BEFORE INSERT` trigger, which extends `last_seen_at` on the
current row and cancels the insert when the provider is unchanged. URLs are
canonicalised before storage — scheme, `www`, trailing slash, tracking
parameters and fragment all collapse to one form — so the same establishment
reached through two spellings is one row, not two.

## Scoring

Planity usage reaches scoring through the path that already existed:
`booking_detected`, `booking_provider` and `competitor_switch_candidate`
features, then `migration_potential`'s `on_competitor_platform` factor. **No
score is computed in the adapter or the job.** R4.1 adds no scoring rule; it
makes the inputs better, and `booking_status` is available for a future factor
that wants to distinguish an active competitor account from a dormant listing.

## What this does not do

No discovery. No search. No URL enumeration. No bulk crawl. No publication —
the R4 gate is untouched and `prospect_worker` still cannot publish. No outreach
of any kind. No service-menu ingestion beyond bookable/total counts. No storage
of raw HTML. No practitioner identities.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `PLANITY_ENABLED` | `true` | Explicit opt-in string; anything unrecognised means disabled |
| `PLANITY_REQUEST_TIMEOUT_MS` | `20000` | |
| `PLANITY_MIN_REQUEST_INTERVAL_MS` | `2000` | Minimum gap between requests |
| `PLANITY_BATCH_SIZE` | `25` | Candidates per job |
| `PLANITY_RECHECK_AFTER_HOURS` | `720` | 30 days |

Per-source pause and quota are **not** duplicated here — `prospect_sources` and
`api_source_limits` already own them.

## Running it

```bash
cd apps/prospect-worker-v2
npm test                  # 308 tests
npm run typecheck
npm run build
```

```bash
# Replay every migration into a throwaway Postgres and run VERIFY
scripts/disposable-db-test.sh \
  --verify supabase/VERIFY_R4_1_PLANITY_AND_SOURCE_INDEPENDENCE_2026_08_28.sql
```
