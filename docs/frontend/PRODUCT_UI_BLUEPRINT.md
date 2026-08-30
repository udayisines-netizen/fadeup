# FadeUp Product UI Blueprint

## Purpose

This document defines the approved product and visual direction for the FadeUp greenfield frontend.

It describes product behavior and information hierarchy.

Implementation must follow GREENFIELD_RULES.md.

---

# 1. Overall identity

FadeUp should feel:

- modern
- consumer-grade
- social
- fast
- clear
- premium without pretension
- culturally relevant to barbering
- familiar enough to understand instantly
- visually distinct enough to have its own identity

The desired balance is:

Instagram social familiarity
+
Fresha marketplace usefulness
+
Booksy professional/portfolio utility
+
Planity booking simplicity
+
Apple interaction quality

---

# 2. Base visual language

Background:

White-first.

Density:

Closer to Instagram than an oversized luxury SaaS application.

Typography:

iOS / SF Pro feeling.

Logo:

Discreet in the application.

FadeUp green:

Clearly recognizable and more present than a tiny accent, but never used as a giant decorative background.

Primary Book CTA:

FadeUp green.

Shapes:

Between Apple and Instagram.

Moderately restrained corners.

Avoid excessive pill shapes and huge radius.

Borders:

Very light gray.

Shadows:

Minimal.

Gradients:

Avoid by default.

Icons:

Simple outline icons.

Photography:

Important.

Do not make monograms the primary identity of professionals.

---

# 3. Customer navigation

Mobile bottom navigation contains exactly five primary destinations:

1. Home
2. Marketplace
3. Book
4. Appointments
5. Profile

No floating action button.

Book is central in order but remains integrated into the navigation.

Fade Passport belongs inside Profile.

Activity/notifications are accessible through notification UI rather than a primary navigation tab.

---

# 4. Home

The first thing the customer should understand is:

Find your next barber.

Top area:

- discreet FadeUp identity
- notifications
- active location
- prominent search entry

Example hierarchy:

FadeUp                         Notifications

Paris 8e ⌄

Find your next barber

[ Search barbers, shops... ]

Home is more marketplace-driven than Instagram-driven.

It should prioritize useful discovery.

Do not lead with:

- Stories
- Available Now carousel
- random social content

The social/content layer may appear lower on the Home.

---

# 5. Marketplace content eligibility

> **Superseded in part by MARKETPLACE SUPPLY MODEL at the end of this file
> (R5R.1A-R2).** Customer supply is Independent + Barbershop only; a staff
> barber is never a separate result, and a multi-location location is an
> ordinary Barbershop.

The marketplace shows:

- establishments
- subscribed independent professionals
- external/unclaimed prospects where current contracts support them

Unclaimed prospects must be clearly identified.

Operational capabilities must never be invented for them.

---

# 6. Marketplace result

> **Superseded in part by MARKETPLACE SUPPLY MODEL at the end of this file
> (R5R.1A-R2).** Customer supply is Independent + Barbershop only; a staff
> barber is never a separate result, and a multi-location location is an
> ordinary Barbershop.

Default mobile marketplace presentation:

List-first.

Each result may contain, when real data exists:

- photo
- professional/shop name
- associated shop when relevant
- distance
- rating
- price context
- next availability
- open state
- queue information
- small portfolio preview
- Follow
- Book

All information must be carefully prioritized.

Do not turn the result into a wall of badges.

Distance is particularly important and belongs directly on the result.

Book must be available directly from an appropriate marketplace result.

Filters remain available.

Map remains useful as an alternate view.

---

# 7. Desktop Marketplace

Desktop is a genuine marketplace experience.

It may use:

results
+
map

side by side.

Do not render a narrow mobile application centered in a huge desktop viewport.

Desktop layout should intentionally use available space.

---

# 8. Search

Search can open into a dedicated focused experience.

Initial function:

traditional marketplace search with filters.

Natural-language intent is complementary for now.

The UX should be designed so richer intent can naturally become more important later.

Example future intent:

"Barber around Créteil available within one hour under €30."

Do not fake AI understanding if backend support does not exist.

---

# 9. Social haircut content

FadeUp may contain a vertical haircut content experience inspired by TikTok/Reels.

A work item may contain:

- photo/video
- professional identity
- description
- real like count
- direct path to the professional
- Book this barber

Opening visual content should use spatial continuity where technically appropriate.

Social content must support conversion rather than exist as unrelated entertainment.

---

# 10. Barber profile

