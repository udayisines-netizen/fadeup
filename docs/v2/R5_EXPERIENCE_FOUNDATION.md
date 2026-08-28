# R5 — Design System & Experience Foundation

Status: **Complete (2026-08-28).** Web only — see §1.

R5 is not a feature lot. It establishes the visual and interaction language
later lots inherit, and it is measured by whether a future feature can be built
without reinventing a card, a sheet, a badge or a focus ring.

---

## 1. The one place R5 departs from its brief

**There is no mobile application in this repository.** `apps/` contains `web`
and `prospect-worker-v2`; there is no Expo project, no `app.json`, and no React
Native anywhere. §5, §7 and §33 of the brief describe work across web and
native, and "mobile typecheck" in §44 has no target.

R5 is therefore **web-only**, and the token layer is structured so a future
native app inherits semantics rather than CSS: the roles (`--text-title`,
`--fu-control-md`, `--fu-duration-quick`, the z-index ladder) are named for
what they mean, not for how CSS expresses them.

Two other things in the brief could not be built, both for the same reason —
the data does not exist:

| Asked for | Why not |
| --- | --- |
| Ratings / reviews anywhere | No reviews table exists in this schema. A star on a marketplace card is the most consequential thing this product could fabricate. |
| "Available soonest" sort | Availability is a function of (location, professional, **service**, date). The search query has no notion of a service, so it cannot answer the question at all. |
| Unclaimed external profile page | `get_public_external_professional` returns zero rows for **every** input until R10 removes the publication CHECK. A page reachable by nothing is speculative work; the *restraint* §16 asks for is already structural — an unclaimed placement has no `professional_id`, so it gets no badge, no follower count and no Follow control. |

---

## 2. Audit findings

The codebase was substantially more mature than the brief assumed. A "Frontend
V2" rebuild (`docs/frontend-v2/migration-map.md`) had already shipped: a
semantic token system with light/dark and two scoped re-themes, a three-duration
motion system, direction-as-a-number for RTL, ten locales behind seven
enforcement gates, and a Linear-style Pro shell with a command menu.

What R5 found wrong:

### 2.1 Sixty-nine dead colour utilities

`text-ink-400` (×40), `text-ink-600` (×11), `border-accent-300` (×7),
`ring-accent-400`, `bg-accent-50`, `bg-warning-50`, `border-ink-200`,
`border-warning-200` — across 32 files. None of those steps exist in `@theme`.

Tailwind v4 decides which utilities to emit from the values inside `@theme`, so
a class naming an undefined step generates **no rule**. The attribute survives
in the DOM looking deliberate and the element inherits its parent's colour.

Two were product-visible:

* `FavoriteButton` asked for `text-ink-400` on an unfavourited heart and
  rendered at full `ink-950` body weight — "saved" and "not saved" carried the
  same visual weight on every marketplace card.
* The booking progress bar asked for `bg-accent-400` on the **current** step,
  so the step you were on was the one step with no colour.

Every call site was remapped to the nearest defined step rather than widening
the palette. `design/tokens.test.ts` parses the ramps out of `index.css` and
fails on any undefined step, and separately asserts every light-mode colour has
a dark-mode value.

### 2.2 Country override did not persist

Language had persisted an explicit choice since Lot E. Country had not: GeoIP
was cached 24h and the only override was a `?country=` parameter that died with
the tab.

### 2.3 Four weak focus indicators

The marketplace search panel, the marketing hero search and the Pro command bar
stripped `outline-none` from their inputs and indicated focus with a 1px border
tint or nothing — on the most-used control in the consumer product.

### 2.4 `ui/tooltip` had no provider anywhere

The primitive was documented as "kept but currently unused". A Radix tooltip
without a `TooltipProvider` does not degrade, it **throws** — found by rendering
the new verified badge on a real page.

---

## 3. Token architecture

Colour, radius, shadow, font and motion tokens were already right and were not
churned. R5 added the four scales that were being decided per call site:

| Scale | Why it exists |
| --- | --- |
| **Typography roles** — `display / title / heading / body / caption / label / kpi` | `text-lg` says how big; `text-title` says what it **is**, and two screens using it stay in agreement when the value changes. `--text-kpi` earns its place alone: a dashboard number must be tabular, tight and optically larger than its label, and every KPI independently choosing its size is how a dashboard starts looking assembled. |
| **Z-index ladder** — base → raised → sticky → header → tabbar → overlay → sheet → toast | Ordered by what must cover what. Used through `z-[--fu-z-sheet]` so the intent is legible in markup and inserting a layer is one line. |
| **Control heights** — `sm 36 / md 44 / lg 56 / xl 64` | `md` is the WCAG 2.2 target minimum. `sm` is deliberately below it, for dense pointer-only admin rows — naming it is what makes "where are we under 44px?" a grep. |
| **Icon sizes, safe-area insets** | The `max()` fallback is resolved once; a bare `env()` collapses the padding on every desktop browser. |

