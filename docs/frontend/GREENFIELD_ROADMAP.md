# FadeUp Greenfield Frontend Roadmap

## Principle

The previous R5 frontend is not the visual baseline.

The greenfield frontend is built incrementally.

Every major phase ends with:

implementation
→ tests
→ browser QA
→ screenshots
→ human product/design review
→ STOP

No automatic continuation.

---

# R5R.0 — COMPLETE

Frontend forensic audit.

Output:

docs/frontend/R5R0_FRONTEND_AUDIT.md

---

# CUSTOMER GREENFIELD

## R5R.1A — Customer Shell + Home

Build from zero:

- new customer shell
- mobile bottom navigation
- desktop customer shell
- location header
- notifications entry
- new Home
- search entry
- marketplace-driven discovery blocks
- initial real-data integration
- social haircut content surface only where real data supports it

Goal:

Approve the fundamental FadeUp visual identity.

This phase becomes the first visual gate.

---

## R5R.1B — Marketplace + Search

Build:

- marketplace list
- result presentation
- filters
- direct Book actions
- map mode / desktop map composition where technically available
- dedicated Search experience
- desktop list/map structure

Goal:

Approve discovery UX.

---

## R5R.1C — Barber Profile

Build:

- Instagram-first identity
- followers/customer stats with privacy
- Working at
- Already cutting
- Book / Follow hierarchy
- portfolio grid
- photo/video viewer
- likes where supported
- services/reviews/info section structure
- real next availability
- real queue estimate

Do not implement new R6 identity backend architecture during this phase.

---

## R5R.1D — Barbershop Profile

Build distinct establishment identity:

- cover
- shop avatar
- identity
- location
- Book / Follow
- team cards
- services
- work
- reviews
- info

Goal:

Establishment must clearly feel different from individual barber profile.

---

## R5R.1E — Booking

Build greenfield booking interaction:

Barber:
Service
→ Time
→ Confirmation

Shop:
Service
→ Time
→ Professional
→ Confirmation

Use progressive page transformation.

Reuse safe existing business/backend logic only.

Do not reuse legacy wizard visual structure.

---

## R5R.1F — Appointments + Book Again

Build:

- Upcoming
- Past
- appointment detail
- Book again
- post-appointment repeat-booking path

Goal:

Fast customer retention loop.

---

## R5R.1G — Queue

Build:

- public queue estimate
- QR + proximity join validation UX
- active queue
- realtime position updates
- You're next state

No remote join bypass.

---

## R5R.1H — Customer Profile + Activity

Build:

- social customer profile
- verification
- followers/following
- Cuts here / Gets cut by
- OFF / FRIENDS ONLY / PUBLIC privacy
- Activity
- notification controls

---

## R5R.1I — Fade Passport

Build:

- Profile entry
- Wallet-inspired Passport
- QR
- supported identity/loyalty/preference information
- subtle interaction/motion

---

# PROFESSIONAL GREENFIELD

## R5R.2A — Pro Shell + Dashboard

Build:

- light professional shell
- operational dashboard
- R4 activity/date integration
- next appointment
- queue
- today's state
- KPI overview
- organization/location scope selector
- drill-down architecture

Goal:

One cockpit for independent professionals, shops and large organizations.

---

## R5R.2B — Calendar

Build:

Mobile:
vertical timeline

Desktop:
multi-professional calendar

Include desktop drag/drop when compatible with current scheduling contracts.

---

## R5R.2C — Customers CRM

Build:

- customer list
- detail
- visit history
- spend/frequency
- expected return
- Passport context
- chronological timeline

---

## R5R.2D — Analytics

Build:

- monthly customers
- revenue
- off-peak hours
- forecast
- margin when trustworthy
- dense useful charts
- scope by organization/location/professional

---

## R5R.2E — Retention + Promotions

Build against actual backend capabilities:

- customer segments
- retention targeting
- applicable promotions
- delivery through supported channels
- performance tracking

Never fabricate analytics.

No SMS.

---

## R5R.2F — Profile Editor + Onboarding

Build:

- professional profile editor
- live preview
- portfolio
- visibility settings
- establishment relationship
- coherent onboarding
- live profile completion

---

# POST-GREENFIELD PRODUCT PHASES

After greenfield UI foundations are approved, continue the broader product roadmap.

R6 and later domain phases must use the approved greenfield visual architecture.

Do not start R6 merely because an earlier greenfield page is technically complete.

---

# MODEL ROUTING

Main:

Opus.

Use project specialists when useful.

Use Fable only for genuinely difficult cross-cutting architecture, data-integrity, authorization, realtime or major domain problems.

Do not use Fable for ordinary UI construction.

---

# BACKEND RULE

No frontend phase may casually redesign:

- database
- RLS
- organization hierarchy
- multi-location model
- pricing
- entitlements
- Worker identity model
- booking business rules

Frontend adapts to proven backend contracts.

---

# VISUAL GATE

At minimum verify:

390px
430px
desktop

with actual browser rendering.

Provide screenshots.

The product owner must approve the visual direction before the next major visual phase.
