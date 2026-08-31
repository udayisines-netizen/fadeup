# R5R Fresha-Derived Redesign Plan

Date: 2026-08-31 · Status: **DESIGN PLAN ONLY — no implementation, no DB/RLS/contract changes, no R6**

The formula this plan executes:

- **Fresha** — marketplace density, venue IA, services, booking, calendar, CRM, reporting
- **Instagram** — barber identity, Follow, portfolio, social proof
- **Apple** — motion, confirmation, Queue, Fade Passport, interaction quality
- **FadeUp** — independent/mobile supply, realtime queue, QR+geofence, social graph, multi-location cockpit

No Fresha brand, artwork or pixels are cloned. Patterns only.

---

## 0. Ground truth — what the contracts can feed TODAY vs. what is a gap

Every composition below only names data with a verified source. This table is
the boundary between "design now" and "design the slot, ship truthful absence".

**Available now, zero backend change:**

| Datum | Source |
| --- | --- |
| Result coordinates (map pins) | `search_public_professionals` → `latitude`/`longitude` (verified in `marketplace.ts`) |
| Distance | `distanceKm` (same RPC, when precise location on) |
| Open now | `isOpenNow` (server-computed, same RPC) |
| From-price | `startingPriceCents` (same RPC) |
| Live queue count per result | `queueWaitingCount` (same RPC) + `usePublicQueueStatus` on profiles |
| Supply type Independent/Barbershop | `marketplaceSupplyType` |
| Barber avatar, title | same RPC + `get_public_barber` |
| Follower count, handle, headline (claimed pros) | `get_public_professional` |
| Org follow count | organization-follows contract |
| Services with price + duration (profile/booking) | `usePublicServices` |
| Real slots per barber/service/date | `get_public_available_slots` |
| Customer's next upcoming appointment | `useMyAppointments` |
| Pro: today's appointments incl. current service price | `get_calendar_appointments` (`price_cents` = services join) |
| Pro: live queue entries, org analytics summary, per-day series | existing R3/queue/calendar contracts |
| Pro: opening hours (org-scoped) | `location_hours` (authenticated) |

**Backend gaps — the design reserves the slot; the UI ships truthful absence
until a contract exists. These are named requests for the product owner, not
work in this phase:**

| Missing datum | Blocks | Contract needed |
| --- | --- | --- |
| Venue photos / work media (no media tables exist; only 3 `avatar_url` columns) | Gallery, image-led cards, portfolio, portfolio-as-commerce, reels | `venue_media` + `work_items(service_id, barber_id, media, like_count)` |
| Ratings + review counts (no reviews table) | ★ 4.9 (328) everywhere | Reviews domain |
| 2–3 top services per marketplace card | Card service rows | Additive `p_include_top_services` on the search RPC (or accept From-price only) |
| Next real availability on cards/profiles | "Next today 18:30" | `get_next_available(org, location)` |
| Public opening hours (`location_hours` SELECT is authenticated-only) | Hours section on public venue page | Anon-safe `get_public_location_hours` |
| Charged amount on appointments | CRM total spend, historical revenue | `appointments.charged_*` columns |
| Wait-minute estimates | "~18 min" in Queue / pro queue | Deliberately none — FadeUp shows position and people ahead, never invented minutes |

Rule restated: **when a slot's datum is absent, the slot collapses. Nothing
renders a placeholder star, a grey fake photo, or an estimated minute.**

---

## 1. Global visual language (applies to every screen)

Current problem: v2 wraps *everything* — hero, list, form, gallery-to-be — in
the same `v2-plate` card at the same weight, and mobile screens carry wide
blank margins around thin content. Minimalism became missing information.

Direction (Fresha restraint, kept on FadeUp tokens):

- Canvas: near-white; **cards demoted** — hairline-separated rows on canvas
  become the default; plates reserved for genuinely bounded objects (a
  ticket, a pass, a map panel, a form).
- Photography carries weight wherever real media exists; icon-tile
  placeholders shrink to metadata size, never masquerading as imagery.
