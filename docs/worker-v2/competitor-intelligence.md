# Worker V2 — Competitor Intelligence

Which booking product a barbershop already uses is the single most
valuable acquisition signal FadeUp has. It decides the sales angle, the
template, and whether the business belongs in a migration campaign at all.

---

## The registry

`public.booking_providers` is a **configurable table**, not a Postgres
enum, because the spec requires the list be extensible and a Postgres enum
cannot have values removed or renamed safely.

Sixteen rows are seeded:

**France-weighted** — PLANITY, KIUTE, RESERVIO, SUMUP_BOOKINGS
**International** — BOOKSY, FRESHA, TREATWELL, SQUIRE, PHOREST, SALONIZED, TIMIFY, TIMELY
**Catch-alls** — CUSTOM_BOOKING (in-house booking on the business's own domain), OTHER
**Sentinels** — NO_BOOKING, UNKNOWN

`signatures` holds the detection signature set as JSON
(`{"domains": [...], "path_patterns": [...]}`) — the **single** place
provider domains live. Nothing outside `src/competitors/registry.ts` may
hardcode a competitor domain. Platform admins can edit signatures from
`/platform` without a deploy; the Worker falls back to its bundled copy if
the DB read fails, so a bad edit degrades one provider rather than
disabling competitor intelligence entirely.

### NO_BOOKING is not UNKNOWN

The distinction the whole subsystem is built around:

- **NO_BOOKING** — a crawl *completed* and found no booking affordance.
  A real, evidence-backed negative. Confidence is deliberately 0.7, not
  1.0: absence of evidence over an 8-page crawl is a weaker claim than a
  positive match.
- **UNKNOWN** — we have not determined it. The crawl failed, timed out,
  was blocked, or never ran.

Only NO_BOOKING prospects enter a "you have no online booking" campaign.
`competitor_analytics` reports the two separately, and the `/platform`
board states the difference in plain language on the page.

---

## Detection

Detection runs over structured signals the crawler extracted, never over
raw page text.

| Method | Confidence | Signal |
|---|---|---|
| `booking_url` | 0.97 | A link whose path or anchor text indicates booking |
| `booking_button_target` | 0.95 | The above, on a CTA-styled element |
| `embedded_widget` | 0.93 | A `<form action>` pointing at the provider |
| `iframe_domain` | 0.92 | An `<iframe src>` |
| `script_domain` | 0.90 | A `<script src>` |
| `structured_data` | 0.88 | JSON-LD `url` / `sameAs` / `potentialAction.target` |
| `outbound_link` | 0.70 | A plain link (could be a directory listing) |
| `domain_pattern` | 0.65 | A booking path on the business's own domain |
| `provider_directory` | 0.99 | A compliant provider API (none enabled) |
| `manual_override` | 1.00 | A human decision in `/platform` |

Matching is **host-based**, using exact-host-or-subdomain comparison.
`booksy.com.evil.test` does not match `booksy.com` — a naive `endsWith`
would accept it, and there is a test asserting it does not. "We used to
use Planity" in a blog post cannot brand a business as a Planity customer,
because page text is never matched.

---

## History, not a flag

`booking_provider_observations` is append-only. FadeUp never stores
`uses_planity = true`.

```
2026-08   PLANITY detected   (script_domain, 0.95)   is_current = false
2026-10   BOOKSY  detected   (booking_url,   0.98)   is_current = true
2027-01   FadeUp activated
```

A `BEFORE INSERT` trigger keeps exactly one `is_current` row per
`(prospect, provider)`:

- **Same provider re-observed** → extends `last_seen_at` on the existing
  row and cancels the insert. No duplicate.
- **Different provider** → retires every other current row and inserts.
  The retired rows *stay* — that history is what
  `competitor_tenure_days` is computed from, and tenure is one of the
  strongest migration-potential signals.

The trigger is `BEFORE`, not `AFTER`, because the partial unique index is
enforced as the row is inserted; an `AFTER` trigger would fire only after
the constraint had already rejected it. (This was caught by the behavioural
smoke test, not by inspection.)

---

## Provider discovery — and why it is off

Detecting a competitor *on a business's own website* is compliant: it uses
publicly accessible pages any visitor can load.

Using a competitor as a **discovery source** — enumerating the barbers
already on their platform — requires that provider to expose an official
API or an openly accessible listing.

`booking_providers.supports_compliant_discovery` records the assessment:

| Value | Meaning |
|---|---|
| `NULL` | **Not assessed.** Not permission. `CompetitorRegistry.discoverable()` returns only `true` rows. |
| `false` | Assessed, and no compliant surface exists. Website detection only. |
| `true` | A compliant official API or public listing exists and is configured. |

**Every seeded provider is currently `NULL`.** No competitor discovery is
performed. The `competitor_directory` source is registered so it appears in
the source admin UI with budgets and health, but seeded **disabled**.

Bypassing a login, CAPTCHA, anti-bot control or rate limit is not
implemented, and the `booking_provider_detection_method` enum contains no
value that could describe one. Where no compliant method exists, the
limitation is documented in `discovery_notes` and surfaced on the
`/platform` competitor page rather than worked around.
