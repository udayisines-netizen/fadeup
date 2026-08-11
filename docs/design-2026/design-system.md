# FadeUp 2026 — design system status

This documents what the design system actually is today, not an aspirational
spec. No visual mockup was provided (`docs/fadeup-mockup.png` does not
exist) — the "Premium Emerald identity" tokens below already existed in the
codebase (`apps/web/src/index.css`, commit `fe5440e`) before this rebuild
and were reused as-is rather than reinvented.

## Tokens (already built — `apps/web/src/index.css`)

- **Ink** (text): `ink-950/800/700/500/300` — near-black graphite, not pure
  black. Inverts correctly in dark mode (`ink-950` stays highest-contrast).
- **Paper** (surfaces): `paper-0/50/100/200` — faintly cool off-white.
- **Accent** (brand, emerald): `accent-100/200/600/700/800`, used sparingly
  for primary actions/focus — never as a background wash.
- **Semantic status**: `success/warning/danger/info` — a deliberately
  different hue family from `accent`, so a status color never reads as "the
  primary action."
- **`on-accent`**: fixed near-white text-on-color token, distinct from
  `paper-0` — stays legible on colored/dark surfaces in both themes.
- **Radius**: `sm/md/lg/xl` (0.375–1.5rem). **Shadow**: `xs/sm/md/lg`,
  reserved for genuinely elevated surfaces (dialogs, popovers), never
  decorative.
- **Dark mode**: `[data-theme='dark']` on `<html>`, set pre-first-paint by
  an inline script in `index.html` — no flash of wrong theme. Full palette
  redefinition, not a naive invert.

No new tokens were added for the marketplace — `Badge`'s existing
`success`/`neutral` variants cover "open now"/"closed", and the emerald
`accent` scale covers the live-queue count. Restraint over proliferation.

## Components reused (already built — `apps/web/src/components/ui/`)

`Button`, `Card`, `Badge`, `TextField`, `SelectField`, `Switch`,
`EmptyState`, `ErrorState`, `Skeleton`, `Container`, `Drawer`,
`LanguageSwitcher`, `ThemeToggle` — 24 primitives total, hand-rolled variant
maps (no `cva`), composed with `cn()` (clsx + tailwind-merge). The
marketplace work added zero new primitives to this layer; new marketplace-
specific composites (`MarketplaceSearchForm`, `MarketplaceResultCard`) live
in `apps/web/src/components/marketplace/` and are built entirely from the
existing primitives above.

## i18n (already built, extended)

10 locales (`en fr es de it pt ar zh-CN ja ru`) with real RTL handling
(`isRtl()`, `dir` attribute sync on language change) already existed. This
work added a second namespace, `marketplace` (`src/locales/*/marketplace.json`),
following the existing per-domain-namespace convention documented in
`src/i18n/index.ts` — real translations for all 10 locales, not just en/fr.

## Icons / motion

`lucide-react` for icons (already the only icon package — no second one
added). `motion` (framer-motion successor) is installed but unused by
either the existing app or this work — every transition here is plain
Tailwind/CSS, consistent with the rest of the codebase.

## What this session did NOT build

Per the flagship-quality-gate approach (do one thing for real rather than
many things shallowly — see `marketplace.md`), the following are explicitly
out of scope for this pass and remain future design-system work:
customer/barber/shop-operations/platform experience docs, a map component
for split-view search results, a dedicated motion vocabulary for the
`/for-business` marketing story, and a full responsive QA pass across all
8 target breakpoints (only mobile/desktop were manually reasoned about;
no real browser was available in this environment to visually verify — see
`marketplace.md`'s Testing section).