- Hairlines at ~6% ink; effectively no shadows (unchanged rule).
- One green accent, used for: primary Book, live/positive states, active nav.
  Never for decoration.
- Type scale: page 24–30 / section 18–22 / entity 16–18 semibold / body 15–16
  / metadata 13–14 / caption 12–13 / actions 15–16 semibold. Map onto the
  existing `v2-*` type tokens (adjust token values, not call sites).
- Spacing rhythm 4/8/12/16/20/24/32/40; kill 64–96px interior voids. List
  row vertical padding drops from ~14px to 10–12px; density up ~25%.
- Radii: moderate (8–12); no huge pills.
- Banned: gradients, black/gold barber cliché, neon, giant KPI cards, big
  hero headings inside the app, generic shadcn look.

Motion system (Apple for movement, Fresha for restraint):

- Press: scale 0.97, ~120ms (exists as `v2-press`; keep).
- Result → profile: shared spatial continuity — image/avatar position morph
  via View Transitions API where supported, plain fade fallback.
- Portfolio → media: source expansion from the tapped tile.
- Booking: current progressive in-place transform kept, with a 160ms
  height/opacity settle between steps.
- Queue: position number does a single vertical roll on change (exists via
  `v2-enter`; refine to a counter-roll).
- Bottom nav: small icon nudge on activation only.
- Nothing else animates.

---

## 2. Screen-by-screen

### 2.1 Home

**CURRENT PROBLEM.** One "Near you" list of sparse rows; search works but the
page reads as a functional prototype — no imagery weight, no availability or
queue context on rows, generous dead space.

**FRESHA PATTERN.** Marketplace-home density: search up top, then rich
image-led venue cards that already answer "can I go, when, for how much".

**FADEUP ADAPTATION.** Keep the single honest "Near you" supply list (no
fake categories, no invented rails). Rows upgrade to the marketplace result
card (2.2). Follow context stays because FadeUp is social-first.

**EXACT NEW COMPOSITION.**
```
[search field]
[Open now] [Nearest]                ← existing real facets as compact chips
NEAR YOU (n)
[result card] × n                   ← card spec in 2.2
```

**MOBILE.** Cards edge-to-edge minus 16px gutters; image block (when media
contract lands) 4:3 leading the card; until then the avatar/icon stays small
and the card leads with the text hierarchy — no giant blank image frame.

