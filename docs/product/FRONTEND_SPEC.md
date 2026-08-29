# FadeUp Social-First V2 — Frontend Product Specification

## Current phase

The current frontend mission is R5R — Frontend Reset.

R0 through R4 foundations are considered completed.

The previous R5 frontend/design implementation is not product-approved.

Do not treat the rejected R5 visual implementation as the design source of truth.

## Product identity

FadeUp is not simply appointment software.

FadeUp combines:

- professional discovery
- barber profiles
- barbershop profiles
- social proof
- customer profiles
- booking
- live queue
- Fade Passport
- reviews and reputation
- following
- professional business operations
- retention
- analytics

The customer-facing experience should feel like a modern consumer social product.

The professional-facing experience should feel like a modern operating system for a barber business.

## Core product principle

Social-first discovery.
Booking-first conversion.

Discovery exists to help the customer:

- find the right professional
- understand their work
- trust them
- understand location
- understand price
- understand real availability

When booking intent appears, everything should become faster and simpler.

## Customer experience

Customer surfaces must be:

- mobile-first
- fast
- premium
- visually calm
- social
- intuitive
- touch-oriented
- highly responsive
- conversion-oriented

Avoid conventional B2B SaaS patterns on consumer surfaces.

Avoid generic AI-generated interface patterns.

## Public professional profile

The barber/barbershop public profile is a core conversion surface.

Primary CTA:

Book.

Secondary CTA:

Follow.

Do not add a Message CTA.

Messaging is outside current scope.

The profile should make important information easy to understand:

- professional identity
- establishment
- address/location
- services
- prices
- work/portfolio
- reviews
- social proof
- real availability when available
- queue information only when real

Book must remain visually dominant.

Follow must remain secondary.

The customer should never have to search the page to understand how to book.

## Social proof

FadeUp may expose permitted social proof.

Approved language concepts include:

"Already cutting {name}"

when real permitted data supports it.

Never expose:

- future appointments
- private booking history
- realtime customer whereabouts
- private customer/professional relationships

Social proof must respect privacy settings.

## Customer profiles

Customers may have public profiles.

Some customers, creators or public figures may be verified.

Verification may be visually represented with an appropriate badge.

Public customer information must remain subject to privacy rules.

## Following

Following should reflect genuine customer interest or real interactions.

Qualifying interactions may include:

- confirmed booking
- Fade Passport association
- check-in

Users must be able to unfollow.

Discovery alone must not create fake relationships.

## Fade Passport

Fade Passport is a core product capability.

The customer should receive or be associated with Fade Passport according to the actual product/signup logic.

Do not create a major consumer CTA saying:

"Get Fade Passport"

when the product already creates it automatically.

Passport should feel embedded in the ecosystem rather than like an upsell.

## Discovery

Discovery should help users find relevant professionals quickly.

Signals may include:

- location
- services
- price
- rating
- portfolio
- social proof
- establishment
- real availability
- real queue state where relevant

Do not surface availability claims for external/unclaimed profiles unless the data is genuinely available through FadeUp.

## Natural-language discovery

FadeUp should support an AI-native interaction philosophy.

The interface should eventually support user intent such as:

"I need a taper around Créteil within an hour for under 30 euros."

This does not mean every screen should look like an AI chatbot.

AI-native means:

- natural intent
- fewer filters
- smart defaults
- fewer steps
- contextual recommendations
- real-data reasoning

Never claim availability without actual availability data.

## Booking

Booking is one of FadeUp's most important conversion flows.

It must minimize:

- number of screens
- number of taps
- unnecessary choices
- repeated information
- repeated authentication
- unnecessary navigation

Use real:

- establishment data
- staff data
- services
- duration
- pricing
- availability
- booking state

Handle:

- conflicts
- no availability
- loading
- errors
- cancellation where supported
- authentication boundaries
- permissions

## Live queue

FadeUp includes public live queue functionality.

Public queue data must be real.

Never fabricate:

- people waiting
- position
- ETA
- staff availability

Where backend realtime is supported, queue UI should update naturally without arbitrary manual refresh.

QR-based queue entry must remain easy on mobile.

## External and unclaimed professionals

FadeUp discovery may contain externally discovered professionals.

These profiles must clearly communicate their status.

Do not show fake operational capabilities.

Do not invent:

- bookability
- slots
- queue
- live status
- appointments

A professional may later claim a profile and transition to a verified state.

## Professional experience

Professional screens are different from customer social screens.

They should still be:

- mobile-first
- premium
- extremely usable
- actionable
- information-dense only where justified

Important professional areas include:

- appointments
- queue
- staff
- services
- customers
- profile
- Fade Passport
- reviews
- reputation
- analytics
- profile views
- booking attempts
- conversion
- retention
- service performance

The dashboard should answer:

"What is happening in my business?"

and:

"What should I act on?"

Avoid decorative analytics without actionability.

## Subscription UI

Pricing source of truth:

Independent:
20 EUR/month.

Barbershop:
35 EUR/month.
49 EUR/month.
69 EUR/month.

Pricing is per establishment.

Do not calculate one subscription per barber.

Entitlement UI must follow actual backend subscription state.

## Onboarding

Professional onboarding should support:

- independent/solo professionals
- barbershops
- multi-location organizations where currently supported

Use progressive disclosure.

Do not make a solo barber understand multi-location complexity unnecessarily.

## Realtime

When backend data genuinely changes in realtime, UI should react naturally.

Examples may include:

- queue
- booking status
- approvals
- operational status

Do not simulate realtime if the backend does not provide it.

## Globalization

FadeUp is international.

Do not assume France is the only market.

Preserve:

- locale detection
- country behavior
- explicit override
- translations
- persistence
- international formatting
- RTL support

## Mobile-first acceptance

Important customer flows must be verified at representative mobile widths including approximately:

390px.
430px.

Also test desktop layouts where relevant.

Check:

- safe areas
- sticky controls
- bottom navigation
- keyboard behavior
- touch targets
- long content
- long translations
- overflow
- sheets
- modals
- loading
- empty states
- errors

## Frozen scope

Do not add unrelated functionality before the defined V2 rebuild is delivered.

Execution quality takes priority over new concepts.