The Barber Profile is Instagram-first.

Identity hierarchy:

- circular profile image
- name
- username
- verification badge where appropriate
- barber/location context
- Working at
- followers
- customers served
- social proof
- Book
- Follow

Follower count visibility:

Barber-controlled.

Customer/client count visibility:

Barber-controlled.

Book is primary.

Follow is secondary.

No messaging CTA.

---

# 11. Barber professional relationships

Working at must show the current establishment relationship.

The establishment name is:

- bold
- FadeUp green
- clickable

If the professional works at several supported locations, show those relationships clearly.

Do not force a user to choose the same professional again when entering booking from that professional's profile.

---

# 12. Barber social proof

"Already cutting {name}" may include:

- verified public personalities
- verified creators
- friends
- customer contacts

only where privacy and actual social data permit it.

Never expose:

- future bookings
- private appointments
- unauthorized customer relationships

---

# 13. Barber portfolio

Portfolio is strongly Instagram-inspired.

Grid:

3 columns on appropriate mobile profile layouts.

Support:

- photos
- videos

Opening a work item should preserve spatial continuity.

A work detail may include:

- media
- likes
- caption
- date
- professional
- Book action

---

# 14. Barber profile navigation

Barber profile is primarily one long page.

Sections should remain visually distinct rather than becoming an uninterrupted information dump.

A sticky/local section navigation may provide:

- Work
- Services
- Reviews
- Info

---

# 15. Barber availability

When real data supports it, profile may expose:

Next available
Today · 17:30

Queue estimate may also be visible.

However joining the live queue requires separate proximity/QR validation.

---

# 16. Barbershop profile

Barbershop profile must feel meaningfully different from Barber Profile.

Direction:

more organization/community oriented
with some Twitter/X-like profile structure.

It may use:

- large cover image
- shop avatar/logo
- establishment name
- username/handle where supported
- location
- open state
- rating
- Book
- Follow
- description
- team
- services
- work

The profile must clearly feel like an establishment rather than an individual creator.

---

# 17. Shop team

Team presentation:

cards.

Team cards can link to individual professional profiles.

---

# 18. Shop booking

From a shop:

Service
→ Time
→ Professional
→ Confirmation

where current booking rules allow it.

This makes the professional selection dependent on the chosen service/time and actual availability.

From a specific barber profile:

Service
→ Time
→ Confirmation

Do not ask for the professional again.

---

# 19. Booking interaction

Booking should remain inside the originating experience whenever possible.

Pressing Book on a profile should not feel like leaving the profile and entering a separate legacy wizard.

Desired interaction:

Profile
→ Book
→ Service
→ Time
→ Confirm

The profile/page transforms progressively.

---

# 20. Service selection

Use clean service cards.

Show useful real information such as:

- service name
- duration
- price

Avoid excessive visual decoration.

---

# 21. Time selection

Preferred structure:

horizontal day/date navigation
+
time slots underneath.

Initially show approximately the three most useful next slots when appropriate.

Provide:

See more

to expose broader availability/calendar.

Never fabricate slots.

---

# 22. Booking confirmation

Confirmation is intentionally minimal and Apple-like.

Example:

Booked

Today · 17:30

Jordan
Fade Factory

Cut + Beard · €35

Actions:

- Add to Calendar
- View booking
- Done

Calendar integration should provide complete event information including:

- title
- service
- professional
- establishment
- start/end
- full address
- useful booking context

Do not promise operating-system behavior outside FadeUp's control.

---

# 23. Book Again

After a completed appointment, the customer may use:

Book again.

Repeat booking should preserve as much known context as safely possible.

The user should not repeat unnecessary decisions.

---

# 24. Appointments

Primary sections:

Upcoming
Past

Upcoming appointments expose relevant details and View booking.

Past appointments expose Book again when appropriate.

---

# 25. Live queue

Queue visual language:

Apple Wallet / boarding pass / Live Activity inspired.

Before joining, public information may show:

- people ahead
- estimated wait

only when real.

Joining requires BOTH:

- valid FadeUp QR interaction
- valid proximity/geofence condition

A customer cannot remotely join simply from a profile.

Profile can show the estimated queue while explaining that joining is available on location.

---

# 26. Active queue

Active queue emphasizes:

- current position
- people ahead
- estimated wait
- professional/shop identity

Position should update in realtime.

Transitions between:

#4
→ #3
→ #2
→ #1
→ You're next

should feel continuous and physical.

---