**DESKTOP.** Two-column card grid inside the 75rem measure (Home does not get
the map; that is Marketplace's job).

**DATA REQUIRED.** All available now except card media + per-card services +
next availability (gaps table).

**MOTION.** Card press 0.97; card → profile spatial continuity.

**WHAT MUST NOT CHANGE.** Supply = Independent + Barbershop only; staff
barbers never listed; no fabricated ratings/photos/availability; search stays
a real input narrowing the same list.

---

### 2.2 Marketplace

**CURRENT PROBLEM.** Verified in browser: desktop centers a ~640px mobile
list in 1440px with the right half of the viewport empty; the single card
shows name/type/city/open/from-price only, with a big empty icon tile; two
sort chips and one facet is the whole control surface.

**FRESHA PATTERN.** search header → compact filter bar → LIST + MAP split;
dense scannable cards; restrained filters; obvious Book.

**FADEUP ADAPTATION.** Real pins only — `latitude/longitude` already come
back on every result, so the map is buildable **today** with zero backend
change. Queue context (`queueWaitingCount`) is a FadeUp-only card fact Fresha
cannot show.

**EXACT NEW COMPOSITION (card, every line real-data-gated).**
```
[VENUE IMAGE — only when media contract lands; avatar thumb for independents]
Side Agency
★ 4.9 (328)                         ← slot reserved; absent until reviews exist
Barbershop · Antony · 1.7 km        ← supplyType · city · distanceKm
Skin Fade      €25 · 30 min   ┐
Cut + Beard    €35 · 45 min   ├ only via p_include_top_services; until then:
Beard Trim     €15 · 20 min   ┘     "From €25"
Open now · 3 waiting                ← isOpenNow · queueWaitingCount (>0 only)
Next today 18:30                    ← only when a next-available contract exists
                            [Book]
```

**MOBILE.** Single column of the cards above; filter bar as one horizontally
scrollable chip row: `Open now · Distance · Price · Sort · More` — each a
compact sheet, one-tap clear, never more than ~5 visible controls.

**DESKTOP.**
```
[header: search + filter chips]
┌───────────────────────────┬─────────────────────┐
│ result list (~55%,        │ MAP (~45%, sticky)   │
│ independently scrollable) │ real pins, count     │
│                           │ pin ↔ card highlight │
└───────────────────────────┴─────────────────────┘
```
Map only renders when ≥1 result carries coordinates; otherwise the list takes
the full measure. Map chrome: zoom + locate, nothing else. Pin = dot +
from-price label.

**DATA REQUIRED.** Now: coordinates, distance, open state, queue count,
from-price, supply type, avatars. Gaps: card media, top-services, rating,
next availability. Map tiles: needs a tile source decision (self-hosted or
licensed) — flagged as an infra decision, not invented here.

**MOTION.** Hovering a card raises its pin (color, not size); card →
profile continuity; filter sheets slide 160ms.

**WHAT MUST NOT CHANGE.** `marketplace_supply_type` vocabulary; the
enum-leak test; totalCount honesty; keepPreviousData pagination; no fake
pins, no invented services, no remote queue join.

---

### 2.3 Barbershop profile

**CURRENT PROBLEM.** Verified in browser: identity, Team, Services stacked as
three identical generic cards; no open/closed state, no about, no hours, no
amenities, no location map, no reviews section; services have no visible Book
affordance; the "gallery" area is an empty tinted band.

**FRESHA PATTERN.** The venue IA is adopted nearly wholesale:

```
Back / Share
[VENUE GALLERY]
Name · ★ rating (count) · Open/Closed · Address
[Book]                                 ← sticky/reachable throughout
About
Services                                ← major content
Team
Work / portfolio
Reviews
Opening hours
Additional details / amenities
Location (map)
```

**FADEUP ADAPTATION.** Follow (org) sits beside Book with follower count;
live queue line ("3 waiting · join at the shop") in the header block —
Fresha has nothing like it. The multi-site switcher stays and never names
the internal group.

**EXACT NEW COMPOSITION.** As the IA above, with these truth gates: gallery
renders only with real venue media (until then the header is typographic —
no empty band); rating row absent; Reviews section absent; Opening hours
absent until the anon hours contract exists (named gap); About = the org's
real description field if present; Location = map pinned at the location's
real coordinates (available now); Work = real work items only (gap).

**MOBILE.** Gallery edge-to-edge swipeable; sticky bottom `Book · from €25`
bar appears after the header scrolls off; sections as hairline-separated
content, not boxed cards.

**DESKTOP.** Two-column: content left (~62%), sticky right rail with
Book/Follow card + hours + location mini-map. Gallery: one dominant image +
2×2 secondary grid when ≥5 real photos exist; fewer photos → simpler rows.

**DATA REQUIRED.** Now: name, address, services (name/price/duration),
team, queue count, follow count, coordinates. Gaps: media, reviews, public
hours, next availability.

**MOTION.** Gallery crossfade on step; sticky Book bar slides in once;
section anchors scroll smoothly from a compact in-page nav on desktop.

**WHAT MUST NOT CHANGE.** Site switcher semantics; team → barber profile
routing; no queue join affordance; `?location=` contract; not-found
indistinguishability for hidden orgs.

---

### 2.4 Barber profile

**CURRENT PROBLEM.** Reads as a smaller venue page: same plates, no visual
identity difference, portfolio is one honest-empty line, services identical
to the shop's list.

**FRESHA + INSTAGRAM PATTERN.** Professional profile header with Fresha's
conversion discipline, Instagram's identity grammar:

```
[circular avatar 96]   Jordan  ✓(claimed)     ← claim state, honest label
@jordan.cuts · headline
1 240 followers                              ← real count, claimed only
Working at Side Agency →
[Follow]  [Book]
─ Portfolio: 3-column media grid            ← real work items only
─ Services (rows with price · duration · Book)
─ Reviews                                    ← absent until contract
```

**FADEUP ADAPTATION.** Placement vs claimed-person split stays exactly as
built: unclaimed profiles show placement facts only — no Follow, no
follower count, no handle. The claim badge keeps its honest
"claimed identity" accessible name (the green-check *verification* idiom is
flagged to the designer; do not resolve it in code).

**EXACT NEW COMPOSITION.** As above; portfolio grid is 3-column square tiles
with a like count per tile **only when the work-items contract exists**;
until then the section renders its current honest empty state, restyled to
one quiet line, not a boxed card.

**MOBILE.** Avatar-led header; Book and Follow full-width pair; grid
edge-to-edge with 2px gutters; sticky bottom Book after scroll.

**DESKTOP.** Header row; grid max 3 columns at content width; services and
grid side by side (grid left, services right) so Book stays visible.

**DATA REQUIRED.** Now: avatar, name, title, handle/headline/follower count
(claimed), org link, services, queue count. Gaps: work media + likes,
reviews, rating.

**MOTION.** Tile → media source-expansion; Follow button state morph
(outline→tint) 150ms.

**WHAT MUST NOT CHANGE.** Unclaimed profiles never gain social affordances;
barber never appears as marketplace supply; Book carries
location+barber(+service) into the flow.

---

### 2.5 Booking

**CURRENT PROBLEM.** The step machine is right (and just gained availability
landing, prefill, conflict recovery, `?service=` seeding). What lags Fresha:
slots render as one flat wrap with no time-of-day grouping; the day rail is
plain text chips; selected-context summary rows are wordy; service rows
feeding in from profiles only just gained their Book affordance.

**FRESHA PATTERN.** Service-first selection; horizontal date rail; slots
grouped Morning / Afternoon / Evening; a few useful times first, "See more"
expansion; persistent compact context (shop · service · price · duration).

**FADEUP ADAPTATION.** Keep in-place progressive transformation (no screen
stack). Keep barber-first slot contract (RPC requires `p_barber_id`); the
shop flow order stays Service → Barber → Time (Fresha's Service → Time →
Staff needs an any-staff availability contract — named gap, not faked).

**EXACT NEW COMPOSITION.**
```
Book at Side Agency · 19 rue Danton
[Coupe · €25 · 30 min  ✎] [Jordan ✎]      ← compact context chips, not rows
Mon 7 | Tue 8 | Wed 9 | Thu 10 | …        ← date rail, month kept on chips
"First free times are on Tue 8"           ← existing honest auto-advance
Morning     09:00  09:30  10:30
Afternoon   14:00  15:30  17:00
[See more times]
─ details (prefilled when signed in) → Confirm €25
```
Grouping rule: bucket real slots by shop-local hour (<12 / 12–17 / ≥17);
a group renders only if it has slots. Confirm button carries the real price.

**MOBILE.** Single column; slot buttons 44px, 3–4 per row; sticky Confirm
once details are valid.

**DESKTOP.** Max ~34rem centered — a transactional flow, not a dashboard;
date rail and groups identical.

**DATA REQUIRED.** All available now. Gap: any-professional path.

**MOTION.** Step transform with 160ms settle; chosen slot pulses once;
context chip edit collapses the flow backward with the same transition.

**WHAT MUST NOT CHANGE.** Auto-skips, availability landing, prefill,
conflict recovery, claim-token flow, multi-location branch question, real
slots only, `MY_APPOINTMENTS_KEY` invalidation.

---

### 2.6 Appointments

**CURRENT PROBLEM.** Upcoming and past cards look identical in weight; the
retention loop (Book again) is a small button; density is fine but hierarchy
is flat.

**FRESHA PATTERN.** The next appointment is a distinct object; history is a
compact list with a strong rebook affordance.

**EXACT NEW COMPOSITION.**
```
NEXT
┌ Thu, Sep 4 · 10:30 ─ CONFIRMED ┐
│ Skin Fade · Jordan · Side Agency│
│ [Add to calendar] [Cancel]      │   ← two-tap cancel stays
└─────────────────────────────────┘
UPCOMING (rest, compact rows)
PAST
Aug 18 · Skin Fade · Jordan …                  [Book again]
```
Past rows gain prices **only if** a charged-amount contract lands; today
they stay price-free (unchanged truth rule).

**MOBILE/DESKTOP.** Same list, desktop capped at 40rem.

**DATA REQUIRED.** Now. Gap: charged amounts for past prices.

**MOTION.** Next-card stage chip crossfades on realtime change.

**WHAT MUST NOT CHANGE.** Stage-driven split; Book again carries
location+barber, never a stale service; queue banner; two-tap cancel with
error surface.

---

### 2.7 Queue

**CURRENT PROBLEM.** Honest but plain — the ticket is a card among cards.
This is the surface that must become a FadeUp signature.

**PATTERN.** Apple Live Activity / Wallet / boarding pass — *not* Fresha.

**EXACT NEW COMPOSITION.**
```
     ┌──────────────────────────┐
     │        #3               │  ← display-size position (64–80pt)
     │   2 people ahead        │
     │                          │
     │  Side Agency             │
     │  Jordan                  │
     │  ── ── ── (pass notch)   │
     │  Leave queue             │
     └──────────────────────────┘
```
Full-bleed ticket with a subtle pass silhouette (die-cut notches drawn with
borders, not shadows). **No "~18 min"** — there is no wait-minutes contract
and FadeUp does not invent minutes; position + people ahead only. Multiple
tickets stack like passes.

**MOBILE.** The ticket owns the viewport. **DESKTOP.** Centered at pass
width; the page otherwise empty on purpose (the one legitimate whitespace
case).

**DATA REQUIRED.** All available now (position, org, barber, realtime).

**MOTION.** Position number roll on realtime change; ticket breathes 2%
scale on promotion to #1; reduced-motion collapses to opacity.

**WHAT MUST NOT CHANGE.** Zero join affordances; QR+geofence rule; no wait
minutes; realtime invalidation path.

---

### 2.8 Customer Profile

**CURRENT PROBLEM.** Serviceable settings list; activity and following read
as undifferentiated rows; Passport entry is an ordinary row.

**PATTERN.** Fresha account clarity + one Wallet-grade object.

**EXACT NEW COMPOSITION.** Identity header (avatar, name, email) →
**Fade Passport entry as a miniature pass** (a thumbnail of the 2.9 design,
not a text row) → Following (avatars row, counts real) → Activity →
Settings (language, sign out).

**MOBILE/DESKTOP.** Single column, 36rem cap.

**DATA REQUIRED.** Now. (Privacy toggles remain absent — no contract.)

**MOTION.** Passport thumbnail → full pass shared-element expansion.

**WHAT MUST NOT CHANGE.** Language persistence order; notifications
markAllRead; no invented privacy controls.

---

### 2.9 Fade Passport

**CURRENT PROBLEM.** Rendered as a generic settings-style card with fields —
exactly what the brief forbids.

**PATTERN.** Apple Wallet pass.

**EXACT NEW COMPOSITION.**
```
┌─ FADE PASSPORT ────────────────┐
│  Malik B.                      │
│  Skin fade · #2 guard · low    │  ← the real passport fields as pass rows
│  ▦ QR (share)                  │  ← existing share-token flow
│  Updated Aug 18                │
└────────────────────────────────┘
[Edit details]   [Share]
```
Ink-on-paper pass in the v2 palette (no black/gold cliché); the edit form
opens as a separate sheet — the pass itself is never a form.

**DATA REQUIRED.** Now (passport fields, share RPC, QR lib).

**MOTION.** Flip or crossfade between pass and edit sheet; share QR scales
from the pass's QR slot.

**WHAT MUST NOT CHANGE.** Server-generated tokens, TTL clamp, share URL
shape, owner-only RLS.

---

### 2.10 Pro Dashboard

**CURRENT PROBLEM.** Three KPI plates + schedule + 30-day panel — closer to
a SaaS analytics homepage than an operator's morning. "What needs me NOW"
is one small cell.

**FRESHA PATTERN.** Operational hierarchy: today's headline numbers, then
NOW, then QUEUE, then NEXT — the day as a worklist.

**EXACT NEW COMPOSITION.**
```
Today — Monday 31 August                    [scope: All locations ▾]
€1,240 expected today* · 18 bookings · 6 waiting
NOW
10:30  Malik    Jordan   Skin Fade   €30    [Check in / Complete]
10:45  Yanis    Mike     Cut + Beard €40
QUEUE
#1 Kevin      #2 Thomas                     ← position only, no minutes
NEXT
11:30 …
30-DAY (compact strip, links to Analytics)
```
*"€1,240 expected today"* derives from today's appointment rows ×
`get_calendar_appointments.price_cents` (the current price list). For
**today** this is materially truthful (today's work is charged at today's
prices) but it is still a derivation, labeled "expected · today's price
list", and it needs **product-owner sign-off** before build; historical
revenue stays absent until a charged-amount contract exists.

**MOBILE.** Single column, NOW rows compact (52px). **DESKTOP.** NOW/QUEUE
left (~2/3), NEXT + 30-day right rail.

**DATA REQUIRED.** Now: appointments+prices (today), queue rows, statuses,
Complete/No-show mutations. Sign-off: expected-takings label. Gap: nothing
else.

**MOTION.** Check-in row completes with a 200ms settle; queue positions
re-order with a list transition.

**WHAT MUST NOT CHANGE.** Scope filtering on the row's own `locationId`;
server-verbatim 30-day numbers; no margin/forecast; RPC-based status
transitions.

---

### 2.11 Pro Calendar

**CURRENT PROBLEM.** Correct but airy: appointment blocks are roomy cards,
time rail is light, current-time indicator subtle, day-only view.

**FRESHA PATTERN.** This is the heaviest single influence: a dense
operational grid — professional columns, tight time rail, compact blocks
(name · service, two lines max), strong now-line, near-zero chrome.

**EXACT NEW COMPOSITION (desktop).**
```
[◀ Today ▶]  Mon 31 Aug          [location ▾][barber ▾]
      Jordan          Mike           Sarah
09 ─┼───────────────┼──────────────┼─────────
    │ Malik         │              │
    │ Skin Fade €30 │              │
10 ─┼───────────────┼─ Yanis ──────┼─────────
━━━━━━━━━ now 10:12 ━━━━━━━━━━━━━━━━━━━━━━━━
```
Block = 2 lines, 12/13px, status as a 3px inline-start edge in the status
color; blocks under 30min collapse to one line. Time rail hour-labeled with
15-min ticks. Drag-reschedule keeps the no-optimistic-move rule. Add an
optional barber filter (`filters.barberId` already exists in the hook).

**MOBILE.** Vertical timeline as today, but rows at 44–52px, day switcher as
the date rail from booking, Complete/No-show as compact controls.

**DATA REQUIRED.** All available now.

**MOTION.** Drop settles 150ms after server confirm (existing rule);
now-line does not animate — it just is.

**WHAT MUST NOT CHANGE.** Timezone math via `lib/calendar/time`; server
confirm before visual move; RPC transitions; realtime refetch.

---

### 2.12 CRM

**CURRENT PROBLEM.** Good list/detail bones; summary answers visits/last/
interval but not "when next", and the layout is three equal stat cells + a
timeline — under Fresha's at-a-glance bar.

**FRESHA PATTERN.** Client header answers Who / How often / How valuable /
When last / When next in one band; timeline below; zero CRUD feel.

**EXACT NEW COMPOSITION.**
```
Malik B.        +336… · malik@…
18 visits · every ~19 days · last Aug 18 · next Sep 4
[Fade Passport indicator when shared with the org — GAP, see below]
TIMELINE
Aug 18  Skin Fade   Jordan            ← price appears only with charged-amount contract
Jul 28  Cut + Beard Jordan
```
"Next Sep 4" = the customer's earliest upcoming non-cancelled appointment —
**real rows, available now** (`useCustomerAppointments` already returns
them). "€840 total spend" stays **absent** — pricing history at today's
prices misstates it; named gap. Passport-in-CRM requires a
customer-consented share contract — named gap; passports are never surfaced
to orgs without it.

**MOBILE/DESKTOP.** Current split layout kept; summary band replaces the
3-cell grid.

**DATA REQUIRED.** Now: all but spend and passport link.

**MOTION.** None beyond row press.

**WHAT MUST NOT CHANGE.** RLS-scoped reads; no spend/prices in history; the
derived-fact honesty (summary computed from the visible timeline).

---

### 2.13 Analytics

**CURRENT PROBLEM.** Server-verbatim and honest, but presented as KPI cell
grids; one fixed 30-day window; the chart is minimal; no location
comparison.

**FRESHA PATTERN.** Controls first (scope + date range), then dense report
tables/graphs; graphs matter; comparison across locations.

**EXACT NEW COMPOSITION.**
```
[scope ▾] [Last 30 days ▾: 7/30/90]        ← the summary RPC already takes from/to
Booking funnel   views → starts → made → completed   (rate)
[completed-per-day bar chart, taller, weekday axis]
Queue funnel · Audience (compact tables, delta column vs previous window)
Per-location: completed per day by location            ← real, via calendar rows
```
Location comparison uses `useCalendarRange` rows grouped by `locationId` —
real per-location series **today** (operational counts). Occupancy is
computable now (booked minutes ÷ open minutes from `location_hours`,
org-side readable) — include as P1 with the formula visible in a tooltip.
Revenue and retention cohorts stay gaps.

**MOBILE.** Sections stack; chart full-width. **DESKTOP.** Two-column report
grid; tables, not cards.

**DATA REQUIRED.** Now: windowed summary (from/to params exist), calendar
rows, hours. Gaps: revenue, margin (never), forecast (never).

**MOTION.** Range change crossfades the chart 150ms.

**WHAT MUST NOT CHANGE.** Server-verbatim ratios; whole-org labeling where
the summary has no location parameter; no forecast/margin; deltas only
against a window with activity.

---

### 2.14 Retention

**CURRENT PROBLEM.** Three stacked plates; win-back rows are plain; plans
list is form-adjacent; the surface undersells the operator value.

**FRESHA PATTERN.** Clients-at-risk as an actionable worklist; memberships
presented as products (name, price cadence, member count) rather than CRUD.

**EXACT NEW COMPOSITION.**
```
WORTH A CALL (n)
Karim  +336…   72 days · usually every ~24    [→ client]
MEMBERSHIP PLANS        [New plan]
Fresh Fade Club   €25/month · 12 active       [Edit] [Deactivate]
MEMBERS  (open enrollments, renews date, pause/resume/cancel)
```
Add the customer's own typical interval next to days-since (both already
computable from the same rows) so "72 days" carries meaning. Row links into
CRM detail. Still **no send button** — no campaign contract exists.

