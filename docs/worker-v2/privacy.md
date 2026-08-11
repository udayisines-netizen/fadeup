# Prospect Worker V2 — privacy & data handling

## What this system collects

Public **business** information about barbershops/independent barbers:
name, business phone/email, business address, business website, public
social media handles/follower counts, and (via Sirene, France only)
public legal-registry facts (SIREN/SIRET, registered business name,
activity code). `prospect_contacts` may hold a named individual's
business-context name/role/phone/email (e.g. "owner — Jean Dupont —
jean@shop.fr") when a source surfaces it as part of a business's public
contact information — this is business/professional contact data, not
private consumer data, and is always tied to a specific business
(`prospect_id`).

## What this system does NOT collect

- No Instagram/social content beyond the official Graph API's public
  Business Discovery fields (followers, bio, website, media count) — no
  posts, no DMs, no follower lists, no private-account data.
- No authenticated/private website content — the website crawler
  (sources.md) never logs in, never follows a link requiring
  authentication.
- No Google Places reviews or photos — explicitly excluded from the
  `X-Goog-FieldMask` on every request.
- No scraped HTML from Google Maps or Instagram — both are official-API-only,
  by design (see sources.md).

## Provenance

Every fact is traceable to where it came from:
`prospect_source_records` (source, external_id, source_url, fetched_at,
last_verified_at, confidence) is never overwritten or discarded during
canonicalization — a prospect linked from 3 sources has 3
`prospect_source_records` rows, all preserved. The Prospect 360 page
surfaces this directly so Platform Owner can always see where a piece of
data came from.

## Suppression / Do Not Contact

`public.prospect_suppressions` — global, checked BEFORE a prospect is
written during discovery, not just after the fact. Two forms:

- **Prospect-scoped** (`scope='prospect'`) — this specific business.
- **Identifier-scoped** (`scope in ('phone','email','domain','instagram_handle')`)
  — blocks re-selection even if the business is rediscovered under a
  brand-new `prospect_id` later (a different source, a renamed business,
  etc.) — the whole point of tracking suppression by normalized
  identifier rather than only by row.

Every suppression records `reason`, `created_by`, `created_at` — never
silently applied.

## Outreach

`public.prospect_outreach` is a **manual logging table only** — Worker V2
does not send messages, emails, or DMs on its own initiative. Per spec:
"do NOT begin uncontrolled outreach automatically." The pipeline stages
`contacted → replied → demo → trial → customer/lost` are advanced by a
human (or a future, separate, deliberately-designed outreach tool), never
by the discovery/enrichment/scoring machinery itself.

## Retention

No automated retention/deletion job exists yet for prospect data (V1
scope was discovery/enrichment/dedup/qualification, not full lifecycle
management — see the master build's phase list). `prospect_suppressions`
rows are permanent by design (a suppression must survive rediscovery
indefinitely). A future retention policy (e.g. auto-archiving `lost`
prospects after N months) is a deliberate follow-up, not an oversight —
implementing one without clear business input on the right retention
window would be guessing.

## Fields prepared for a future privacy workflow

`prospects.do_not_contact` (denormalized, kept in sync by trigger from
`prospect_suppressions` for fast filtering), `prospect_suppressions.reason`,
and the pipeline's `lost` stage are the building blocks a fuller
opt-out/retention workflow would extend — deliberately not over-built
ahead of an actual requirement.
