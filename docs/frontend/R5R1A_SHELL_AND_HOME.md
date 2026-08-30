# R5R.1A — Customer Shell + Home

**Status:** TECHNICALLY READY FOR HUMAN VISUAL REVIEW — not approved.
**Branch:** `rebuild/social-first-v2`
**Preview route:** `/_preview/r5r`
**Artefacts:** `docs/frontend/artifacts/r5r1a/`
**Code:** `apps/web/src/customer-v2/` (see its README for the architecture)

R5R.1A is the first implementation lot of the greenfield FadeUp frontend. It
builds a new customer shell with five destinations and a functional Home, from a
blank visual starting point, on the existing backend contracts. It changes no
database object, no RLS policy, no pricing, and nothing about the canonical
customer product at `/app/customer`.

---

## What Home actually does

```
⌖ France                     Use my location      ← real, or "Everywhere" when unknown

Find your next barber

⌕ Search barbers, shops or a service              ← queries p_query for real

[ Open now ]                                      ← toggles p_open_now_only for real

IN FRANCE                              2 results  ← the server's total_count
─────────────────────────────────────────────────
▨  Barber Test ✓
   Side Agency · Antony (92)
   Closed · from €25.00
   [ Book ]                                       ← /s/side-agency?barber=…&location=…
```

One query, one list. The search entry and the Open now facet both re-query
`search_public_professionals` server-side; neither filters a page in the
browser. Tapping a result opens the real shop or barber profile; tapping Book
opens the real anonymous booking entry with the professional preselected.

## The three decisions that define the direction

**Green means booking, and nothing else.** The Book control on a result is the
only filled green surface in the product. The Book *tab* is styled identically
to the other four destinations in both the mobile bar and the desktop header —
a navigation target wearing the conversion colour is how R5's shop profile ended
up rendering `Réserver` twice in one viewport.

**A null renders nothing.** `is_open_now`, `distance_km`,
`starting_price_cents` and the organization's currency are each independently
nullable. None falls back to a default: no "0 waiting", no em-dash, and never
"Closed" standing in for "we don't know". The operational line has no fixed
length and disappears entirely when nothing is known.

**A heading is a claim.** "Near you" is written only when the customer shared
coordinates and the results were genuinely ordered by a computed distance.
Otherwise the heading names the country actually filtering the query. There is
no "Popular" section, because nothing in this backend ranks anyone.

## Imagery, and the state the data is actually in

The database exposes one image column to discovery — `staff_profiles.avatar_url`
— and it is null for every current row. Every result is therefore built around a
media well that reserves its frame at a fixed ratio and, with no photograph,
draws a fade: hairlines tightening toward the top, the product's own name as a
graphic mark. It claims nothing, depicts nobody, and is visually distinct from
the skeleton, which sweeps.

**This is the single most important thing for the product owner to judge.** The
grey wells in the screenshots are the honest current state of FadeUp's media,
not a rendering fault — and making that visible is deliberate. R5's answer to
the same gap was two-letter monograms, which the audit called a BLOCKER for a
social-first product.

## Backend contracts consumed

| Contract | Use | Change |
|---|---|---|
| `search_public_professionals` (14-arg) | the entire discovery list, incl. `distance_km`, `is_open_now`, `queue_waiting_count`, `starting_price_cents`, `total_count` | none — consumed more fully than R5 did |
| `get_public_currencies` | per-organization currency, so a price is never assumed to be euros | none |
| `notifications` (via `useNotifications`) | the unread count on the header bell | none |
| `locale-detect` edge function (via `useGeoSuggestion`) | country resolution | none |

No migration was written. No RPC was altered. No new backend work was required
for anything on this page.

## What independent review changed

Three reviewers ran against this lot — code, design and QA. They were not
ceremonial: **twelve defects were found and fixed before this document was
final**, and two of them were things the code's own comments had certified as
correct. Recording them because the corrections are the load-bearing part.

