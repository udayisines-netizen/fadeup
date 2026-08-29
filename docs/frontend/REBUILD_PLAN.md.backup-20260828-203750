# FadeUp Social-First V2 — R5R Frontend Reset Plan

## Current roadmap checkpoint

Completed foundations:

R0
Architecture audit.

R1A
Integrity/security hardening.

R1B
Social + acquisition domain foundation.

R2
Pricing + entitlements.

Additional completed foundations:
Service Mode.
Organization follows.
Customer API contracts.

R3
Analytics & Event Engine.

R4
Worker Foundation.

R5
Technical work exists, but the frontend/design result is not product-approved.

Therefore the current active phase is:

R5R
Frontend Reset.

Do not proceed to R6 as if the previous R5 UI/design were approved.

## Strategy

This is a ground-up frontend foundation rebuild over the existing product architecture.

The legacy frontend and rejected R5 frontend remain useful as:

- functional reference
- backend-contract reference
- edge-case reference
- rollback reference

They are not the visual source of truth.

## Safety

Do not delete legacy surfaces before replacement verification.

Do not rewrite the backend simply because the frontend is changing.

Preserve working:

- database
- authentication
- RLS
- booking engine
- realtime
- API/data contracts
- analytics
- Worker V2
- pricing/entitlements
- service mode

unless evidence proves change is necessary.

## R5 technical work

Some R5 database/contracts were already implemented and may be live.

Do not revert them automatically.

Audit each technical R5 capability separately from the rejected UI.

A bad frontend does not prove its underlying database contract is bad.

## R5R.0 — Frontend Audit and Isolation

Before creating new visual surfaces:

- inventory current frontend routes
- inventory legacy components
- inventory R5 components
- identify shared design primitives
- identify auth boundaries
- identify query/data layer
- identify realtime integrations
- identify localization architecture
- identify currently active routing
- identify mocks/hardcoded data
- identify duplicated frontend architecture
- identify backend contracts that must be preserved

Output a written audit.

Do not perform broad visual implementation during R5R.0.

## R5R.1 — Design Foundation

Establish the new visual/interactions foundation.

Focus on:

- typography
- spacing
- color
- surfaces
- radius
- buttons
- inputs
- chips
- selectors
- sheets
- feedback states
- loading
- empty states
- errors
- motion principles
- focus states
- touch behavior

Do not rebuild every product page during this phase.

Use representative proof surfaces to validate the system.

## R5R.2 — Customer App Shell

Build the customer V2 shell:

- route shell
- mobile navigation
- header behavior
- safe areas
- page transitions
- responsive primitives
- layout system
- error boundaries
- loading architecture

The shell must feel native on mobile.

## R5R.3 — Booking Interaction Language

Before building large marketplace/profile phases, define the core booking interactions:

- service selection
- barber/staff selection only when needed
- slot selection
- next availability
- sticky Book CTA
- booking sheet
- booking summary
- confirmation
- unavailable slot recovery
- repeat booking

Booking components should help shape the design system.

The design system should not force booking into generic components.

## R5R.4 — Visual and Functional QA Gate

Run the actual application.

Verify representative proof surfaces around:

- 390px
- 430px
- desktop where relevant

Verify:

- actual interaction
- responsive behavior
- motion
- layout
- hierarchy
- perceived speed
- console
- network failures
- loading
- empty states
- errors
- localization
- accessibility basics

Then obtain human product/design approval.

R5R is not approved until both technical and product/design gates pass.

## After R5R approval

Resume the roadmap.

## R6 — Public Profiles V2

Build signature public professional/barbershop profiles.

Primary CTA:
Book.

Secondary CTA:
Follow.

Prioritize:

- identity
- portfolio/work
- social proof
- services
- reviews
- address/location
- real availability
- rapid booking entry

No messaging CTA.

## R7 — Social Graph UX

Expose meaningful follow relationships.

Include:

- follow
- unfollow
- real auto-follow triggers where approved
- relationship state
- relevant counters

Do not invent generic social-network functionality.

## R8 — Verified Customers / Social Proof

Build:

- customer profile presentation
- verification badges
- permitted customer-to-professional social proof
- privacy-aware display

Never expose future appointments or realtime whereabouts.

## R9 — Marketplace / Discovery

Build customer discovery around intent.

Prioritize:

- search
- location
- service
- relevant ranking
- visual work
- trust
- real availability
- booking proximity

AI-native search may reduce filter friction when grounded in real data.

## R10 — Worker Discovery / External Profiles

Connect Worker V2 discovery into public marketplace behavior according to approved publication rules.

External/unclaimed profiles must remain clearly differentiated.

Never fabricate operational data.

## R11 — Customer / Fade Passport

Build customer identity and Passport surfaces.

Fade Passport should support:

- relationship
- retention
- identity
- rebooking

Do not present Passport as an unnecessary acquisition CTA when automatically provisioned.

## R12 — Booking / Free Demand Conversion

Optimize end-to-end booking.

Primary metric:

Time To Booking.

Profile-to-booking should require the minimum safe number of decisions.

## R13 — Live Queue

Build customer-facing queue UX over real realtime data.

Support:

- entry
- state
- updates
- cancellation where supported
- QR flows
- reconnect behavior

Never fabricate queue information.

## R14 — Professional OS / BI

Rebuild the professional experience around operations and actionable insights.

Areas include:

- appointments
- customers
- queue
- services
- staff
- reviews
- profile
- analytics
- conversion
- retention
- Fade Passport
- business actions

## R15 — Re-engagement

Build retention/re-engagement flows through supported communication channels.

No SMS.

## R16 — Billing

Implement final billing-provider and commercial lifecycle work when authorized.

## R17 — Worker Outreach / Claim / Closers

Extend Worker acquisition toward controlled outreach, claim and conversion workflows.

Keep Discovery separate from Outreach.

## R18 — Multi-location

Complete multi-location coherence.

## R19 — Production Hardening / Launch

Final production verification and launch readiness.

## Migration method

For each frontend surface:

1. inspect legacy functional behavior;
2. inspect backend contracts;
3. read current product/design specs;
4. design V2 independently;
5. implement;
6. connect real data;
7. test;
8. browser QA;
9. mobile QA;
10. desktop QA where relevant;
11. independent review;
12. product/design validation where required;
13. switch route;
14. keep rollback until stable;
15. remove obsolete legacy code only later.

## Definition of complete

A phase is not complete because pages exist.

It is complete when associated flows work with real application behavior and pass verification.

## Scope rule

Complete phases coherently.

Do not jump forward to exciting new features while foundational flows remain broken.
