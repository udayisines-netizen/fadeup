# FadeUp — Claude Code Project Instructions

## Mission

FadeUp is a production SaaS and social-first marketplace/operating system for barbers, independent professionals, barbershops and customers.

We are building FadeUp Social-First V2.

Current roadmap checkpoint:

- R0: completed
- R1A: completed
- R1B: completed
- R2: completed
- Service Mode foundation: completed
- Customer API / social contracts: completed
- R3 Analytics & Event Engine: completed
- R4 Worker Foundation: completed
- R5 technical/database work exists
- R5 frontend/design is NOT product-approved
- Current mission: R5R Frontend Reset

Do not treat the previous R5 visual implementation as approved product direction.

Do not proceed into R6 as though the previous R5 frontend/design were accepted.

The immediate objective is to rebuild the frontend foundation from first principles while preserving working backend contracts and proven technical foundations.

## Product principle

FadeUp is:

Social-first discovery.
Booking-first conversion.

Discovery should create desire, relevance, trust and intent.

Once booking intent exists, the interface should aggressively minimize:

- time to booking
- cognitive load
- number of screens
- number of taps
- unnecessary choices
- unnecessary form fields
- repeated information
- unnecessary navigation

## Sources of truth

Before making frontend or product decisions, read the relevant parts of:

- `docs/product/FRONTEND_SPEC.md`
- `docs/product/BOOKING_UX.md`
- `docs/design/DESIGN_SYSTEM.md`
- `docs/design/REFERENCE_PRODUCTS.md`
- `docs/frontend/REBUILD_PLAN.md`

Also inspect the authoritative existing V2 documentation under `docs/v2/`.

Do not replace explicit FadeUp decisions with generic SaaS assumptions.

If an older document conflicts with the current R5R frontend direction described in these documents, do not silently choose one.

Preserve proven backend/domain contracts and apply the newer frontend/product direction.

## Existing architecture

Preserve working backend architecture and contracts.

Current core stack includes:

- React
- TypeScript
- Vite
- Tailwind
- TanStack Query
- React Hook Form
- Zod
- Supabase/PostgreSQL
- Supabase Auth
- RLS
- Supabase Realtime
- Storage
- Docker
- Nginx

Before adding a new abstraction, inspect whether an existing one already solves the problem.

Do not create parallel:

- authentication systems
- authorization systems
- API clients
- query layers
- state-management systems
- realtime architectures
- localization architectures

unless there is a proven architectural reason.

## R0–R4 preservation

Do not casually rewrite foundations completed before R5.

R0–R4 contain significant work around:

- integrity
- security
- identity
- social domain
- acquisition
- pricing
- entitlements
- service modes
- customer contracts
- analytics
- Worker V2

Treat these as existing foundations.

Change them only when evidence proves a frontend requirement cannot be satisfied correctly through existing contracts.

## R5 status

R5 was technically implemented, including frontend and some database/contracts.

However, its frontend/design result is NOT product-approved.

Therefore:

Do not preserve an R5 visual decision merely because code already exists.

Do not assume R5 components represent the desired design system.

Do not assume R5 page hierarchy represents the desired customer experience.

Do not assume R5 navigation is approved.

Do not assume R5 marketplace presentation is approved.

Do not assume R5 profile presentation is approved.

Do not assume R5 professional dashboard presentation is approved.

Technical R5 database/contracts may still be valid and useful.

Audit before removing or replacing them.

## Frontend rebuild rule

The existing frontend is not the visual source of truth.

Legacy and rejected R5 screens may be inspected to understand:

- routes
- functionality
- backend contracts
- data requirements
- permissions
- edge cases
- historical product intent

Do not preserve their structure merely because they exist.

For R5R surfaces, rebuild the UX from first principles according to the current specifications.

Do not simply:

- add rounded cards
- add gradients
- add animations
- change colors
- rearrange old components
- wrap existing screens in new containers

and call that a rebuild.

## Legacy safety

Do not delete working legacy frontend surfaces before replacements are verified.

Build the new V2/R5R safely alongside existing functionality where practical.

Migration should happen surface-by-surface or route-by-route.

Only remove obsolete implementation after:

- replacement works
- real backend integration works
- browser QA passes
- responsive QA passes
- critical flows pass
- independent review passes
- rollback is understood

## Database safety

Never reset, drop or recreate production data merely to make frontend development easier.

Use additive/safe migrations where schema evolution is necessary.

Never weaken RLS or authorization to make the UI work.

Frontend hiding is not authorization.

Never delete or revert previously deployed database work merely because its associated frontend design was rejected.

First determine whether the technical contract remains useful.

## Real data

Never fabricate operational data.

Never invent:

- appointment availability
- time slots
- queue length
- queue position
- waiting time
- realtime status
- customer relationships
- bookings
- reviews
- followers
- social proof
- revenue
- analytics