**DATA REQUIRED.** Now. Gaps: campaigns/promotions (whole domain), spend.

**MOTION.** None beyond presses.

**WHAT MUST NOT CHANGE.** 180-day lookback + upcoming-booking exclusion
logic; role gates mirroring RLS; one-open-per-customer error copy;
no SMS ever.

---

### 2.15 Profile editor / onboarding tail

**CURRENT PROBLEM.** Five stacked form plates of equal weight; the setup
checklist is correct but visually equal to the forms; public-listing state
is quiet.

**FRESHA PATTERN.** "Your public presence" as the hero — a live miniature of
the marketplace card/venue page the customer actually sees — with setup as a
progress checklist and the forms demoted beneath.

**EXACT NEW COMPOSITION.**
```
YOUR PUBLIC LISTING           [preview → /s/slug]
[miniature of the real marketplace card, rendered from the same data]
Visible in marketplace ●──   /s/side-agency
SETUP  ✓ 11 of 12 · [missing item + its one-tap fix] · [Publish]
BUSINESS · LOCATION · TEAM    (current editors, restyled to section forms)
```
The miniature is the *actual* card component fed by the org's own public
data — the operator sees exactly what customers see, which is the strongest
motivation to complete media/hours when those contracts land.

**DATA REQUIRED.** Now. Gaps inherit from the card (media, hours, rating).

