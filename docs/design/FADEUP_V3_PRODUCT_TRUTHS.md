# FadeUp V3 — Product Truths (Source-of-Truth Summary)

Date: 2026-08-31 · Compiled before any V3 implementation, from:
`GREENFIELD_RULES.md`, `PRODUCT_UI_BLUEPRINT.md`, `SCREEN_BLUEPRINTS.md`,
`GREENFIELD_ROADMAP.md`, `MOTION_SYSTEM.md`, `DESIGN_SYSTEM.md`,
`REFERENCE_PRODUCTS.md`, `R5R_FRESHA_REDESIGN_PLAN.md`, `R5R_FINAL_REPORT.md`,
`FRONTEND_SPEC.md`, `BOOKING_UX.md`, `PRODUCT_CONSTITUTION.md` (frozen, v1.1),
`customer-v2/README.md`, and the live implementation on
`rebuild/social-first-v2`.

These truths bind every V3 surface. V3 changes the visible interface only; no
truth below may be weakened for visual convenience.

---

## A. Immutable product rules

1. FadeUp is **the social network, marketplace and operating system for barber
   culture** — in that order. A barber is never "a staff row attached to a
   schedule"; professional identity is durable and independent of employment.
2. **Social-first discovery. Booking-first conversion.** Once booking intent
   exists, minimize screens, taps, choices, repeated information.
3. **Book is the dominant CTA everywhere. Follow is secondary.** No screen
   presents Follow with equal or greater prominence than Book.
4. **Follower ≠ Verified Client** — hard invariant, never derived from each
   other. A confirmed booking is never evidence a service was delivered.
5. **Explicit unfollow is permanent** (four follow states; a later booking never
   silently re-follows).
6. Relationship truth is not permission to publish: "Already cutting X"
   requires genuine + verified + explicitly approved publication.
7. Customers are **private by default**; public presence is opt-in and exposes
   only what was chosen.
8. **No SMS anywhere.** Channels: app, push, email, Passport/Wallet.
9. No messaging, DMs, stories, livestream, generic feeds, speculative social
   mechanics. Scope is frozen.
10. Frontend checks are never authorization: RLS/server-side rules are the
    authority; UI hiding is not security.

## B. Customer Marketplace eligibility

- Customer discovery contains **independently bookable supply** of exactly two
  kinds: **Independent** and **Barbershop**. There is no third kind.
- The label comes from the DB-derived `marketplace_supply_type`
  (`independent` | `barbershop` | NULL) on `search_public_professionals`.
  **No client recreates the mapping**; `marketplace-supply.test.ts` bans
  internal `business_type` vocabulary from customer code. NULL renders no label.
- **Staff barbers are never marketplace results** merely for having public
  profiles; they surface via Team, portfolio, follows, direct links, booking
  context.
- External/unclaimed prospects may appear where contracts support them, clearly
  identified, with zero fabricated operational capability.
- Never group discovery results by entity type — entity type is a row shape,
  not a customer taxonomy.

## C. Independent vs Barbershop semantics