**Colour roles were not duplicated.** The brief lists `background / surface /
text primary / border / accent / …`; the existing `ink` / `paper` / `border` /
`accent` ramps already are that layer under different names. Adding aliases
would have doubled the palette for a rename.

Dark mode was already intentional and is now **enforced** — the token gate
fails if any light-mode colour has no dark-mode value, which is the most common
way a dark theme grows an unreadable patch.

---

## 4. Navigation

`Discover · Search · BOOK · Appointments · Profile`

V2 shipped four tabs and deliberately no central action, on the reasoning that
a customer books every few weeks. That measures frequency, and frequency is the
wrong axis: booking is not one of the things FadeUp does, it is the thing
FadeUp is for.

**BOOK is an action, not a destination.** §34 requires it to operate against a
valid context, so with none selected it opens a sheet built from facts the
account already holds — the shop, professional and service of the last
**completed** cut, deep-linked so the wizard skips all three questions; then
saved shops; then Search, always present and the only option on a new account.
Nothing in it is ranked: a ranking model belongs to a backend lot, and
inventing one in a bottom sheet would make the sheet the thing that decides
where people get their hair cut.

**The prominent tab stays in flow.** Its icon is lifted with a negative margin
rather than being absolutely positioned — an absolute icon over a flow label is
how a tab bar's label creeps in German and collides in Arabic.

**Discover and Search split again.** V2 merged them for a good reason (Discover
had been a card containing a button to Search). The merge fixed that dead end
and left one screen doing two jobs with two rhythms. Discover now leads with a
context row, saved places, and what is near you; "Near you" is proximity and is
labelled as proximity.

**Fade Passport left the tab bar** for Profile (§18). Its route did not move, so
every existing link and share keeps working.

---

## 5. Marketplace

A shop card **opens** rather than navigating. Tapping expands the row in place
into that shop's real public team, filtered to the location the card is about —
a shop with three branches cannot offer a barber from across town under an
address that says otherwise. Choosing one opens booking over the same context.

* The expansion animates `grid-template-rows` `0fr → 1fr`, not a measured
  height. Measuring means a layout read on every open and a wrong answer the
  moment content reflows.
* The team query does not fire until a card is expanded. Twenty results eagerly
  loading twenty teams is invisible in a screenshot.
* One card open at a time — expansion state is a single id, so two open cards
  are impossible rather than discouraged.

**No "from HH:MM" on a collapsed card.** Availability needs a service, so any
time printed before one is chosen would be true of one service and silently
presented as true of all. `AvailabilityLabel` has a fourth state, `unknown`,
which renders nothing, and the booking sheet shows the time the moment it
becomes a true statement.

**Booking after barber selection is service → slot → confirm** (criterion J),
inside a sheet, with the claim token still stored so an anonymous booking made
from the marketplace can still be attached to an account later.

`/s/:slug` remains and is still right for someone arriving at a shop's own page:
it asks for a location, offers every professional, explains service modes and
handles walk-in queues. What it cannot be is fast, because it does not yet know
who you want.

---

## 6. Profiles

The barber profile was conversion-first. It now answers "who is this, and do
other people go to them?" before "how much" — identity, follower count, Follow,
then Book.

**Book is not in the header actions**, and that is the point: an unconditional
Book offers a reservation to a walk-in-only barber. `ServiceModeCtas` renders
it immediately below, from server truth, so §13's reading order holds without
the page promising something the shop has not offered. The second Book sticks
to the bottom and carries the **short** label — two links both named "Book with
Sam Barber" is worse for a screen reader than for anyone else.

The follower count is real (`get_public_professional`, computed from the
canonical edges, capped in-function) and is shown only above zero.

**The shop profile shares the header component and not the treatment**: a
person gets a circular avatar, a place gets a rounded square and an inverted
band. A shop carries **no** verified badge — §17's badge means "this identity is
claimed and controlled by the person it names", and FadeUp verifies people, not
premises, so the badge appears on the shop's *team* instead.

Follow Shop (`organization_follows`) and Favourite (`customer_favorites`) sit
side by side, which is what makes their difference legible rather than merely
true.

### The verified badge

Anchored on `professionals.claim_state = 'claimed'` — the one fact the database
can assert. The tooltip says in words that this is about identity and not
quality. The geometry is drawn here rather than imported: twelve lobes on a
shallower scallop than the mark everyone recognises, because the
recognisability is the point and the asset is somebody else's trademark.