**MOTION.** Publish success: checklist collapses into the "Published" state
with one 200ms settle.

**WHAT MUST NOT CHANGE.** Readiness as the server's verdict; publish through
`complete_onboarding` only; explicit (never silent) quick actions; RLS-
mirrored role gating; starter-service localization.

---

## 3. Book everywhere (conversion matrix)

Every surface offers a one-tap path into the flow with maximal context:

| From | CTA | Carries |
| --- | --- | --- |
| Marketplace card | Book | location |
| Venue page (header + sticky) | Book | location |
| Venue service row | Book | location + service |
| Team member | via barber profile | — |
| Barber profile (header + sticky) | Book | location + barber |
| Barber service row | Book | location + barber + service |
| Portfolio work item | **Book this cut** | location + barber + service (needs work-items contract) |
| Completed appointment | Book again | location + barber |
| Confirmation | Done / View booking | — |

Routes already support `?location&barber&service`; only the portfolio row
awaits its contract.

## 4. Named backend requests (for product-owner approval, NOT this phase)

1. `venue_media` + `work_items(service_id, barber_id, media_url, like_count)` — unlocks gallery, image-led cards, portfolio-as-commerce, reels.
2. Reviews/ratings domain — unlocks every ★ slot.
3. `p_include_top_services` on the search RPC — card service rows.
4. `get_next_available(org, location)` — "Next today 18:30".
5. Anon-safe `get_public_location_hours` — public hours section.
6. `appointments.charged_*` — CRM spend, real revenue history.
7. Any-professional availability — Fresha's Service → Time → Staff order.
8. Customer-consented passport-share-to-org — Passport inside CRM.

