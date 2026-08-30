# R5R.1A-R1 — Home visual revision

**Status:** READY FOR SECOND HUMAN VISUAL REVIEW — not approved.
**Branch:** `rebuild/social-first-v2`
**Preview route:** `/_preview/r5r`
**Artefacts:** `docs/frontend/artifacts/r5r1a-r1/` (before: `docs/frontend/artifacts/r5r1a/`)
**Supersedes visually:** `docs/frontend/R5R1A_SHELL_AND_HOME.md`, which stays as the
record of what was rejected and why.

R5R.1A was technically accepted and visually rejected. This lot changes the Home
composition only. It writes no migration, alters no RPC, adds no dependency,
creates no parallel infrastructure, and touches nothing outside
`apps/web/src/customer-v2/` except ten translation bundles and the QA harness.

---

## 1. What changed, against each objection

| The review said | What it is now |
|---|---|
| §3 the hero is far too dominant on mobile | The display headline (32px phone / 44px laptop) is a 20px page title. Measured in the production build, the first real result moved from **256px to 216px** at 390 (269px from the top of the viewport, under a 52px sticky header) and to **183px** at 1440. |
| §4 location is country-oriented and heavy; no permanent "Use my location" beside the country | One 32px chip that opens a scope menu — precise location, the detected country, everywhere — as a radio group. The permanent 44px button is gone. Why it still says "France" and not "Créteil" is §6 below. |
| §5 the focused search has a heavy double green outline | `focus:border-v2-green` deleted. One 2px outline at 2px offset remains, unchanged in weight and colour. Capture: `home-searchfocus-390.png`. |
| §6 the standalone "Open now" makes Home look like a filter page | Demoted from a 44px bordered control under the search field to a 32px chip paired with the location chip. It still drives `p_open_now_only` server-side. No R5R.1B filters were added. |
| §7 Home must be a genuine discovery surface, sections only where real data exists | Two groups — Barbers and Barbershops — each a **separate server query** on the RPC's real `p_entity_type`, each with its own server `total_count`. A group with no results renders nothing at all. |
| §8 results are visually weak; the striped wells look like unfinished skeletons | The 4:5 media well is gone. Identity is a tile — 56px on a phone, 72px at md, 96px at lg — circular for a person, rounded square for a place. Empty draws a still two-stop fade; the skeleton sweeps. The two can no longer be confused. |
| §9 a shop and a professional must not feel identical, without noisy badges | Three signals, no badges: tile **shape**, outline **glyph**, and the second line — a barber's employer in FadeUp green, a shop's own street address. |
| §11 desktop is sparse; do not stretch mobile rows | A real header band (title and chips left, search right); the two groups **side by side** at 1200px, 566px each; and — after independent review caught that the rows really were the phone's — a desktop result at its own scale: 96px identity against 56px, 17px name, 24px padding, 151px tall against 115px. **Partially resolved; see §7.** |
| §12 move closer to Instagram density | Header down 40px; groups are grouped plates rather than a bare list. |
| §13 typography needs hierarchy without an editorial headline | Measured: page title 20/24 · group title 17/22 · entity name 15/21 · metadata 13/18. Four distinct roles from the existing scale. |
| §14 preserve the five-tab navigation | Untouched. |

---

## 2. Real data only

The live marketplace is two rows. Both are rendered; nothing else is.

```
shop   Side Agency  · Antony (92) · FR · open · 2500 · queue 0 · avatar NULL
barber Barber Test  · Side Agency · Antony (92) · FR · open · 2500 · claimed · avatar NULL
```

Every nullable value is still suppressed rather than defaulted: `is_open_now`
null means unknown and prints nothing, `distance_km` appears only once
coordinates were actually shared, `queue_waiting_count` only above zero, and a
price only once the organization's currency has resolved.

**No section was invented to fill the page.** Three were considered and
rejected, each for a reason in the schema rather than a matter of taste:

- **Popular / recommended-as-ranking** — there is no ranking model, no reviews
  table and no booking-count projection exposed to discovery. The RPC's own
  migration says `recommended` "is not a score, there is no model behind it".
- **Fresh work / cuts around you** — the entire public schema contains three
  image columns, all `avatar_url`, on `professionals`, `profiles` and
  `staff_profiles`. There is no portfolio or media table, so the section has no
  source at all.
- **Barbers you follow** — this one has a real contract
  (`list_my_followed_professionals`, `follow_professional`) and was still not
  built: it needs an authenticated customer, the preview is anonymous, and
  `professional_follows` holds zero rows, so it could be neither exercised nor
  QA'd in this lot. Recorded, not shipped.

Two groups of one is the honest shape of this marketplace. The same composition
carries eight per group without alteration.

---

## 3. The imagery question, restated

`search_public_professionals` hard-codes `null::text as barber_avatar_url` for
every shop row, and `staff_profiles.avatar_url` is null on the one barber row.
**Zero photographs exist anywhere in this product today.**

The first pass reserved a 92×115 portrait frame per row on the reasoning that a
visual trade needs its frame before its photographs. The reasoning was right and
the size was wrong: with no image, that frame was the loudest element on a row
whose actual content was a name, an address and an open state — and the review
read it as an unfinished skeleton.

The frame did not go away. It got small enough that being empty costs the row
nothing, and it is the same element a real avatar fills. Nothing reflows on the
day media starts arriving, which was the only good reason to reserve it.

---

## 4. Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 26 warnings — identical to the pre-lot baseline, **none in `customer-v2`** |
| `npm test` | **830 passed / 830, 87 files, exit 0**. Baseline was 822/86; this lot adds 8 tests in a new file plus the revised result spec. Nothing skipped, nothing weakened. |
| `npm run build` | exit 0; Home is 17.3 kB raw / 5.4 kB gzip in its own lazy chunk |

Browser QA against the **production build** (`vite preview`), 5 routes × 3
viewports = 15 combinations:

```
console errors 0   console warnings 0   failed requests 0   4xx/5xx 0
horizontal overflow 0   clipped text 0   controls without a name 0
images without alt 0   shadows 0   exactly one h1 per route: yes
mobile touch targets under 44px: none
```

The only sub-44px controls anywhere are the five desktop header nav links at
36px — pointer-only, above WCAG 2.2 AA's 24px, and sanctioned for that context
by `index.css`. Unchanged from the first pass.

Keyboard: 14 controls, every one with a visible 2px green ring, in a sensible
order. Clicking a result away from both the title and Book navigates to the real
barber profile.

States captured, each verified to be the state it claims: normal Home (en),
French, **Arabic at `dir=rtl`**, empty (a real country with no listings),
loading, error, focused search, searched, no-match, reduced motion, desktop.

---

## 5. Defects this lot found in its own work, and fixed

Recorded because the corrections are the load-bearing part, and because four of
the six were invisible to every numeric probe and appeared only when the
screenshots were actually looked at.

| Found | Fix |
|---|---|
| **Three sub-44px touch targets on mobile.** The location chip and the Open now chip were 32px, and the establishment name was an inline link measuring 89×15 inside a row whose whole surface already navigates elsewhere. | Both chips are now a 44px transparent button wrapping the 32px visible chip — the compact look is kept and the target is honest. The establishment stopped being a link: two destinations 15px apart is a mis-tap hazard, not an accessibility technicality. |
| **Both second lines truncated by 5px at 390.** "Side Agency · Antony (92)" wanted 181px and had 176. | Book moved off the identity line entirely, which took the text column from 176px to 260px. |
| **The operational strip wrapped and orphaned a separator**, rendering "· dès 25,00 €" as a second line starting with a bullet. | One line, with `truncate`. |
| **The first fix for that was worse.** `flex` + `truncate` clips mid-word with **no ellipsis at all**, because `text-overflow` does not apply across flex items. | An ordinary block with inline children, which is the only arrangement where `truncate` produces the "…" it promises. |
| **Arabic reordered a Latin address.** "19 rue Danton · Antony (92)" rendered as "rue Danton · Antony (92) 19" — the house number thrown to the far end by the bidi algorithm resolving against the paragraph instead of the run. | `<bdi>` on the name, the establishment and the place. All three are arbitrary operator-entered strings; only the address happened to expose it. |
| **French pushed the price out of the row.** "à partir de 25,00 €" is a full prepositional phrase. | `dès`, `desde`, `من` in fr/pt/ar — ordinary commercial register in each, not abbreviations. |

