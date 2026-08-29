# FadeUp — Booking UX Specification

## Objective

Booking must feel dramatically faster than conventional salon-booking software.

The key metric is:

Time To Booking.

Secondary metrics include:

- taps to booking
- abandonment
- service selection time
- slot selection time
- conversion from profile
- conversion from discovery
- repeat booking speed

## Product philosophy

The user should not have to understand FadeUp's database structure.

Do not expose technical organization complexity unless needed.

The user wants:

"I want this service with this professional at a convenient time."

The interface should optimize around that intent.

## Returning authenticated customer

For a returning authenticated customer starting on a professional profile, aim for no more than approximately three primary booking decisions before confirmation.

Typical flow:

1. choose service
2. choose slot
3. confirm

If staff selection is genuinely necessary, introduce it intelligently.

Do not insert unnecessary intermediate confirmation screens.

## Existing context

If the user already entered from a specific professional profile:

do not ask them to choose the same professional again unless business rules require it.

If the user already selected a service:

do not ask again.

If location is already known:

do not ask again.

Preserve context.

## Smart defaults

Where safe and supported by actual data:

- preselect obvious establishment
- surface next available slots
- remember appropriate non-sensitive preferences
- prioritize previously booked service
- prioritize previously used professional
- make repeat booking extremely fast

Smart defaults must never create bookings without explicit user confirmation.

## Barber profile booking

Ideal interaction:

Professional profile
→ Book
→ Service
→ Slot
→ Confirm

Avoid:

Professional profile
→ booking landing page
→ establishment
→ professional
→ service
→ calendar
→ time
→ account
→ summary
→ confirmation

unless individual steps are actually necessary.

## Discovery booking

Search/discovery results may expose useful conversion information directly.

Where real data exists, cards may surface:

- service starting price
- next availability
- rating
- distance
- location
- booking CTA

The customer should not always need to open a profile merely to discover that no useful slot exists.

## Slot presentation

Make availability easy to scan.

Prefer:

- immediate relevant dates
- clearly grouped time slots
- next available
- today/tomorrow shortcuts
- contextual duration and price

Avoid oversized calendars when a simpler slot presentation answers the user's intent faster.

## Booking cards

A service option should communicate enough information to make a decision quickly.

Examples of useful attributes:

- service name
- price
- duration
- professional if relevant
- next availability where real

Do not overload cards.

## Repeat booking

Repeat booking should be one of FadeUp's fastest flows.

Where real historical data allows it, expose something similar to:

Last booking:
Skin Fade
with Yanis
25 EUR

Next available:
Today 18:30

Book again

The exact presentation may evolve, but the principle is:

reuse known intent rather than forcing the customer to rebuild the booking from zero.

## Authentication

Do not force authentication earlier than necessary purely for implementation convenience.

But do not create an insecure anonymous booking mechanism if the backend requires an authenticated customer.

Preserve as much booking intent as possible across login/signup.

After authentication, return the user to the same booking context.

## Errors and conflicts

Availability can change.

Handle booking conflict gracefully.

Do not display generic technical errors when a slot becomes unavailable.

The UX should explain what happened and immediately offer the nearest real alternatives.

## Loading

Avoid blocking the entire booking flow unnecessarily.

Use targeted loading states.

Do not visually pretend data is available before it is.

## Mobile

Booking is mobile-first.

Primary CTA placement should be reachable with one hand.

Avoid:

- tiny time slots
- excessive modal nesting
- horizontal overflow
- excessive page changes
- forms hidden by keyboard
- CTAs underneath unsafe areas

## Motion

Motion should preserve context and perceived speed.

Use subtle transitions for:

- service selection
- slot selection
- sheet changes
- confirmation

Do not use animations that delay the user.

Speed beats spectacle.

## Real data requirement

Never invent slots.

Never invent availability.

Never invent waiting times.

Never invent professional availability.

If data is absent, display an honest empty/unavailable state.

## Booking acceptance target

Every booking surface should be evaluated by asking:

Could one screen be removed?

Could one tap be removed?

Could one selection be inferred safely from context?

Could real availability be surfaced earlier?

Could we preserve the user's intent rather than asking again?

If yes, simplify.
