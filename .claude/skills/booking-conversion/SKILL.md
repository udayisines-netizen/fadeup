---
name: booking-conversion
description: Use when designing, implementing, reviewing or optimizing any FadeUp discovery-to-booking, profile-to-booking, repeat-booking or availability-selection flow.
---

# FadeUp Booking Conversion

Read:

- `docs/product/BOOKING_UX.md`
- `docs/product/FRONTEND_SPEC.md`

Primary metric:

Time To Booking.

For each flow identify:

- starting context
- information already known
- number of primary decisions
- number of taps
- number of screens
- redundant questions
- opportunities for safe defaults
- opportunities to expose useful availability earlier

For returning authenticated customers starting from a professional profile, target approximately:

service
→ slot
→ confirmation

when backend/product rules allow it.

Preserve context.

Do not ask again for information already known.

If the customer entered from a specific professional, do not unnecessarily ask them to select that professional again.

If a service is already known, do not unnecessarily ask them to select it again.

Surface real next availability early when useful.

Never fabricate:

- slots
- availability
- wait times
- professional presence
- queue information

Verify actual backend behavior.

When a slot conflict occurs:

1. explain the slot is no longer available;
2. preserve the user's chosen service/professional;
3. immediately present real nearby alternatives.

Do not send the customer back to the beginning unnecessarily.

Evaluate whether every screen and interaction is necessary.

Ask:

Can one screen be removed?

Can one tap be removed?

Can one decision be safely inferred?

Can known context be preserved?

Can availability be shown earlier?

If yes, simplify.

Speed beats spectacle.

Animations must never make booking slower.
