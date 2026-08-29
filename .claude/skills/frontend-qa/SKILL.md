---
name: frontend-qa
description: Use after FadeUp frontend implementation or when diagnosing whether an existing page or flow genuinely works.
---

# FadeUp Frontend QA

Do not evaluate functionality from source code alone.

Run the application.

Use actual project validation commands.

Where available run:

- typecheck
- lint
- relevant tests
- production build

Then verify affected routes in runtime.

## Functional

Check:

- route loads
- navigation works
- primary CTA works
- secondary actions work
- real data loads
- forms submit correctly
- auth works
- authorization works
- backend failures are handled
- redirects preserve expected context

## States

Verify:

- initial loading
- delayed loading
- empty state
- error state
- success state
- disabled state where relevant

## Runtime

Inspect:

- browser console
- failed network requests
- uncaught errors
- hydration/runtime warnings
- repeated requests
- obvious realtime loops
- stale data problems

## Responsive

Verify approximately:

- 390px
- 430px
- desktop where relevant

Check:

- horizontal overflow
- safe areas
- sticky controls
- bottom navigation
- keyboard overlap
- modal/sheet layout
- touch targets
- long strings
- translated strings
- viewport changes

## Product

Compare against:

- `docs/product/FRONTEND_SPEC.md`
- `docs/product/BOOKING_UX.md` when booking-related
- `docs/design/DESIGN_SYSTEM.md`
- relevant roadmap phase

## R5R specific

Do not treat the rejected R5 UI as the quality baseline.

The question is not:

"Does it look like the previous R5?"

The question is:

"Does it satisfy the new R5R product/design direction?"

Technical PASS does not automatically mean product/design PASS.

Do not report PASS unless the affected flow is genuinely usable.