- **Independent** = a professional operating as their own business (mobile, at
  home, at the customer's home, or from their own place). They are their own
  organization and reach the customer as their own listing.
- **Barbershop** = any independently bookable venue/location. `hair_salon`,
  `mixed_salon`, and each location of a `multi_location` org all present as
  ordinary Barbershops.

## D. Staff Barber Profile semantics

- A barber profile is a **social professional identity** (Instagram grammar),
  not a mini venue page.
- Claimed vs unclaimed (placement) split is strict: **unclaimed profiles show
  placement facts only — no Follow, no follower count, no handle**, no
  fabricated availability/queue/booking capability. Claim state ≠ subscription
  state (`claimed` never means `paid`).
- "Working at {establishment}" links to the shop; entering booking from a
  barber profile never re-asks the professional.
- Follower/customer-count visibility is barber-controlled.

## E. Booking flows

- **Barber flow:** Service → Time → Confirm (no professional step).
- **Shop flow today:** Service → **Barber** → Time → Confirm, because
  `get_public_available_slots` **requires `p_barber_id`** — an
  "any professional" path is a named backend gap; do not fake Fresha's
  Service → Time → Staff order.
- Progressive in-place transformation, not a stacked wizard. Preserve context:
  never re-ask professional/service/location already chosen. Routes carry
  `?location&barber&service`.
- Slots grouped Morning / Afternoon / Evening (shop-local time), date rail,
  honest auto-advance to the first day with slots, conflict recovery with real
  nearest alternatives, signed-in prefill, anonymous booking via the existing
  claim-token flow.
- Confirmation is Apple-calm: Booked, date/time, professional, shop, service,
  price, address; Add to Calendar / View booking / Done. No confetti.
- Book Again carries location + barber (never a stale service).
- Booking invalidates `MY_APPOINTMENTS_KEY`; a successful scheduled booking is
  confirmed immediately (no manual acceptance step may be reintroduced).

## F. Queue truth rules

- Public queue data is real: `queueWaitingCount` on results,
  `usePublicQueueStatus` on profiles; position + people ahead in the active
  queue, realtime via existing channels.
- **No wait-minute estimates ever** — deliberately no contract; FadeUp shows
  position and people ahead, never invented minutes.
- **Joining requires QR interaction AND proximity/geofence validation.** The
  customer queue UI ships **zero remote-join affordances**. Profiles may show
  the real estimate while explaining joining happens on location.
- Realtime updates animate locally (position roll), never re-animate the page.

## G. Fade Passport truth rules

- **Every registered customer owns exactly one Fade Passport, automatically**
  (idempotent creation, backfilled). It is not created by the user, not an
  upsell, no "Get Fade Passport" CTA.
- Customer-owned and portable; never contains shop-internal notes; a FadeUp
  Passport is not a device-wallet install (never conflated).
- Passport lives in Profile; share via server-generated token with
  server-clamped TTL; QR from the existing flow; owner-only RLS.
- Passport is never surfaced to orgs without a customer-consented share
  contract (gap — does not exist yet).

## H. Customer navigation

Exactly five destinations, in order: **Home, Marketplace, Book, Appointments,
Profile.** Mobile: fixed bottom navigation, safe-area aware, 44px+ targets, no
floating pill/frosted dock, no FAB. Desktop: horizontal app navigation (no
Pro-style sidebar for customers). Activity/notifications through notification
UI, not a tab. Fade Passport inside Profile.

## I. Professional hierarchy

- Cockpit scopes: **Organization → Location → Professional**, per permissions;
  aggregate across locations, drill down to location or professional.
- Role gates mirror RLS: plan management owner/manager; enrollment
  owner/manager/receptionist; profile editors owner/manager.
- Pro visual mode is operational software (density, clarity, speed) — no
  cinematic imagery behind calendar/CRM/analytics.
- Never simplify to one user = one shop, one org = one location, or one
  subscription = one barber.

## J. Multi-location behavior

- Customer UI **never** exposes: Group, Parent, Organization, Multi-location,
  "X locations". Each eligible location is an ordinary Barbershop titled with
  its own location name. The site switcher never names the internal group.
- The Organization → Location → Professional hierarchy is real and preserved in
  the database and Pro UI. `multi_location` remains a real org type internally.
- Multi-location deep-link branch choice exists in booking (kept).

## K. Localization / RTL requirements

- **10 locales** with enforced key parity; no hardcoded user-facing strings in
  v2/v3 code (test-enforced). Anonymous language override works in every shell.
- Automatic locale detection, explicit override, persistence (order matters —
  language persistence sequence is locked), country/location behavior,
  international formatting via `useMoney` / Intl.
- RTL is structural: logical properties, `<bdi>` isolation; the R5R final sweep
  passed 45/45 combinations under `ar` with `dir="rtl"`. V3 must not regress
  this. Map/list selection accents mirror; navigation mirrors without breaking
  semantic order.

## L. Data that currently EXISTS (zero backend change)

| Datum | Source |
| --- | --- |
| Result coordinates (map pins) | `search_public_professionals.latitude/longitude` |
| Distance | `distanceKm` (same RPC, when precise location on) |
| Open now | `isOpenNow` (server-computed; **null = unknown, renders nothing**) |
| From-price | `startingPriceCents` (nullable) |
| Live queue count | `queueWaitingCount` (>0 only) + `usePublicQueueStatus` |
| Supply type | `marketplaceSupplyType` |
| Avatar, title | same RPC + `get_public_barber` (avatars currently all null) |
| Handle/headline/follower count (claimed) | `get_public_professional` |
| Org follow count | organization-follows contract |
| Services (name/price/duration) | `usePublicServices` |
| Real slots per barber/service/date | `get_public_available_slots` (requires `p_barber_id`) |
| Customer's appointments | `useMyAppointments` / `useCustomerAppointments` |
| Pro today's appointments + current-price | `get_calendar_appointments` |
| Pro queue entries, analytics summary (windowed from/to), per-day series | R3/queue/calendar contracts |
| Opening hours (org-scoped, authenticated) | `location_hours` |
| Notifications, claim redemption, geo suggestion, currencies | existing hooks |
| Passport fields + share RPC + QR | passport contracts |
| Memberships | `membership_plans` / `customer_memberships` |

## M. Data that does NOT exist (named gaps — design the slot, collapse it)

1. **Venue photos / work media / portfolio** — no media tables; only 3
   `avatar_url` columns, all null today. Blocks galleries, image-led cards,
   portfolio grids, reels. Needs `venue_media` + `work_items`.
2. **Ratings / reviews** — no reviews domain. Every ★ slot stays absent.
3. **Top services on marketplace cards** — needs `p_include_top_services`;
   until then "From €25" only.
4. **Next real availability on cards/profiles** — needs `get_next_available`.
5. **Public opening hours** — `location_hours` SELECT is authenticated-only;
   needs anon-safe RPC.
6. **Charged amounts on appointments** — blocks CRM spend, historical revenue,
   past-appointment prices.
7. **Wait minutes** — deliberately never.
8. **Any-professional availability** — blocks Service → Time → Staff order.
9. **Campaigns/promotions delivery + tracking** — whole domain absent.
10. **Customer privacy toggles (OFF/FRIENDS/PUBLIC), org-follow names,
    "Already cutting X" data, social haircut content/likes** — contracts absent.
11. **Avatar/media upload** — no storage contract.
12. **Margin / forecast** — never (margin only with trustworthy cost data,
    which does not exist).

## N. Things the UI must NEVER fabricate

Slots · availability · queue position/length/wait time · minutes estimates ·
professional presence · opening state when unknown · distance · reviews ·
ratings · followers · clients · celebrities/friends · revenue · analytics ·
forecasts · portfolio content · photos (no grey fake frames, no placeholder
stars) · bookings · customer relationships · realtime state for
external/unclaimed profiles · platform counters ("10,000 happy barbers") ·
campaign metrics · AI understanding that the backend does not have.

Rule restated: **when a slot's datum is absent, the slot collapses.** Test
fixtures never masquerade as customer truth.

---

## Recorded conflicts (not silently resolved)

1. **Pricing.** `CLAUDE.md` and `FRONTEND_SPEC.md` state Independent €20;
   Barbershop €35/49/69 per establishment. The **frozen Product Constitution
   §6 (v1.1, amended by R2)** supersedes this with four families / eight plan
   keys (€0/19/29/49/79/99/149/249), forbids per-location and per-seat pricing,
   and makes Multi-salons prices group totals. Per GREENFIELD_RULES §6, V3
   **hardcodes no pricing** and renders whatever the backend catalog/
   entitlement contracts return; the doc conflict is flagged for the product
   owner. Both sources agree pricing is never multiplied by barber count.
2. **Verified-badge idiom** on claimed barber profiles (green check reads as
   "verified" while meaning "claimed") — flagged designer question, kept
   honest accessible naming.
3. **"€ expected today" on Pro dashboard** (today's rows × current price list)
   is materially truthful for today but needs product-owner sign-off before it
   renders; V3 keeps the slot collapsed until signed off.

## Standing R5R constraints V3 inherits

- New V3 code lives beside canonical routes in an isolated preview namespace
  (`/_preview/v3`); canonical routes untouched until explicit approval.
- The `/_preview/r5r` (customer-v2/pro-v2) implementation is the **rejected**
  visual baseline: V3 may read it for contracts and business logic only, and at
  completion must not import its visible components (proven by import scan).
- Known pre-existing defects live in `R5R_DEFECTS_FOUND.md` (D-1…D-7); V3 does
  not silently fix or absorb them.
- Seven quarantined `ZZ dead R5R1A fixture…` orgs remain in the DB,
  marketplace-hidden (D-7); they must stay invisible in V3 QA.