---

## 7. Fade Passport

An object, not a form. The customer's own name, the FadeUp mark, and the
preferences they actually filled in. No tier, no points, no "member since" —
none exist, and a card is exactly the surface where an invented status reads as
a promise.

**The "Create your Fade Passport" empty state is gone** (§18). Every customer
already has one, and a button offering to create the thing you already have
manufactures an action out of a state. The read view is the card rather than a
panel repeating six fields with "Not set" beside the empty ones — that panel
turned an identity artefact back into a half-finished form.

---

## 8. FadeUp Pro

Six modules over one grid, ordered by whatever the **shop** saved.

§23's categories all have real sources. Revenue is booked value and is still
not called revenue: there are no payments in this schema, so the sum of today's
agreed prices is not what was taken. Social performance reads
`get_organization_analytics_summary` — an R3 contract shipped last lot with no
consumer. No event was added and no taxonomy widened (§39).

**Rearranging is a mode.** Permanently draggable cards turn every attempt to
scroll past one on a phone into a potential drag (the accidental reorder §24
forbids) and put a drag surface over the buttons people are reaching for.
Turning the mode on also gives the save a natural moment — one write on exit,
not one per nudge.

**The keyboard path is the only path.** Each card has Move up / Move down
buttons named for *that* card, and the pointer drag calls the same function. An
"accessible alternative" implemented separately is the one that drifts. Card
contents go `inert` while rearranging: a dashboard where you can accidentally
complete an appointment while picking a card up is worse than one you cannot
rearrange.

Social performance draws a **conversion bar, not a sparkline**. The summary
returns totals for one window, not a daily series, so a trend line would have to
invent its own shape. Two colours, value written beside the bar.

"Nothing counted yet" and "zero" are different cards — R3 backfills nothing, so
a shop that joined last week has a genuinely empty window, and a row of zeroes
would read as "your profile is not working".

---

## 9. Migrations

### `20260828120000_marketplace_map_and_sort.sql`

`search_public_professionals` gains `latitude`, `longitude` and `timezone` in
its projection, and a trailing `p_sort` parameter.

* The function already *accepted* a latitude and longitude and computed
  `distance_km` from them, and returned neither — a map had nothing to plot.
  `timezone` was carried internally (open-now and the queue window both depend
  on it) and dropped at the final SELECT.
* Exposing coordinates discloses nothing new: these are active locations of
  `marketplace_visible` organizations whose street address, city and postcode
  the same rows already carried. No WHERE clause moved, and **R5.9 proves it**
  by flipping `marketplace_visible` off and asserting the shop disappears.
* Sorting had to be server-side because the function is paged: "cheapest first"
  over a distance-ordered page is the cheapest of the nearest.
* `recommended` is the unchanged pre-R5 ordering and the fallback for anything
  unrecognised, so a stale client gets results rather than an error.

### `20260828120100_organization_dashboard_layout.sql`

One layout per shop, primary key `organization_id` **alone** — a per-member
layout cannot exist by accident. Read by any member, written by owner/manager
via RLS. `organization_id` is not UPDATE-grantable, so a layout cannot cross a
tenant boundary.

Module keys are validated for **shape**, not against a vocabulary: an enum
would make every new dashboard card a migration, which guarantees drift the
first time somebody ships a card without one. `reconcileLayout` is the client
half — it drops keys this build no longer has and appends modules added since.

Two things the disposable run found that reading the DDL would not:

1. A CHECK constraint may not contain a subquery, so the shape rule is an
   IMMUTABLE predicate function.
2. **A CHECK that calls a function is evaluated as the WRITING role.** Revoking
   that function from `authenticated` — the house style for everything in
   `private` — makes every real INSERT fail with "permission denied for
   function". It is granted, with the reasoning recorded at the grant. This is
   the one place in FadeUp where a `private.` function is granted to
   `authenticated`.

---

## 10. Validation

| Suite | Result |
| --- | --- |
| Web unit/component (`npm test`) | **83 files, 793 tests, all passing** (baseline before R5: 73 / 722) |
| Web typecheck (`tsc -b --noEmit`) | Clean |
| Web production build | Succeeds; maplibre lands in its own 952kB lazy chunk, absent from the initial bundle |
| Web lint (`oxlint`) | Warnings only, all pre-existing `only-export-components` |
| `VERIFY_R5_EXPERIENCE_FOUNDATION` on a disposable DB | **19/19 assertions pass** over a full 112-migration replay |
| `VERIFY_CUSTOMER_API_FREEZE` (closed-lot regression) | Passes |
| Worker V2 (`apps/prospect-worker-v2`) | **17 files, 352 tests, all passing** — untouched by R5 |