### And two defects in the QA harness itself

Both meant a gate was reporting success while measuring nothing.

- **`states.mjs` ignored `QA_OUT`** although the README said it honoured it.
  Running this lot's captures therefore wrote the state screenshots straight over
  the first pass's. **Thirteen files were lost** — untracked, no backup. The
  route sweeps the product owner actually rejected (`r5r1a/home-390.png`,
  `-430`, `-1440`) survived and remain the before-comparison. The variable is now
  read.
- **The RTL capture was not RTL.** It set only the browser `locale`, but FadeUp
  resolves language from `locale-detect`'s server-side country first — so the
  "Arabic" screenshot was a left-to-right French page, and an RTL regression
  could have passed the gate that exists to catch it. The captures now seed
  `fadeup-locale-explicit`, and each one records the `lang`/`dir` it actually
  rendered at, so the claim is a measurement. This is how the bidi bug above was
  found: the probe started working and immediately failed.

The heading probe was also still pointing at `#v2-discovery-heading`, an id this
revision removed, and had been silently returning null for every state.

---

## 6. Known remaining design tradeoffs

1. **Location still resolves to a country, never a locality.** The review asked
   for Créteil / Antony / Paris 8e where truthful data permits. It does not
   permit: `locale-detect` returns an ISO country code and its own source notes
   it carries "a country code and never coordinates, city or ASN", and
   `navigator.geolocation` returns coordinates with no reverse geocoder anywhere
   in the repository behind them. A district name would be invented. What FadeUp
   genuinely knows at locality resolution is where the *results* are, and every
   row prints its own real `city` — so locality is attached to the thing it is
   actually true of. A city selector is possible later: `p_city` is a real RPC
   parameter, but choosing a city is a filter, and filters are R5R.1B.
2. **Desktop still has vertical empty space below the groups** — measured at
   386px of 900px after the rescale. Superseded by §7.1, which carries the
   numbers and the argument.
3. **Follow is absent from the result**, though §10 lists it. The contract is
   real; the preview is anonymous and the follow table is empty, so it could not
   be exercised or QA'd. The row reserves the trailing action cluster for it.
4. **Rating and next availability are absent** because no reviews table exists
   and availability is a function of service, professional, location and date
   that this query has no notion of. Both are listed in §10 as "where REAL data
   exists"; neither does.
5. **A shop can still never show a photograph** — the RPC nulls
   `barber_avatar_url` on every shop row and `organizations` has no image column.
   Recorded as D-2 in `R5R_DEFECTS_FOUND.md`.
6. **The loading skeleton draws three rows per group** and the live answer is
   one, so there is a settle when data lands. The row geometry is exact; the
   count cannot be known in advance.
7. **No customer dark theme.** Unchanged from the first pass, and deliberate.
8. **Green now appears as text** on a barber's establishment name, alongside its
   use on the Book button. Filled green remains exclusively Book, so the
   conversion hierarchy is unchanged — but this is a widening of the first pass's
   "green means booking and nothing else" rule and is flagged as such.

---

## 7. Independent review, and what it changed

An independent reviewer ran against this lot and returned **NOT PASS** on the
first attempt. It was not ceremonial: it measured the production build itself and
found eight issues, and it confirmed the truth claims independently by capturing
both live RPC responses and mapping every rendered string back to a column.