All three independently confirmed what did NOT go wrong, which is worth as much:
no fabricated data anywhere (every rendered value traced back to the RPC and to
the live database), no infrastructure duplicated, no second Supabase client, no
data access outside `lib/`, no migration, no RLS change, and `/app/customer`,
`/search`, `/` and `/s/:slug` all behaving exactly as before.

| Found | Fix |
|---|---|
| **Typing in search moved the page 444px.** Every keystroke changed the query key, so the list unmounted, skeletons took its place at a different height, and it snapped back. Measured 341 → 185 → 629 → 341px on an 844px viewport. | `keepPreviousData` (opt-in, so no existing caller changes) — the list now narrows in place and dims via `.v2-refining`. Re-measured: **0px movement across a full typing burst**. |
| **`ink-mute` was 4.35:1, failing AA.** The contrast table computed it against `paper`, but the shell paints `ground` and result rows carry no background — so the comment certified a ratio the product was not rendering. | Token darkened to `#647269`; the table re-derived per surface. Re-measured in the live DOM: **zero text below 4.5:1 anywhere on the page**. |
| **A shop's Book dropped the location the customer had just chosen.** The RPC emits one row per location, so a multi-branch shop is several results — and the wizard then asked for the branch again. | `?location=` on both branches; locked by test. |
| **"Search everywhere" was a one-way door.** It writes `fadeup-country-explicit` permanently, and the *canonical* product reads that key — one tap in an unapproved preview changed the approved product's filter with no way back. | The location bar now carries the reverse control whenever the choice is in force. |
| **The desktop composition was a bordered-card grid.** Three columns with two filled, a section rule promising a column it could not fill, and a landscape crop of a portrait photo — the card idiom the R5 rejection was largely about, returning at a breakpoint. | One grammar at every width: rows, two columns, portrait crop everywhere, Book at the trailing edge. |
| **The fade texture did not scale.** Absolute line pitches inside relative bands: a grain at 92px became twenty-one ruled lines at 246px and read as a corrupted image. | Pitch expressed as a percentage of each band. |
| **The media well was not the 4:5 it claimed** (0.742, and varying per row) because it stretched to the text column. | `self-start`. Re-measured: **92×115 = 0.800 on every row**. |
| **`:focus-visible` set `border-radius`** in an unlayered rule, so a focused 14px search field would snap to 6px. | Removed; a modern outline already follows the element's corners. |
| **The type scale had no heading role**, so two pages had already invented two different heading scales — the exact R5 failure this file criticises. | Four heading/display roles added; both pages use them. |
| **Error and empty states were visually identical**, recovery was a quiet outline button, "Clear filters" appeared under a typed query, and the title was a `<p>`. | A failure tone with its own hue and a filled ink button; the action names what it undoes; the title is an `h3`. |
| A trailing hairline under the last row; the search clear button at 36px; the tab bar disappearing at 768px on an iPad in portrait; a `MediaWell` that never retried a changed `src`; three dead declarations. | All fixed. |
| **The QA harness itself was unreliable.** It buffered every result until the end, so one crashed browser target discarded thirteen good measurements and presented as "the last route times out". It waited on `networkidle`, which never settles against a warm Supabase connection. Its tab walk stopped at twelve presses — before the second result on desktop and the whole tab bar on mobile. And it called *any* overflow "clipped", which cost a real investigation to disprove on a headline that measured 640/640 and simply had tight leading. | Streams one line per combination; waits for the app to mount and for `document.fonts.ready`; walks the tab order until focus leaves the document (14/14 controls, every one ringed); and now reports clipping only when an ancestor actually clips. The tight leading it accidentally surfaced was real and was relaxed from 1.06 to 1.10. |

## Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 26 warnings (25 `react(only-export-components)` + 1 pre-existing `react-hooks(exhaustive-deps)` in `inline-booking-sheet.tsx`) — identical to the pre-lot baseline, **none in `customer-v2`** |
| `npm test` | **822 passed / 822, 86 files, exit 0** — baseline was 806/84. The lot adds 16 tests in 2 files; nothing skipped, nothing weakened. Verified independently by the QA reviewer on the settled tree. |
| `npm run build` | exit 0; the greenfield adds ~19 kB raw / ~7 kB gzip across three lazy chunks and pulls in no map bundle |

Browser QA at 390 / 430 / 1440 across all five routes, **captured from a
production build rather than the dev server** (see D-3 in
`R5R_DEFECTS_FOUND.md`): zero horizontal overflow, zero console errors, zero
console warnings, zero failed requests, zero 4xx/5xx, zero clipped text, zero
controls without an accessible name, exactly one `h1` per route, zero shadows in
the entire stylesheet. Every mobile touch target is ≥44px. The harness is
committed at `apps/web/e2e/r5r1a/` and both scripts honour `QA_BASE`, so the
numbers can be reproduced rather than trusted.

Motion measured in the browser: press feedback scales to 0.978 over 120ms and
releases on a 200ms spring; the navigation indicator travels between tabs;
results rise 6px on arrival with a 28ms stagger. Under `prefers-reduced-motion`
`transform` leaves the transition list entirely and both animations stop, while
colour feedback and every function remain.

Interaction paths exercised end to end against the real backend: search →
results, search → no match → clear, country → empty → search everywhere →
persists across reload, Open now facet → real server-side filter, whole-row tap
→ real shop profile, keyboard tab order with a visible ring on every control.

## Deliberately not built

Marketplace, the dedicated Search experience, barber and shop profiles, booking,
appointments, queue, customer profile, Fade Passport, activity, and anything in
the professional product. Four of the five destinations render a placeholder
naming the lot that will build them.

Home's search entry and its single Open now facet are Home affordances, not the
C4 Search experience: no filters, no sort control, no map, no natural-language
intent.

## Known issues and open questions

1. **The empty media wells are the honest data state, and they dominate a
   result.** Whether that is dignified or bleak is a taste decision only the
   product owner can make. It resolves itself entirely once professionals upload
   work; nothing in the layout changes when they do.
2. **Two listings is the whole marketplace.** Home was deliberately not padded
   to look fuller. The composition carries twelve results without alteration.
3. **The desktop header navigation is 36px tall**, below the 44px touch floor
   but above WCAG 2.2 AA's 24px, and pointer-only — `index.css` sanctions 36px
   for exactly that context. Every mobile control is ≥44px.
4. **No customer dark theme.** The greenfield pins `color-scheme: light`, per
   DESIGN_SYSTEM.md's light-first direction. R5's dark palette put the primary
   button at 2.15:1, so inheriting it was not an option; a real customer dark
   theme needs its own contrast budget and its own lot.
5. **Location resolves to a country, never a neighbourhood.** The blueprint's
   "Paris 8e" needs a reverse geocoder FadeUp does not have.
6. **A shop can never show a photograph.** The RPC nulls `barber_avatar_url` on
   every shop row and `organizations` has no image column at all, so the
   media-led composition is reachable for barbers only until the backend gains
   organization or portfolio media. Recorded as D-2.
7. **The notification bell leads to the Profile placeholder**, because Activity
   is R5R.1H. The badge itself is real and gated on real unread rows; the
   destination is not built yet.
8. Four defects found during this lot but outside its scope are recorded in
   `docs/frontend/R5R_DEFECTS_FOUND.md` — a product-wide i18next plural bug that
   renders raw keys in Arabic and Russian, the shop-imagery gap above, a
   dev-server-only blank-mount race that does not survive a production build,
   and a stale local Supabase key.

## The gate

Technical verification passing is not design approval. The product owner must
inspect `docs/frontend/artifacts/r5r1a/` and decide whether this is the FadeUp
direction before any later frontend lot builds on it.

**R5R.1B not started. R6 not started.**