Authorization assertions run as **real roles through RLS** and perform the
operation rather than asserting a policy exists — R1B §8.16 was a policy that
existed and could never match a row.

---

## 11. Acceptance criteria

| | Criterion | Status |
| --- | --- | --- |
| A | Semantic design-token system | ✅ extended + gated |
| B | Light and dark mode | ✅ dark completeness now enforced by test |
| C | Web/mobile share the design language | ⚠️ **web only** — no mobile app exists (§1) |
| D | Discover / Search / BOOK / Appointments / Profile | ✅ |
| E | Fade Passport inside Profile | ✅ route unchanged |
| F | BOOK dominant and central | ✅ |
| G | List/map marketplace foundations | ✅ map lazy-loaded, list is the default and the accessible alternative |
| H | Cards expand into barber availability | ✅ expand into the team; availability appears once a service makes it true |
| I | "À partir de 17:30" semantics | ✅ `AvailabilityLabel`, locale- and timezone-aware |
| J | service → slot → confirm in ≤3 interactions | ✅ |
| K | No unnecessary page navigation | ✅ booking happens in a sheet over the results |
| L | Barber profile social-first, converts | ✅ |
| M | Shop profile related but distinct | ✅ |
| N | Follow and Favourite separate | ✅ separate tables, side by side |
| O | Unclaimed profiles restrained and marked | ⚠️ restraint is structural; the *page* awaits R10 (§1) |
| P | FadeUp green verified badge | ✅ own geometry |
| Q | Motion visible but elegant | ✅ existing 3-duration system reused |
| R | Realtime updates visibly communicate change | ✅ `RealtimeValue` on the KPI strip |
| S | Pro uses a Linear/Stripe-like shell | ✅ pre-existing, retained |
| T | Revenue / Appointments / Queue / Customers / Social | ✅ all on real data |
| U | Dashboard layout rearrangeable | ✅ drag + keyboard |
| V | Layout persists at SHOP level | ✅ PK is `organization_id` alone |
| W | Unauthorized staff cannot mutate it | ✅ RLS; VERIFY R5.14/R5.15 |
| X | Creator-analytics character | ✅ conversion bar, two colours |
| Y | WCAG AA target | ✅ tested, not documented; four real focus weaknesses fixed |
| Z | Reduced motion works | ✅ every transition gated |
| AA | i18n does not regress | ✅ 7 gates green, 10 locales complete |
| AB | RTL does not regress | ✅ logical properties + `--fu-dir` gates green |
| AC | Locale/country override persists | ✅ country now persists too |
| AD | Responsive across target widths | ✅ list/grid/sheet breakpoints; **not** verified in a real browser (§12) |
| AE | loading / empty / error / realtime states | ✅ |
| AF | No production fake business data | ✅ |
| AG | Relevant tests pass | ✅ 793 |
| AH | Closed-lot regressions pass | ✅ Worker 352, Customer API freeze VERIFY |
| AI | No R6 functionality started | ✅ no handle route, no messaging, no social graph concepts |

---

## 12. Limitations and deferred work

1. **No visual-regression coverage.** Playwright is installed and unconfigured
   (a pre-existing finding in `ROADMAP.md`). §37 asks for screenshot tests over
   eight surfaces; standing up that infrastructure is a lot of its own, and the
   brief says explicitly not to add one without auditing the current tooling.
   Responsive behaviour is expressed in the markup and asserted in unit tests,
   but **no rendering at 375/768/1440 has been observed**.
2. **No mobile application** (§1).
3. **Ratings, "available soonest" sort, and the unclaimed profile page** are
   blocked on data or on R10 (§1).
4. **`get_organization_retention_cohort` and `get_professional_analytics_summary`**
   remain unread. R5 wired the one contract the dashboard needed.
5. **The follower rail on Discover is absent** because
   `list_my_followed_professionals` returns no organization slug and no handle
   route exists. R6/R7 owns that route; every row would currently be an avatar
   that goes nowhere.

---

## 13. Analytics

No new event contracts. The marketplace booking flow reuses `booking_started`,
`booking_service_selected`, `booking_barber_selected` and
`booking_slot_selected`; discovery reuses `discovery_viewed`,
`search_performed` and `search_result_viewed`. `booking_started` is fired when
the sheet opens rather than when a card is expanded — expanding a card to look
at a team is not a booking, and counting it as one would inflate every funnel
above it.

One gap is recorded rather than filled: **there is no event for switching to
the map**, and no existing contract fits. Adding one is a taxonomy decision and
§39 says not to make it here.