**Fixed in response:**

| Finding | Fix |
|---|---|
| **The evidence pack was partly fake.** `home-390.png` was byte-identical to `home-fr-390.png` — `sweep.mjs` seeded no language, so the three primary §17 deliverables were all the French page under English names. This is the same bug that was diagnosed and fixed in `states.mjs` in this very lot, and its sibling was not fixed with it. | `sweep.mjs` now pins `fadeup-locale-explicit` from `QA_LOCALE`. All 15 sweep captures verified `lang=en`. |
| **`home-focus-1440.png` was byte-identical to `home-country-1440.png`** — the tab walk screenshotted *after* the loop, and the loop exits once focus has left the document, so the "visible focus" evidence showed nothing focused. | Captured inside the walk, scoped to a result's own Book control. |
| **A 162px void between the two header chips at 390.** The desktop half of this was fixed and the phone half left — the wrong half to fix first, since 390 is the primary width. | `justify-start gap-2` at every width. Measured gap: **8px**. |
| **The loading skeleton over-promised**, drawing three rows per group against a live answer of one — a measured 1117px → 565px collapse — while its own comment claimed "the content lands without moving anything". | Two rows per group, and the false claim removed from the comment. The row geometry is exact; the row *count* is a genuine unknown and the comment now says so. |
| **Desktop really was the phone's row at a wider measure**, which brief §11 rules out by name — and the file's own comment said so out loud. | A desktop result is now its own object: 96px identity, 17px name, 15px relationship line, 24px padding, 151px tall. |

**Not fixed, deliberately — and the product owner should weigh these:**

1. **Desktop still does not fill the viewport.** After the rescale, content ends
   at **386px of 900px** at 1440 — 57% empty, against 60% before. The reviewer is
   right that this is unresolved. It is unresolved because two listings cannot
   honestly fill 900px: the reviewer's own suggested filler, a map of the
   geocoded results, is a Marketplace feature and brief §16 forbids implementing
   Marketplace here. Every other candidate would be invented content. **This is
   the single decision most worth your opinion** — the composition fills the
   viewport at roughly six results, so the question is whether a two-row database
   is allowed to look like a two-row database.
2. **The row has no portfolio slot.** The reviewer read brief §8/§10's
   "architected for rich real content" as requiring one. There is no portfolio or
   media table anywhere in the schema (D-2), so any slot would be an empty frame
   that never fills — which is precisely the defect §8 was written to kill. What
   the row *is* architected for is imagery upgrading the identity frame in place,
   at 96px on desktop, the day `avatar_url` stops being null. A portfolio strip
   should follow the backend that would feed it, not precede it.
3. **Every barber is the same grey circle.** True, and it is the honest state of
   a product with zero photographs. It resolves itself entirely when
   professionals upload avatars; nothing in the layout changes when they do.
4. **The preview still writes `fadeup-country-explicit`**, the key the canonical
   product reads. The reviewer is right that recoverable is not the same as
   isolated. Namespacing it means re-plumbing shared preference infrastructure
   inside a visual-revision lot, which is a worse trade than the exposure —
   recorded here rather than done quietly, and worth its own small lot.
5. **The same business appears in both groups** — "Barber Test" under Barbers and
   its employer "Side Agency" under Barbershops are one establishment. Unavoidable
   with entity grouping on a two-row database, and not fabrication, but it halves
   apparent discovery value at this data volume.

Also recorded out of scope, per the reviewer: the legacy barber profile emits two
405s on `rpc/get_public_service_state` — the first tap out of Home lands on the
rejected R5 visual language, which is expected until R5R.1D.

---

## 8. The gate

Technical verification passing is not design approval.

**R5R.1B not started. R6 not started.**

**READY FOR SECOND HUMAN VISUAL REVIEW**, with §7.1 flagged as an open design
question rather than a solved one.
