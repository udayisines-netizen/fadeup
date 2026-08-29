---
name: frontend-rebuild
description: Use when rebuilding or substantially replacing a FadeUp frontend page, route, app shell or major customer/professional surface.
---

# FadeUp Frontend Rebuild

Before rebuilding a surface:

1. read `docs/product/FRONTEND_SPEC.md`;
2. read `docs/design/DESIGN_SYSTEM.md`;
3. read `docs/design/REFERENCE_PRODUCTS.md`;
4. read the relevant section of `docs/frontend/REBUILD_PLAN.md`;
5. inspect legacy functionality;
6. inspect rejected R5 functionality if relevant;
7. inspect backend contracts;
8. inspect existing route/data/auth behavior.

The legacy or R5 page is a functional reference, not the visual source of truth.

Rebuild the UX from first principles.

Do not perform a cosmetic reskin.

Do not preserve page hierarchy merely because implementation already exists.

Preserve proven backend behavior.

Before changing backend/domain contracts, prove why existing contracts are insufficient.

Prioritize mobile first.

For customer surfaces optimize:

- comprehension
- trust
- speed
- conversion
- booking accessibility
- visual work/content
- low interaction cost

For professional surfaces optimize:

- operations
- clarity
- actionability
- mobile usability

Inspect the running result.

Verify around:

- 390px
- 430px
- relevant desktop width

Check:

- overflow
- navigation
- safe areas
- touch targets
- loading
- empty states
- errors
- actual interactions
- console
- network failures
- localization
- motion
- perceived speed

Do not delete the previous implementation until replacement verification succeeds.

For R5R, remember that technical success does not equal human product/design approval.