# 27. Customer profile

Customer profile is a genuine social profile.

It may contain:

- photo
- username
- verification badge
- following
- followers
- voluntary barber/shop relationships
- public/social activity

Verification does not create a separate UI.

Verified users use the same profile with a badge.

---

# 28. Customer relationship privacy

Customer controls social barber relationship visibility with exactly three modes:

OFF
FRIENDS ONLY
PUBLIC

This applies to information such as:

- Cuts here
- Gets cut by
- barber relationships
- voluntary haircut history where applicable

Privacy must be enforced by backend contracts, not only hidden in UI.

---

# 29. Fade Passport

Fade Passport lives in Profile.

Visual direction:

Apple Wallet inspired.

It is not a marketing upsell.

It is automatically integrated with customer identity.

It may contain, where supported:

- identity
- preferred shop
- preferred barber
- loyalty information
- QR
- useful account/customer relationship information

It should be something customers can meaningfully open regularly.

Use subtle motion/tilt only where it improves quality.

---

# 30. Activity

Activity can mix:

transactional
+
social

Examples:

- appointment reminder
- queue update
- You're next
- professional posted new work
- follow activity
- meaningful booking/availability activity

Notification controls are necessary to prevent noise.

No SMS.

---

# 31. Professional application

The Pro product is also primarily light.

It should feel more operational and information-dense than the customer app, but remain part of the same product family.

It must support:

- independent professional
- shop
- multi-location organization

---

# 32. Pro hierarchy

The professional cockpit may operate at:

Organization
→ Location
→ Barber

Scope controls depend on permissions.

Examples:

All locations
Paris République
Créteil Soleil
Lyon Part-Dieu

Then within a location:

All barbers
Jordan
Mike
Alex

The same metrics may therefore be understood globally, by location, or by professional.

---

# 33. Pro Dashboard

The Dashboard is both:

operational cockpit
+
business intelligence surface.

The user should immediately understand:

- next appointment
- current queue
- today's operational state
- important dates/activity
- key business metrics

R4 activity/date aggregation should be used where existing contracts support it.

Example priority:

Today

Next
14:30 · Adam
Cut + Beard

Queue
3 waiting

Today
€420
11 customers

Important activity / dates

---

# 34. Retention

FadeUp Pro must create real customer-retention power.

Professionals may eventually act on groups such as:

- regulars
- recent customers
- at-risk customers
- inactive customers

Promotions must be genuinely applicable inside FadeUp.

Retention performance should be measurable where backend support exists:

- sent
- opened
- booked
- redeemed
- revenue

Do not invent campaign analytics.

No SMS.

---

# 35. Pro Calendar

Mobile:

vertical timeline.

Desktop:

full multi-professional calendar.

Desktop drag-and-drop is important.

Scheduling must respect actual backend conflict rules.

---

# 36. Customers CRM

Direction:

classic useful CRM.

Important information may include:

- visit history
- spend
- frequency
- last visit
- expected return
- preferences
- Passport
- booking history

Use chronological customer timeline.

Do not force social design onto CRM workflows.

---

# 37. Analytics

Analytics is allowed to be dense.

Primary KPI priorities:

1. monthly customer count
2. revenue
3. off-peak hours
4. forecast
5. margin

Only show Margin when real cost data makes the number trustworthy.

Charts can be substantial and useful.

Do not create decorative charts.

---

# 38. Professional profile editor

Editing should feel closer to editing a social profile than configuring enterprise software.

Use live preview where appropriate.

Allow management of:

- profile image
- username
- biography
- shop/location relationship
- portfolio
- services
- follower-count visibility
- customer-count visibility

---

# 39. Professional onboarding

Onboarding uses a complete coherent page rather than a huge fragmented wizard.

A professional profile is created only in a valid professional context such as:

- independent professional
- member of a barbershop

At successful completion:

Your FadeUp profile is live

with profile preview and View profile.

---

# 40. Desktop philosophy

Customer desktop should become a genuine large marketplace.

Marketplace/map may use significant width.

Profiles should use balanced content widths, approximately within the 1100–1250px design range when appropriate.

Do not:

- stretch every section to viewport width
- center a 390px mobile app inside a desktop screen

Design intentionally per surface.

---

# 41. Core success criterion

FadeUp should be:

beautiful
+
fast
+
understandable
+
conversion-oriented.

A beautiful interface that slows booking is wrong.

A fast interface that feels generic and undesirable is also wrong.

Both quality and conversion are required.

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