Use real backend data when the feature requires real data.

Mocks are acceptable only in isolated development/testing contexts and must never silently replace missing real integrations.

## External/unclaimed profiles

Worker V2 may create external/unclaimed professional profiles.

These must remain clearly represented according to their real status.

External/unclaimed profiles must never receive fabricated:

- availability
- booking capability
- live queue
- waiting time
- realtime state

They may later be claimed and become verified FadeUp professional profiles.

## Product scope

The defined FadeUp V2 scope is frozen.

Do not invent unrelated product concepts during implementation.

Do not introduce messaging.

Do not introduce SMS.

Do not create speculative social features.

Do not add:

- generic feeds
- stories
- livestream
- DMs
- unrelated AI assistants

unless explicitly requested by a later approved decision.

## AI-native principle

FadeUp may use AI-native interaction patterns.

AI-native does NOT mean making every screen a chatbot.

Prefer AI where it can reduce interaction cost through:

- natural-language intent
- contextual discovery
- smart defaults
- useful ranking
- fewer filters
- faster decision-making

AI outputs involving availability, queue, pricing or real operational state must remain grounded in actual data.

## Communications

FadeUp does not use SMS.

Supported communication surfaces may include:

- app
- push
- email
- Wallet/Fade Passport related experiences

according to actual product capabilities.

## Pricing source of truth

Independent:
20 EUR/month.

Barbershop plans:
35 EUR/month.
49 EUR/month.
69 EUR/month.

Pricing is per establishment, not per barber seat.

Do not use obsolete 39 EUR pricing.

Do not multiply subscription price by the number of barbers in a shop unless explicit plan logic requires something different.

## Globalization

Internationalization is a cross-cutting requirement.

Preserve:

- automatic locale selection
- explicit language override
- persistence
- country/location behavior
- translation architecture
- international formatting
- RTL compatibility where supported

Do not introduce major hardcoded user-facing English strings outside the localization system.

## Working method

For substantial tasks:

1. inspect before editing;
2. understand actual behavior;
3. trace relevant data flows;
4. identify dependencies;
5. identify risks;
6. form the smallest coherent plan;
7. implement;
8. run deterministic verification;
9. inspect the real UI in a browser when UI is affected;
10. compare against current product/design specifications;
11. correct failures before completion.

Never declare success simply because code compiles or a component renders.

## Browser-first UI verification

For important frontend work, source-code review is insufficient.

Run the real application.

Inspect the actual rendered experience.

At minimum for important customer surfaces verify representative widths around:

- 390px
- 430px
- desktop where applicable

Check:

- hierarchy
- visual quality
- touch behavior
- overflow
- sticky actions
- navigation
- loading
- empty states
- errors
- console
- failed requests
- animations
- perceived speed

## Model routing

Use specialized agents proactively.

Normal scoped implementation should use `opus-builder`.

Use `fable-critical` for:

- difficult architecture
- cross-cutting frontend/backend problems
- hard debugging
- repeated failed fixes
- auth
- RLS
- data integrity
- complex realtime
- risky refactors
- major design-system decisions
- critical booking architecture
- difficult product/technical ambiguity
- systemic R5/R5R frontend problems

Use `opus-reviewer` after meaningful implementation work.

If the same problem survives two serious fix attempts, stop patching symptoms and escalate root-cause analysis to `fable-critical`.

Do not spend the strongest model on trivial edits.

## Skills

Use project Skills when relevant.

Important project Skills include:

- `frontend-rebuild`
- `booking-conversion`
- `frontend-qa`
- `design-review`

Also discover and use other installed architecture, frontend, testing, security and design skills when relevant.

Do not invent skill names that are not actually installed.

## Definition of done

A frontend change is not complete until the affected behavior is genuinely verified.

Where applicable verify:

- TypeScript
- lint
- production build
- unit/integration tests
- route
- data loading
- authentication
- authorization
- booking behavior
- loading state
- empty state
- error state
- browser console
- failed network requests
- mobile responsive behavior
- desktop behavior
- localization
- realtime updates
- accessibility basics
- touch targets
- visual coherence
- interaction count
- conversion hierarchy

## R5R approval gate

R5R is NOT automatically considered complete because tests pass.

R5R has two gates:

1. technical verification;
2. human product/design approval.

Do not mark the R5R design foundation as finally approved until the product owner explicitly validates the resulting direction.

Until then, do not build later frontend phases on rejected visual assumptions.

## Scope discipline

When implementing a specific lot:

- work only on that lot
- touch necessary dependencies only
- do not start the next lot automatically
- do not perform unrelated refactors
- record unrelated defects separately

## Engineering principle

Fix causes, not symptoms.

Minimize blast radius.

Prefer coherent existing architecture over locally convenient hacks.

Every completed lot should leave FadeUp easier to continue building.
