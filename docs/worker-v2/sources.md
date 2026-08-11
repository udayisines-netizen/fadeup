# Prospect Worker V2 — sources

Every adapter implements the common contract in
`apps/prospect-worker-v2/src/sources/types.ts`
(`isConfigured()` + `discover(query, ctx)`), registered in
`src/sources/registry.ts`. A source's DB row (`public.prospect_sources`,
`is_enabled`) is independent of whether the Worker process actually has
credentials for it (`isConfigured()`) — both must be true for a source to
run; the job runner records "skipped" either way, never a hard failure.

## Waterfall (see architecture.md)

- **France**: OSM → Geoapify → Sirene → normalization/dedup → Google
  enrichment (for qualified candidates only) → website enrichment →
  Instagram enrichment.
- **Everywhere else**: OSM → Geoapify → normalization/dedup → Google
  enrichment → website/social enrichment. (Sirene is France-only — INSEE
  has no equivalent registry for other countries.)

This order deliberately spends free/cheap sources first and reserves
Google's metered quota for candidates that already look real.

## 1. OpenStreetMap / Overpass (`osm`)

No API key required — `isConfigured()` is always `true`. Queries
Overpass's public API (`OVERPASS_ENDPOINT`, default
`https://overpass-api.de/api/interpreter`) for `shop=hairdresser` nodes/
ways within a radius (`around:radius,lat,lon`) — **requires
latitude/longitude in the query**; a city-name-only query yields zero OSM
results (Overpass doesn't do free-text geocoding — that's Geoapify's
job). Also matches `shop=beauty` with a name containing "barber" as a
lower-confidence fallback.

**Verified live** against the real public Overpass API during this build
— see the worked example in operations.md. The free public instance is
sometimes slow/rate-limited under load (504/timeout); production should
budget for that (a paid/dedicated Overpass instance, or generous
timeouts + small radii) rather than assume every call succeeds quickly.

## 2. Geoapify Places (`geoapify`)

Requires `GEOAPIFY_API_KEY`. Category `commercial.hairdresser`, radius
search via `filter=circle:lon,lat,radius`. Not yet exercised against a
real key in this environment — verified with mocked responses only (see
`tests/sources.test.ts`).

## 3. INSEE Sirene (`sirene`)

Requires `INSEE_API_KEY` (a bearer token). **France-only** — returns `[]`
immediately for any other country. Queries by NAF/APE code `9602A`
("Coiffure") + city. Contributes SIRET as a high-confidence dedup
identifier (see database.md's dedup section). **Not yet exercised against
the real INSEE API** in this environment (no key provisioned) — the
adapter follows Sirene API v3's documented response shape but should be
re-verified against a real response the first time a key is configured.

## 4. Google Places API (New) (`google_places`)

Requires `GOOGLE_PLACES_API_KEY`. Uses a minimal `X-Goog-FieldMask`
(id, displayName, formattedAddress, location, internationalPhoneNumber,
websiteUri, primaryType) — **never requests reviews or photos**, and is
never called as a bulk area sweep by the job runner (see architecture.md's
waterfall). Only place_id + the fields above are persisted — no bulk
"permanent copy" of Google's data.

## 5. Website enrichment (`website`)

No credentials needed. Crawls ONLY the homepage of a candidate's own
website plus (at most) one same-domain contact/about page it links to
(`MAX_CRAWL_DEPTH = 1`) — never authenticates, never follows an
off-domain link. Enforces a request timeout (8s), a response size cap
(2MB), and a minimum per-domain request interval (3s) so a job touching
many slow sites can't hammer any one of them. Extracts: business email
(`mailto:`), phone (`tel:`), Instagram/Facebook/TikTok links, a detected
booking-widget provider (Fresha, Treatwell, Booksy, Calendly, Vagaro,
SimplyBook, Square, Setmore, Schedulicity — matched by known script/link
domains), and page title/description.

## 6. Instagram (`instagram`)

Requires BOTH `META_ACCESS_TOKEN` and
`META_INSTAGRAM_BUSINESS_ACCOUNT_ID`. Uses the **official Meta Graph API
"Business Discovery" endpoint** — the one legitimate way to read another
public business account's basic public metrics (followers, bio, website)
without scraping instagram.com, queried through your OWN connected
Instagram professional account. Gracefully returns "not configured"
(never a crash) without both env vars — **not yet exercised against the
real Graph API** in this environment (neither credential is provisioned);
this needs Meta App Review to grant `instagram_manage_insights` before
it will work for real, and should be re-verified once that's in place.

Never scrapes Instagram HTML — this is the only Instagram data path in
the Worker, by design.

## Adding a 7th source

Implement `SourceAdapter` in a new file under `src/sources/`, register it
in `src/sources/registry.ts`, add its row to the seed `insert` in
`db/migrations/20260811150100_prospect_acquisition_schema.sql` (a new
migration, not editing the applied one), and add its env keys to
`src/config.ts` + `.env.worker.example` + this file. The job runner
(`src/jobs/discovery.ts`) needs no changes — it only depends on the
`SourceAdapter` contract.