## 5. Ranking

**P0 — transformative**
1. Marketplace desktop LIST+MAP with real pins + dense result card (2.2) — the single largest gap to Fresha, buildable now.
2. Venue profile Fresha IA (2.3) — header state, sticky Book, services-as-commerce, location map.
3. Booking slot grouping + date rail + context chips (2.5).
4. Pro Dashboard operational reorder — NOW/QUEUE/NEXT worklist (2.10).
5. Pro Calendar density pass — compact blocks, columns, now-line (2.11).
6. Global density/type/card-demotion pass (§1) — it multiplies every other item.

**P1 — high impact**
7. Barber profile Instagram-ization within truth gates (2.4).
8. Queue boarding-pass treatment (2.7).
9. CRM summary band + "next visit" (2.12).
10. Analytics range control + per-location comparison + occupancy (2.13).
11. Home card upgrade (2.1) — largely falls out of 2.2.
12. Fade Passport as a Wallet pass (2.9).
13. Profile editor "your public listing" miniature (2.15).

**P2 — polish**
14. Appointments NEXT-card hierarchy (2.6).
15. Retention worklist framing (2.14).
16. Customer profile pass-thumbnail entry (2.8).
17. Motion refinements: shared-element continuity, portfolio expansion, queue number roll.
18. Confirmation micro-polish (already close to the Apple target).

Items blocked on backend requests (media, reviews, next-available, hours,
charged amounts) ship their compositions with the slots collapsed and light
up when contracts land — no placeholder fakery at any point.
