# FadeUp Screen Blueprints

This document defines the intended structure of all major FadeUp frontend surfaces.

It is a product blueprint, not a mandate to copy ASCII layouts literally.

All implementations must follow:

- GREENFIELD_RULES.md
- PRODUCT_UI_BLUEPRINT.md
- MOTION_SYSTEM.md

---

# CUSTOMER

## C1 — Global Customer Shell

Mobile navigation:

Home
Marketplace
Book
Appointments
Profile

Requirements:

- light-first
- discreet branding
- location context where useful
- notifications accessible
- no floating CTA
- safe-area aware
- immediate press feedback
- responsive desktop behavior

The shell must be newly implemented.

---

## C2 — Home

> **Superseded in part by MARKETPLACE SUPPLY MODEL at the end of this file
> (R5R.1A-R2).** Customer supply is Independent + Barbershop only; a staff
> barber is never a separate result, and a multi-location location is an
> ordinary Barbershop.

Primary job:

Help the customer start discovery immediately.

Top hierarchy:

FadeUp / brand
Notifications

Current location

Find your next barber

Search

Then marketplace-driven discovery.

Possible sections based on real data:

- recommended near you
- popular around you
- relevant shops/professionals
- recent/relevant visual work
- recently viewed/followed where backend supports it

Do not add Stories.

Do not force Available Now as the first content block.

Social haircut content may appear further down.

---

## C3 — Marketplace

> **Superseded in part by MARKETPLACE SUPPLY MODEL at the end of this file
> (R5R.1A-R2).** Customer supply is Independent + Barbershop only; a staff
> barber is never a separate result, and a multi-location location is an
> ordinary Barbershop.

Primary job:

Compare relevant establishments/professionals quickly.

Mobile:

list-first.

Required information hierarchy where data exists:

1. identity/photo
2. name
3. shop relationship
4. distance
5. rating
6. price context
7. availability/open/queue operational context
8. portfolio preview
9. Follow
10. Book

Book may be available directly.

Filters remain.

Map remains available.

Desktop may use list + map.

---

## C4 — Search

Focused search experience.

Primary:

traditional search.

Secondary:

future-compatible natural intent.

Keep filters.

Search results use the Marketplace visual grammar.

Do not fake semantic/AI capability.

---

## C5 — Barber Profile

Instagram-first.

Header:

profile image
name
username
verification
professional context
Working at
followers
customers served
Already cutting
Book
Follow

Book dominates.

Follower/customer counts may be hidden according to barber settings.

Sections:

Work
Services
Reviews
Info

One long page with clear visual section separation.

Portfolio:

3-column Instagram-like grid where appropriate.

Support photo/video.

Availability:

real next availability if available.

Queue:

real estimated queue if available.

Joining queue remains restricted by QR + proximity validation.

---

## C6 — Work Viewer

Opened from portfolio or social content.

Must include where real:

media
professional
likes
caption
date
Book action

Use spatial transition from originating media where feasible.

---

## C7 — Barbershop Profile

Must be visually distinct from Barber Profile.

More establishment/community oriented.

Header:

large cover
shop avatar/logo
name
identity/handle
location
open state
rating
Book
Follow

Then:

About
Team cards
Services
Work
Reviews
Info

Team cards link to professionals.

---

## C8 — Barber Booking

From Barber Profile:

Book
→ Service
→ Time
→ Confirmation

No professional selection step.

Do not leave the originating experience unnecessarily.

Service:

cards.

Time:

horizontal day selector
+
slots.

Show approximately three useful next slots initially where appropriate.

See more expands broader availability/calendar.

---

## C9 — Shop Booking

From Shop:

Book
→ Service
→ Time
→ Professional
→ Confirmation

Professional options must reflect real ability/availability.

Do not invent available professionals.

---

## C10 — Booking Confirmation

Minimal.

Show:

Booked
date/time
professional
shop
service
price
address

Actions:

Add to Calendar
View booking
Done

---

## C11 — Book Tab

Primary job:

Fast booking/rebooking.

Potential hierarchy:

Book again
Recent professionals
Recent establishments
Search for someone else

Use backend-supported context.

Do not fabricate recommendations.

---

## C12 — Appointments

Tabs/sections:

Upcoming
Past

Upcoming:

date
time
professional
shop
service
View booking

Past:

professional
date
service
Book again

Book again becomes available after completion where rules permit.

---

## C13 — Queue Public State

Profile can show real:

estimated wait
queue status

Remote customer cannot join solely by pressing the profile.

Join requires:

QR validation
AND
proximity/geofence validation.

Explain this clearly.

---

## C14 — Queue Active State

Primary visual:

current position.

Secondary:

people ahead
estimated wait
professional/shop

Realtime transition:

#4
→ #3
→ #2
→ #1
→ You're next

---

## C15 — Customer Profile

Real social profile.

Contains as appropriate:

photo
username
verification
followers
following
voluntary Cuts here / Gets cut by information
activity/content
Fade Passport entry
settings

Privacy for barber relationships:

OFF
FRIENDS ONLY
PUBLIC

---

## C16 — Fade Passport

Wallet-inspired.

Contains supported information such as:

identity
preferred barber
preferred shop
loyalty
QR

Interactive but restrained.

Useful, not promotional.

---

## C17 — Activity

Mix:

transactional
+
social.

Potential real events:

appointment reminders
booking state
queue state
new work from followed professional
follow events
meaningful shop/pro activity

No SMS.

Provide notification control architecture.

---

# PROFESSIONAL

## P1 — Pro Global Shell

Primarily light.

