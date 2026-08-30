# FadeUp Greenfield Frontend Rules

## Status

This document is authoritative for the FadeUp Social-First V2 frontend rebuild.

The previous R5 frontend/design has been rejected.

The new frontend is a GREENFIELD visual implementation.

The existing frontend remains useful only as a technical reference for existing contracts, business rules, authentication, queries, realtime behavior and backend integration.

---

# 1. Fundamental rule

Do not redesign R5.

Do not improve R5.

Do not reskin R5.

Do not refactor R5 into the new frontend.

Create a new frontend experience from a blank visual starting point.

For visible UI, default to:

NEW IMPLEMENTATION.

The question is never:

"How can the existing screen be improved?"

The question is:

"If FadeUp were designed today from zero according to the approved product blueprint, what should this experience be?"

---

# 2. Existing frontend may be inspected only for technical extraction

Existing code may be inspected to understand:

- authentication
- authorization
- Supabase access
- RPC contracts
- database types
- TanStack Query behavior
- business rules
- booking validation
- realtime
- localization
- country/location state
- error handling
- existing route requirements

After the necessary technical information is understood, implement the new visual layer independently.

---

# 3. Existing visual implementation is not reusable by default

Do not reuse existing R5 visual components merely because they work.

Do not use R5 as inspiration for:

- page composition
- cards
- typography
- spacing
- colors
- radius
- shadows
- navigation
- headers
- search UI
- filters
- profiles
- portfolio presentation
- booking UI
- queue UI
- dashboard composition
- Tailwind class combinations
- CSS structures
- design tokens
- motion
- responsive behavior

A component containing useful business logic may be classified as:

REUSE_LOGIC_ONLY.

Its visual implementation still does not become a reference.

---

# 4. Infrastructure to preserve

Reuse proven non-visual infrastructure when appropriate:

- React
- TypeScript
- Vite
- Tailwind infrastructure
- TanStack Query
- React Hook Form
- Zod
- Supabase
- PostgreSQL
- Auth
- RLS
- Realtime
- Storage
- existing safe RPC contracts
- generated database types
- query infrastructure
- localization infrastructure
- country/location infrastructure
- backend business rules
- booking conflict validation
- existing authorization rules

Do not create parallel systems unnecessarily.

---

# 5. Database and domain model are preserved

The current database architecture is valid.

Do not redesign the database to accommodate the greenfield frontend.

FadeUp supports:

- independent professionals
- barbershops
- organizations
- multiple locations/addresses under one organization
- multiple professionals/barbers per location
- centralized management of several locations from one cockpit

Never simplify the domain into:

- one user = one shop
- one organization = one address
- one organization = one location
- one subscription = one barber

The Pro frontend must support the hierarchy:

Organization
→ Location
→ Professional

where permissions allow it.

Large organizations must be able to aggregate information across locations and drill down into a location or professional.

---

# 6. Pricing and entitlements

Do not hardcode new pricing assumptions into the greenfield frontend.

Use the authoritative current backend/catalog/entitlement contracts.

Do not perform pricing migrations during frontend rebuild lots unless a dedicated pricing task explicitly authorizes it.

Never change billing or entitlements simply to make frontend implementation easier.

---

# 7. Public marketplace eligibility

Public discovery can contain:

- FadeUp barbershops
- subscribed independent professionals
- external/unclaimed prospects when supported by current contracts

External/unclaimed profiles must be explicitly identified.

An unclaimed profile must never fabricate:

- booking availability
- realtime state
- queue state
- opening status when not actually known
- appointments
- FadeUp-specific operational capability

Claiming an external profile is a separate product flow.

---

# 8. Data truth

Never fabricate operational or social information.

Never fabricate:

- slots
- availability
- queue position
- queue waiting time
- professional presence
- opening state
- distance
- reviews
- followers
- clients
- celebrities
- friends
- revenue
- analytics
- portfolio content

Test fixtures remain test fixtures.

Development placeholders must never be presented as real customer truth.

---

# 9. Customer product principle

FadeUp customer experience is:

SOCIAL-FIRST DISCOVERY.
BOOKING-FIRST CONVERSION.

The customer must be able to:

- understand current location
- discover relevant professionals and establishments
- evaluate work visually
- understand why a result is relevant
- see useful real operational information
- book with minimal friction

---

# 10. Visual references

References are inspiration for principles, not layouts to clone.

Use:

Instagram
- profile hierarchy
- content density
- social identity
- portfolio grid
- lightweight navigation
- familiarity

Fresha
- marketplace clarity
- discovery
- booking conversion
- availability presentation

Booksy
- professional marketplace
- portfolio importance
- service context
- booking utility

Planity
- booking simplicity
- understandable service selection
- operational clarity

Apple
- interaction quality
- physical feedback
- continuity
- hierarchy
- restraint
- motion
- native-feeling transitions

Never clone any reference exactly.

FadeUp must have its own identity.

---

# 11. Visual baseline

Customer and Pro are primarily light.

Use:

- pure or near-pure white backgrounds
- restrained light-gray separation
- black/dark typography
- FadeUp green for meaningful identity/action
- thin subtle borders
- almost invisible shadows
- restrained radius
- strong photography
- clear hierarchy
- SF Pro / iOS-like interface typography feeling
- outline iconography

Avoid:

- excessive gradient
- glassmorphism
- huge rounded cards
- every section inside a card
- excessive shadows
- decorative dashboards
- AI sparkles
- neon effects
- green everywhere
- giant empty desktop layouts

---

# 12. Conversion rule

Beauty and speed are both required.

Never choose visual spectacle that materially slows conversion.

Booking interactions must remain immediately understandable.

Animation must provide:

- feedback
- continuity
- orientation
- hierarchy

Animation must not become an obstacle.

---

# 13. Mobile-first

Primary customer verification widths:

390px
430px

Desktop must also be intentionally designed.

Desktop customer marketplace may use significantly more horizontal space than mobile.

Profile pages should remain comfortably readable rather than stretching edge-to-edge.

---

# 14. Human visual approval

Technical completion is not visual approval.

Every major greenfield frontend lot must end with actual browser rendering.

A lot may report:

TECHNICALLY READY FOR HUMAN REVIEW

It may not declare:

PRODUCT DESIGN APPROVED

without explicit product-owner approval.

---

# 15. Phase isolation

Do not automatically start the next phase.

Every lot must:

1. implement its requested scope
2. verify functionality
3. verify browser rendering
4. produce screenshots
5. stop
6. wait for human visual approval

---

# 16. No speculative scope

Current product excludes speculative additions not present in the approved blueprint.

Do not add:

- messaging
- random AI chat widgets
- unrelated social mechanics
- unapproved gamification
- arbitrary badges
- fake ranking systems
- fake scarcity

Build the defined product.

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