More information-dense than Customer.

Supports scopes:

Organization
Location
Professional

according to authorization.

Large organizations must not be forced into one-location assumptions.

---

## P2 — Pro Dashboard

Primary job:

What needs my attention now?

Top operational information:

next appointment
queue
today's activity
important dates/events

Business information:

revenue
customers
occupancy/operations
key trends

R4 activity/date aggregation should be surfaced where available.

For multi-location organizations:

scope selector.

Example:

All locations
Paris République
Créteil Soleil
Lyon Part-Dieu

Allow drill-down.

---

## P3 — Calendar

Mobile:

vertical timeline.

Desktop:

full calendar.

For teams:

multiple professionals visible.

Desktop drag/drop important.

Respect actual booking conflict rules.

---

## P4 — Customers CRM

Classic CRM utility.

Customer detail:

identity
last visit
visit count
spend
frequency
expected return
preferences
Passport
history

Chronological appointment/service timeline.

---

## P5 — Analytics

Dense analytical surface.

Primary KPIs:

monthly customers
revenue
off-peak hours
forecast
margin

Margin only with trustworthy cost data.

Support organization/location/professional scope.

Charts are allowed to be substantial when useful.

---

## P6 — Retention / Campaigns

Customer audience concepts may include:

regular
recent
at risk
inactive

Professionals can configure genuine FadeUp offers/promotions where backend capabilities permit.

Results may include:

sent
opened
booked
redeemed
revenue

only when real tracking exists.

No SMS.

---

## P7 — Professional Profile Editor

Social-profile editing feeling.

Manage:

profile image
username
bio
Working at
portfolio
services
visibility controls

Use live customer-profile preview where appropriate.

---

## P8 — Professional Onboarding

One coherent full-page onboarding experience.

Valid professional context required:

independent
or
member of a barbershop

Successful state:

Your FadeUp profile is live

with preview.

---

## P9 — Organization Cockpit

For large organizations.

Top scope:

All locations.

Aggregate metrics across authorized locations.

Then allow drill-down:

Organization
→ Location
→ Professional

Example location list:

Paris République
Créteil Soleil
Lyon Part-Dieu

Each may expose appropriate real operational/business summary.

Never assume one organization equals one address.

---

# RESPONSIVE RULES

Mobile primary widths:

390px
430px

Desktop:

Marketplace may be wide.

Profiles should remain balanced rather than fully stretched.

Professional dashboards can become denser and wider.

Every major screen must have an intentional desktop composition.

---

# STATE REQUIREMENTS

Every implemented screen must account for relevant:

loading
delayed loading
empty
error
success
disabled
unauthenticated
unauthorized
partial data

External/unclaimed profiles require their own truthful states.

---

# VISUAL APPROVAL

Each major blueprint is implemented incrementally.

A new screen is not the visual source of truth until the product owner approves actual browser screenshots.

Do not automatically propagate an unapproved design into later screens.

---

# MARKETPLACE SUPPLY MODEL (authoritative)

Customer discovery — Home and Marketplace — contains INDEPENDENTLY BOOKABLE
SUPPLY, and there are exactly two customer-facing kinds of it:

- **Independent** — a professional operating as their own business: mobile, at
  home, at the customer's home, or from their own place.
- **Barbershop** — any independently bookable barbershop location.

There is no third kind.

**A location of a multi-location organization is a Barbershop**, presented
exactly like a standalone shop and titled with its own location name. Never
expose to customers:

- Multi-location
- Organization
- Group
- Parent organization
- Number of locations

The Organization -> Location -> Professional hierarchy is real and is preserved;
it is a Pro and backend concern. The customer UI flattens eligible locations into
ordinary listings.

**Staff barbers are not marketplace results.** A barber who works inside a shop
as an employee, staff member, team member or assigned professional must never
appear as separate supply merely because they have a public professional profile.
Their profiles stay valid and discoverable through the shop's team, portfolio,
follows, social content, direct links and booking context.

A professional who genuinely runs their own business is not an exception: they
are their own organization, and they reach the customer as their own listing.

Eligibility and the type label come from real domain data, and the mapping is
performed **in the database**, not in any client.

`db/migrations/20260830090000_marketplace_supply_type.sql` appends
`marketplace_supply_type` to `search_public_professionals`, carrying only the
customer-facing vocabulary:

| `organizations.business_type` (internal) | `marketplace_supply_type` (public) |
|---|---|
| `solo_professional` | `independent` |
| `barbershop` | `barbershop` |
| `hair_salon` | `barbershop` |
| `mixed_salon` | `barbershop` |
| `multi_location` | `barbershop` |
| anything else | `NULL` |

**The raw `business_type` is deliberately NOT exposed.** `hair_salon` and
`mixed_salon` are distinctions the customer marketplace does not make, and
`multi_location` describes an organization's internal topology — a branch of a
chain is an ordinary barbershop to a customer. Publishing the enum would invite
clients to couple to it and freeze it in place.

Backend organization types stay richer, and `multi_location` in particular is a
REAL organization type that is never renamed or flattened in the database. Only
the public presentation collapses.

No frontend may recreate this mapping. `customer-v2` consumes
`marketplace_supply_type` directly, and `marketplace-supply.test.ts` fails if any
file under `customer-v2/` so much as names an internal enum value in code.

The mapping enumerates each value rather than using a catch-all, so a business
type added later resolves to `NULL` and renders no label — never the commoner
guess — and the database verification flags that a product decision is required.

Do not group discovery results by entity type. Entity type is a backend row
shape, not a customer taxonomy.
