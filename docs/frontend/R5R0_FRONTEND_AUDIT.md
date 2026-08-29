# R5R.0 Frontend Audit

**Status:** AUDIT ONLY — no implementation performed.
**Date:** 2026-08-28
**Branch:** `rebuild/social-first-v2`
**HEAD:** `8287bff2619377fded28a81de796f51b14bea837`

Every claim is marked **[VERIFIED]** (code read, command run, browser observed, or arithmetic performed) or **[INFERRED]** (reasoned from evidence, not directly observed). Nothing is asserted because TypeScript compiles.

**This report was independently reviewed twice after drafting — once for engineering claims, once for verification honesty — and both reviews overturned parts of it.** Corrections are left visible inline, marked *"corrected during review"*, *"retracted"* or *"found during review"*, so a reader can see which claims were contested rather than trusting a silently-polished document.

The corrections that most change what a reader should believe:

| What the first draft said | What is true |
|---|---|
| Tests: 805 passed / 1 failed | **806/806 on re-run — the suite is non-deterministic** |
| The flake is caused by jsdom's missing `HTMLMediaElement.play` | **Retracted** — that error fires on every run, pass or fail; cause is machine contention |
| `Liste \| Carte` toggle spans ~1330px | **960px**; the page *does* have a 1024px measure cap |
| `/` is the slowest entry point at 4.4s | **Retracted** — re-run gave 1.79s and a different ordering entirely |
| "0 images without alt — a good baseline" | **Vacuous** — there are no images, which V-2 calls a BLOCKER |
| Tab-bar clearance and chrome height verified at 390px | **Never rendered** — `/app/customer` redirects to login |
| i18n guard gap is at line 81 | **The `EXEMPT` array at lines 33-41**, which also hides `components/for-business/` |
| Two known i18n violations | **Four sites plus a fifth class** the proposed fix would still have shipped |
| R5 is "exactly 10 commits" | **11** |
| Composition-layer rejection, not engineering | **Too generous** — four engineering defects sit inside the layer recommended for preservation |

Six primitives moved from KEEP to REUSE_LOGIC_ONLY as a result (T-4, T-5), and §25's acceptance criteria were substantially rewritten after review showed the original central gate was both self-contradictory and already satisfied on unmodified HEAD.

---

## 1. Executive Summary

The R5 rejection is **primarily a design rejection**, and the product's data, security, realtime and i18n foundations should survive it intact. But the precise formulation matters, because an earlier draft of this audit said "composition-layer rejection, not an engineering rejection" and independent review showed that binary to be too generous:

> **The page compositions are rejected, and the token/primitive foundation carries four specific, enumerable engineering defects that must be fixed before anything is built on it:** the non-monotonic radius scale (§7), the overlay portal theme-scope break (T-4), dark-mode token incompleteness (§19), and width-greedy primitive defaults (T-5).

None of those four live in "composition". Two of them sit inside components this audit initially recommended keeping verbatim. That correction is load-bearing: an R5R.1 builder who reads only the summary would otherwise inherit both bugs.

**Worth defending — do not rebuild:**

- **Data-honesty discipline is exceptional and is the most valuable thing R5 produced.** `metric.tsx` refuses a delta prop because FadeUp cannot query yesterday. `queue-panel.tsx` refuses to compute a wait estimate. `availability-label.tsx` renders nothing rather than guess. `date-strip.tsx` refuses hopeful availability dots. `marketplace.ts` omits `rating` and `available_soonest` sorts because nothing backs them. `dashboard-page.tsx` calls a sum "Booked value", never "revenue". **[VERIFIED]**
- **Security posture is correct.** Exactly one Supabase client, anon key only, enforced by a test that fails the build on a second `createClient`. Guards document in their own source that they are UX, not authorization. **[VERIFIED]**
- **Realtime architecture is sound** — never trusts payloads, per-generation channel topics, status-gated polling fallback, regression suite reproducing real historical races. **[VERIFIED]**
- **Both application shells are the strongest visual work in R5** — genuinely different mobile and desktop expressions of one mental model, not a stretched sidebar. **[VERIFIED]**
- **No fabricated availability, queue or wait time reaches any customer *in the product itself*.** External/unclaimed profiles are rendered by zero frontend files. **This holds for every transactional and discovery surface; it does not hold for the marketing site** — see F-6, where `/for-business` animates a fake queue position, ETA and two named people to a sighted visitor with no illustration caption. The two statements are scoped differently on purpose. **[VERIFIED]**

**Correctly rejected:**

- **The design system exists largely as prose and CSS custom properties the product does not use.** The semantic type layer is at ~2.4% adoption (20 uses vs 832 raw Tailwind utilities). The z-layer system is bypassed by every overlay primitive it was written for. `--fu-control-xl`, documented as "the BOOK action", has zero uses. **[VERIFIED]**
- **The radius scale is broken.** `rounded-xl` (24px) is *larger* than `rounded-2xl` (16px), and two step-pairs are exact duplicates. Radius cannot be chosen intentionally across 91 call sites. **[VERIFIED by arithmetic]**
- **The primary conversion button fails WCAG AA contrast at 3.58:1**, and the accessibility suite that claims "WCAG 2.2 AA" contains no contrast assertion. **[VERIFIED by computation]**
- **Book is not the dominant CTA on the booking surface** — Follow renders above it and carries the page's only shadow. **[VERIFIED]**
- **The customer product contains no imagery.** Monograms and empty gradient bands. **[VERIFIED in browser]**
- **A pricing catalog that has never matched the stated commercial decision**, locked by a test. **[VERIFIED against code and live DB]**

Baseline health is good with two caveats: typecheck and production build pass cleanly; lint passes with **26 pre-existing warnings**; and the test suite **passed 806/806 on an independent re-run** but produced one timeout on mine — it is **non-deterministic**, not "805/806 with a known failure" as this report first stated. The build also emits an undisclosed `maplibre-gl` chunk warning (**951.92 kB / 246.34 kB gzip**) on the surface R5R.1 proposes to rebuild first.

**Recommendation:** proceed to R5R.1 as a design-foundation lot only. Preserve the data, query, realtime, i18n and security layers intact. Do not revert either R5 migration.

---

## 2. Repository / Git Baseline

**[VERIFIED]** — captured at audit start.

| Item | Value |
|---|---|
| Working directory | `/opt/fadeup` |
| Branch | `rebuild/social-first-v2` (matches required branch) |
| HEAD | `8287bff2619377fded28a81de796f51b14bea837` |
| HEAD subject | `docs(r5): record the live deployment and the VERIFY that seeded production` |

### Uncommitted working-tree state (untouched by this audit)

Modified: `.claude/settings.json`, `CLAUDE.md`, `apps/web/src/lib/queries/professional-applications.ts`, `apps/web/src/lib/queries/queue.ts`, `apps/web/src/lib/realtime.test.ts`, `apps/web/src/lib/realtime.ts`

Untracked: `.claude/agents/*`, `.claude/skills/*`, `CLAUDE.md.backup-*`, `apps/web/src/lib/browser-credentials.test.ts`, `claude-inventory-*`, **`docs/design/`, `docs/frontend/`, `docs/product/`**

> **B-1 (MEDIUM).** The five documents `CLAUDE.md` names as R5R's sources of truth — `FRONTEND_SPEC.md`, `BOOKING_UX.md`, `DESIGN_SYSTEM.md`, `REFERENCE_PRODUCTS.md`, `REBUILD_PLAN.md` — are **untracked**. They exist only in this working tree and are one `git clean` from loss. The specifications governing the rebuild are less durable than the code they govern. **[VERIFIED]**

> **B-2 (LOW).** Four files carrying real logic are uncommitted. All analysis here describes **working-tree content**, which is what runs. **[VERIFIED]**

### Tags

`backup/pre-social-v2-20260821`, `post-r1b-20260826`, `post-r2-20260826`, `post-service-mode-20260827`, `post-customer-api-freeze-20260827`, `post-r3-analytics-20260828`, `post-r4-worker-v2-20260828`, `post-r4-1-planity-source-20260828`

> **There is no `backup/post-r5` tag.** The last checkpoint predates all R5 work. **[VERIFIED]**

### R5 commit range — **11 commits**, `ba1eede..8287bff`

*(Corrected during review: the first draft said "exactly 10" and then listed 11. `git rev-list --count ba1eede..HEAD` = 11.)*

```
fddb92d feat(r5): establish FadeUp design tokens and themes
dda38af feat(r5): add shared interaction primitives
9416749 feat(r5): build customer navigation and booking foundation
613a0e0 feat(r5): give the marketplace coordinates, a sort, and the shop a dashboard layout
1278c34 feat(r5): establish marketplace interaction system
e6ee1d3 feat(r5): establish social profile experience
f14841a feat(r5): establish FadeUp Pro dashboard experience
0f8d889 test(r5): cover accessibility, realtime and the country override
4ddc1c9 docs(r5): document the FadeUp experience system
b467aae feat(r5): deploy the experience foundation migrations to live
8287bff docs(r5): record the live deployment and the VERIFY that seeded production
```

Diff scale: **155 files, +9,492 / −649**. **[VERIFIED]**

---

## 3. Roadmap Checkpoint

R0, R1A, R1B, R2, Service Mode, Organization follows / Customer API, R3, R4 — COMPLETE. R5 technical/database work exists and is deployed live; **R5 frontend/design is NOT product-approved**. Active mission: **R5R — Frontend Reset**. R6 not started.

---

## 4. Current Frontend Architecture

**[VERIFIED]** React 19.2, TypeScript ~6.0, Vite 8, Tailwind v4 (`@tailwindcss/vite`; **no `tailwind.config.*` exists** — `@theme` inside `index.css` is the entire config), TanStack Query 5, React Router 7.18, RHF + Zod, Supabase JS 2.112, i18next 26, `motion` 13, MapLibre GL 6.

Scale: **82 pages, 102 components, 43 query modules**, 732-line router, 1,093-line `index.css`.

| Layer | Location | Assessment |
|---|---|---|
| Entry | `main.tsx` → `App.tsx` | KEEP |
| Router | `routes/router.tsx` | Single `createBrowserRouter`, lazy throughout. KEEP |
| Error boundary | `route-error-boundary.tsx` on root | Correctly placed *below* `RouterProvider`. KEEP |
| Shells | customer, pro, marketing, public-booking, platform (+3 sub-layouts) | KEEP — see §6 |
| Guards | `require-auth`, `require-pro-access`, `require-platform-role` | KEEP |
| Data | `lib/queries/*` (43 modules) | KEEP |
| Client | `lib/supabase.ts` — one singleton | KEEP, structurally enforced |
| Realtime | `lib/realtime.ts` | KEEP |
| i18n | `i18n/*` + 10 locales × 10 namespaces | KEEP |
| Tokens | `index.css`, `design/` | Gate KEEP, scale REBUILD — see §7 |
| Primitives | `components/ui/` | Mixed — see §7 |

### Duplicate / competing architectures **[VERIFIED]**

There is **no** duplicate Supabase client, auth system, i18n stack or realtime layer — each was checked specifically and is clean. Duplication is concentrated in the **customer presentation layer**, plus one parallel *design* system:

| Duplication | Instances | Consequence |
|---|---|---|
| **Booking UI** | `public-booking-page.tsx` (1,097 lines, 5-phase wizard) vs `inline-booking-sheet.tsx` (591 lines, 3-step sheet) | Two correct implementations, different interaction cost |
| **Result card** | `business-listing-card.tsx` (196L, pre-R5) vs `marketplace-card.tsx` (315L, R5) | Same shop renders differently on Discover vs Search |
| **Discovery surface** | `/app/customer` vs `/search` + `/app/customer/search` | Two visual languages for one job |
| **Design system** | product `@theme` vs `[data-pro-marketing]` block (~345 lines, **32% of `index.css`**) with its own palette, radius scale, glass vocabulary and glow utilities — serving one marketing route | A second design system inside the file defining the first |
| **Typography system** | 7 semantic roles vs 13 numeric Tailwind steps, both reachable | 20 addressable sizes; the numeric one governs the product |
| **"Rebookable" rule** | `discover-page.tsx:358-392` and `book-sheet.tsx:73-98` | Same rule, two implementations — drift risk |

Correctly shared, not duplicated: `DiscoverySearch` is the single search implementation behind both `/search` and `/app/customer/search`. **[VERIFIED]**

---

## 5. Route Inventory

**[VERIFIED]** — read from `router.tsx` in full.

### Public / marketing (`MarketingLayout`)

| Route | Component | Auth | Backend deps | Origin | Status |
|---|---|---|---|---|---|
| `/` | `consumer-landing-page` | none | static | PRE-R5 | WORKING |
| `/search` | `marketplace-search-page` | none | `search_public_professionals`, `get_public_currencies` | MIXED (R5) | WORKING |
| `/for-business` | `business-landing-page` | none | local pricing catalog | PRE-R5 | WORKING (overflow, §20) |
| `/features` | `features-page` | none | none — hand-written array | PRE-R5 | **VISUAL-ONLY / misleading** (§18) |
| `/pricing` | `pricing-page` | none | `lib/commerce/*` | PRE-R5 | WORKING (catalog conflict, §18) |

### Authentication

`/login`, `/register` (canonical customer); `/signup` → redirect; `/pro/login`, `/pro/register` (application grants nothing until approved); `/pro/signup` → redirect; `/pro/application`; `/auth/callback` (one OAuth return for all five doors); `/customer/login`, `/customer/signup` (legacy redirects); `/workspace`; `/forgot-password`, `/reset-password`, `/invite/:token`; `/platform/login`, `/platform/claim/:token`, `/platform/invite/:token`. All PRE-R5 or MIXED, all WORKING.

### Customer app (`/app/customer`, `RequireAuth` → `CustomerShell`)

| Route | Component | Backend deps | Realtime | Origin | Status |
|---|---|---|---|---|---|
| `/app/customer` | `customer/discover-page` | `get_my_*`, marketplace | via notifications | **R5** | WORKING |
| `/app/customer/search` | `customer/search-page` | `search_public_professionals` | no | **R5 (new)** | WORKING |
| `/app/customer/onboarding` | — | — | no | PRE-R5 | WORKING |
| `/app/customer/profile` | `customer-profile-page` | `customer-profile.ts` | no | MIXED | WORKING |
| `/app/customer/appointments` | — | `useMyAppointments` | INSERT on `notifications` | PRE-R5 | WORKING |
| `/app/customer/favorites` | — | `get_my_favorites` | no | MIXED | WORKING |
| `/app/customer/passport` | `customer-passport-page` | `passport.ts` | no | MIXED | WORKING |
| `/passport/shared/:token` | `passport-share-view-page` | `get_shared_passport` | no | PRE-R5 | WORKING (public, noindex) |

### Public booking / shop (`/s/:slug`) — the conversion core

| Route | Component | Auth | Backend deps | Origin | Status |
|---|---|---|---|---|---|
| `/s/:slug` | `public-booking-page` | **none** | `get_public_available_slots`, `book_public_appointment` | MIXED | WORKING **[browser]** |
| `/s/:slug/profile` | `shop-profile-page` | none | org projection | **R5** | WORKING **[browser]** |
| `/s/:slug/barbers/:barberId` | `public-barber-page` | none | `get_public_barber`, `get_public_service_state` | **R5** | WORKING |
| `/s/:slug/walk-in` | `public-walkin-page` | none | `join_public_queue` | PRE-R5 | WORKING (i18n defect, §11) |
| `/s/:slug/display` | `public-queue-display-page` | none | `get_public_queue_status` (6s poll) | PRE-R5 | WORKING (i18n defect, §11) |

> **R-1 (HIGH).** The public professional profile exists **only** at `/s/:slug/barbers/:barberId` — a sub-resource of an establishment. There is no standalone barber URL. In a product whose identity is *social-first discovery*, a professional is not independently addressable or shareable; the shop's slug owns their identity. This is a structural obstacle to R6 (Public Profiles V2) and R7 (Social Graph). **[VERIFIED]**

### Professional app (`/app`, `RequireAuth` → `RequireProAccess` → `ProShell`)

`/app` (dashboard, **R5 heavily**), `/app/calendar`, `/app/appointments`, `/app/requests`, `/app/queue`, `/app/customers`, `/app/team`, `/app/team/:id/workspace`, `/app/locations`, `/app/chairs`, `/app/services`, `/app/availability`, `/app/waitlist`, `/app/memberships`. All WORKING.

> **R-2 (MEDIUM).** No `/app/analytics`, `/app/settings`, `/app/profile` or `/app/reviews` route exists, though `FRONTEND_SPEC.md` names analytics, profile, reviews and reputation as important professional areas. Analytics exists only as dashboard-embedded panels. A **gap, not a regression** — R14 will need these. **[VERIFIED]**

### Platform / admin

~35 routes across overview, applications, organizations, team, audit, plus `acquisition` (16), `outreach` (6), `data-science` (3). PRE-R5 apart from cosmetic edits. Out of R5R scope.

`*` → `not-found-page` — renders correctly and localized. **[browser]**

> **R-3 (LOW).** The customer app is namespaced at `/app/customer` while the professional app owns `/app`: the consumer product is a path-child of the operations product. No routing bug (static segments rank first), but the URL hierarchy inverts the product hierarchy. **[VERIFIED]**

---

## 6. Shell / Navigation Architecture

**[VERIFIED]** — both shells read in full.

**`CustomerShell`** (147 lines): light via `data-fu-customer`. Mobile: 4 tabs (Discover · Search · Appointments · Profile) with a prominent centre BOOK opening `BookSheet`. Desktop: header nav with BOOK as a real button — same five destinations, same order, not the bar stretched. `max-w-5xl`, `pb-24` clearing the tab bar.

**`ProShell`** (193 lines): `data-fu-pro`. Desktop: persistent sidebar + topbar + command menu. Mobile: 4 tabs + raised quick-action. `max-w-[100rem]`. **The shell owns the measure** — pages do not each wrap themselves in their own container, which the source notes is "most of why V1 read as a set of screens rather than one application."

**This is the strongest visual work in R5.** Both make the correct mobile-vs-desktop decision. The `data-fu-*` attribute scoping means one primitive library serves two palettes with no parallel component set. Hooks are ordered before early returns, with a note that a conditional hook was a real prior crash.

**Classification: KEEP (both).** R5R.2 should refine, not replace.

> **S-1 (MEDIUM).** The centre BOOK is the most prominent control in the customer product, but `BookSheet` makes **zero booking decisions** — it routes to Rebook / Favourites / Search. For a new account it shows one line of text and a Search button. The source reasoning is sound (refusing to guess a shop, refusing to invent ranking); the outcome is that BOOK's prominence is unearned for new users. **[VERIFIED]**

> **S-2 (MEDIUM).** The customer mobile header is 64px (`customer-shell.tsx:82`, `h-16`) and, on a phone, contains only a logo plus `NotificationBell`, `LanguageSwitcher` and `ThemeToggle` — the nav and the desktop Book button are both `hidden … md:`. Language and theme are settings-screen concerns. Combined with the tab bar (`tab-bar.tsx:160`, `min-h-14` = 56px, plus `pb-[env(safe-area-inset-bottom)]`), permanent chrome consumes at least **120px of an 844px viewport (~14%)** before any content. `DESIGN_SYSTEM.md:112-116`: "Do not copy desktop navigation onto mobile." **[VERIFIED]**

---

## 7. Design-System Inventory

**[VERIFIED]** — `index.css` is 1,093 lines with four `@theme` blocks and 225 custom properties.

### The core finding: a design system the product does not use

The token *layer* is thoughtfully argued in its own comments. The product does not consume it.

| Token | Stated purpose | Uses outside `index.css` |
|---|---|---|
| `--fu-control-xl` (64px) | *"the BOOK action"* | **0** — BOOK never reaches its own declared size |
| `--fu-z-base/raised/overlay/sheet/toast` | so *"a sheet covers the tab bar… a toast covers everything"* | **0** on the overlay primitives |
| `--text-display`, `--text-body` | display/body roles | **0** |
| `--text-kpi` | so KPIs stop *"independently choosing their own size"* | **3** — and **not** in `Metric`, the KPI primitive itself |
| `--fu-icon-xs/sm/md/lg` | icon scale | **0** — every icon is a raw `h-4 w-4` |

**Semantic typography adoption: 20 uses vs 848 raw numeric utilities across 151 files (~2.3%).** (Recounted during review; the earlier figure of 832 was slightly low. The semantic count of 20 is exact: `display` 0, `body` 0, `kpi` 3, `title` 1, `heading` 2, `caption` 9, `label` 5.) There are two typography systems and the raw one governs the product. **[VERIFIED]**

**The z-layer system is bypassed by every primitive it was written for.** `dialog.tsx:15,50`, `drawer.tsx:14,40`, `bottom-sheet.tsx:32,37`, `dropdown-menu.tsx:18`, `tooltip.tsx:21` all use raw `z-50`; `toast.tsx:98` uses `z-[100]`. Because a sheet's overlay and content are both `z-50`, and tooltips and dropdowns are too, the declared covering order resolves by DOM order instead. The exact bug class the block exists to prevent is unguarded. **[VERIFIED]**

### The radius scale is broken — [VERIFIED by arithmetic]

FadeUp overrides only four of Tailwind v4's eight radius steps (`index.css:169-172`); the rest remain live at their defaults (`node_modules/tailwindcss/theme.css:397-404`). I read both files and computed the effective scale:

| Utility | Effective value | Source |
|---|---|---|
| `rounded-sm` | 6px | FadeUp |
| `rounded-md` | 10px | FadeUp |
| `rounded-lg` | **16px** | FadeUp |
| `rounded-xl` | **24px** | FadeUp |
| `rounded-2xl` | **16px** | Tailwind default — **identical to `lg`** |
| `rounded-3xl` | **24px** | Tailwind default — **identical to `xl`** |

**`rounded-xl` (24px) is larger than `rounded-2xl` (16px).** A developer reaching for "one step rounder" gets one step squarer. Live consequence: `NowCard` uses `rounded-xl` = 24px (`now-card.tsx:91`) while `ProfileHeader` (`profile-header.tsx:60`) and `MarketplaceCard` (`marketplace-card.tsx:87`) use `rounded-2xl` = 16px — **the operational pro card is visually rounder than the flagship consumer conversion surface**, and neither file intended that.

**Blast radius — corrected during review.** My first pass said "91 times across 50 files". Recounted: `rounded-xl` **67**, `rounded-2xl` **11**, `rounded-3xl` **0** — **78 occurrences across 31 files**. Critically, the two *colliding* utilities are barely used: `rounded-3xl` has **zero** call sites and `rounded-2xl` only 11. So the trap is real and the fix is cheap, but the claim that "radius is not chosen intentionally anywhere" does not follow from this footprint. The correct framing: a latent configuration bug that will mislead the next developer, not a defect currently distributed across the product. **[VERIFIED]**

### Effective token counts — larger than they appear

| Category | FadeUp `@theme` | Tailwind defaults still live | Scoped palettes | Effective |
|---|---|---|---|---|
| Color | 35 | full Tailwind palette | dark 32, `[data-pro-marketing]` ~27, `[data-fu-pro]` ~38, `[data-fu-customer]` 1 | **~133 across 5 palettes** |
| Type sizes | 7 semantic | 13 numeric | — | **20** (2 exact duplicates: `--text-heading`≡`text-lg`, `--text-kpi`≡`text-3xl`) |
| Radius | 4 | 4 | 5 `--pro-r-*` | **13 names → 11 values** |
| Shadow | 4 | 3 | 4 glass | **11** |
| Motion | 3 durations, 2 easings | Tailwind | 11 `@keyframes` | 5 tokens |

**Correction to a first impression:** counting only FadeUp's declared tokens (4 radius, 4 shadow, 3 duration) suggests admirable restraint. That reading is wrong. Because Tailwind's defaults are never blocked, the *effective* system is roughly three times larger and internally contradictory.

### Five parallel theming mechanisms **[VERIFIED]**

1. `:root[data-theme='dark']` — the real user-facing dark mode.
2. `[data-pro-marketing]` — forces `/for-business` permanently dark and **rebinds `--font-display` to sans**, removing the editorial serif on that route only.
3. `[data-fu-pro]` — forces the **entire professional application** permanently dark (`color-scheme: dark` at `index.css:859`; applied at `pro-shell.tsx:109`).
4. `[data-fu-customer]` — a green gradient wash.
5. `[data-pro-marketing] .pro-light` — a light island inside #2.

> **T-1 (HIGH).** `ThemeToggle` is rendered in the pro top bar (`pro-topbar.tsx:104`) but `[data-fu-pro]` re-declares the palette on a descendant of `:root`, so it overrides whatever the toggle sets. **A control that is present, focusable, labelled and has no effect on its own surface.** Structurally verified by cascade; visual confirmation deferred to R5R.1 browser QA. **[VERIFIED structurally / INFERRED visually]**

> **T-2 (HIGH).** A permanently-dark professional app contradicts `DESIGN_SYSTEM.md:42` ("light-first"). This is an **unapproved R5 visual assumption** and needs an explicit product decision, not a silent inheritance.

> **T-3 (MEDIUM).** The dark-completeness gate does not test what its name says. `design/tokens.test.ts:139` is titled "every @theme colour is re-stated for dark mode", but its regex `/--color-([a-z]+)-(\d{1,3}):/g` only matches tokens with a **numeric step**. `--color-border`, `--color-on-accent`, `--color-on-forest` and others are invisible to it; `--color-on-forest`/`-dim` are in fact never restated for dark, and the gate passes. **[VERIFIED]**

> **T-4 (HIGH) — found during independent review; I missed it. Every overlay in the professional application renders in the light palette.**
> `pro-shell.tsx:109` applies `data-fu-pro` to a `<div>`, **not to `:root`**. All five overlay primitives mount to `document.body` through a Radix `Portal` with **no `container` prop** — `dialog.tsx:40`, `bottom-sheet.tsx:31`, `dropdown-menu.tsx:12`, `tooltip.tsx:12`, and `toast.tsx:98`'s `Viewport`. A portalled node is therefore a sibling of the themed `<div>`, not a descendant, and never inherits its token overrides.
> Measured in the browser against the compiled stylesheet — a node inside `[data-fu-pro]` versus a sibling appended to `document.body`:
> ```
> insidePro:      --color-paper-0 #0e1512   --color-ink-950 #e9f1ec   --color-on-accent #06120c
> portalSibling:  --color-paper-0 #ffffff   --color-ink-950 #0e1613   --color-on-accent #ffffff
> ```
> **Every dialog, bottom sheet, dropdown, tooltip and toast in the pro app is light-palette chrome floating over a near-black application** — including the pro topbar's own account dropdown (`pro-topbar.tsx:106`). The same mechanism breaks `[data-pro-marketing]` on `/for-business`.
> **This falsifies the in-source justification the audit initially endorsed** (`index.css:792-800`: "a Dialog written once against `bg-paper-0 / text-ink-950 / border-border`… renders dark in the Professional one, with no per-component branching"). It also means the `data-fu-*` attribute-scoping mechanism — which §6 calls the strongest visual work in R5 — **does not actually hold at the portal boundary.**
> **Consequence for classification:** `dialog`, `bottom-sheet`, `dropdown-menu`, `tooltip` and `toast` move from **KEEP** to **REUSE_LOGIC_ONLY** (§16). Their Radix wiring, focus trapping and scroll locking are correct; their theme scoping is not. **[VERIFIED — browser measurement + source]**

> **T-5 (MEDIUM) — found during review.** `segmented-control.tsx:52` hardcodes **`w-full`** in the primitive. This is the actual origin of the desktop-stretch defect (V-4), and it will reproduce in `time-slot-grid.tsx:90`, `service-mode-control.tsx:178` and `app-queue-page.tsx:246`. **Reclassified from KEEP-verbatim to REUSE_LOGIC_ONLY.** **[VERIFIED]**

### Measured element density at 390px **[VERIFIED in browser]**

| Route | Elements | Radius ≥10px | Shadowed | Bordered |
|---|---|---|---|---|
| `/features` | 143 | 24 | 9 | 33 |
| `/for-business` | 132 | 22 | 10 | 11 |
| `/pricing` | 95 | 20 | 2 | 20 |
| `/` | 79 | 12 | 2 | 15 |
| `/search` | 56 | 17 | 2 | 14 |
| `/s/:slug` (booking) | **19** | **4** | **0** | **3** |

Note the gradient: **marketing pages are the decorated ones; the booking wizard is the cleanest surface in the product.** The decoration problem is concentrated in marketing and profile surfaces, not the transactional core.

### Primitive classification

**Best-in-class — KEEP verbatim:** `time-slot-grid` (part-of-day split, 3-up at 375px, 44px targets — the strongest conversion primitive in the repo), `date-strip` (refuses hopeful availability dots), `segmented-control` (native radiogroup, RTL-correct), `availability-label` (R5 — four-state, renders nothing when unknown), `realtime-value` (R5 — tint-not-pulse, first value never highlights), `verified-badge` (R5 — original mark, claim-state anchored), `avatar` (refuses to invent photography), `status-badge` (word + dot + tint), form primitives (`text-field`, `textarea`, `select-field`, `switch`), `table`, `tabs`, `alert`, `error-state`, `container`, `spinner`, `dialog`, `bottom-sheet`, `tooltip`, `dropdown-menu`, `card`, `badge`.

**REUSE_LOGIC_ONLY:** `follow-control` (bilingual grid-stacked label is excellent; `rounded-full` + `shadow-sm` inverts the Book/Follow hierarchy), `metric` (value→label→context and the no-delta refusal are right; `text-2xl` bypasses `--text-kpi`, and `MetricTile`/`MetricStrip` add card chrome), `tab-bar` (in-flow `ProminentTab` lift is genuinely good; active-state contrast fails), `sticky-book-bar` (sticky-not-fixed reasoning is correct), `marketplace-card` (expand-in-place `grid-rows-[0fr→1fr]` and lazy `TeamPanel` mount are excellent; card shape is R5), `dashboard-grid` (keyboard-move-is-the-only-mechanism is exemplary a11y), `queue-entry-card` (one-tap-per-status is right for barbers), `now-card` (ref-not-state timer must survive).

**REBUILD:** the radius scale; the typography layer; the z-layer enforcement; `profile-header` (card wrapper + decorative gradient + Follow-above-Book — three spec conflicts in 118 lines); `service-mode-ctas` **styling only** (preserve the service-mode logic verbatim — it is R4 contract work); `empty-state` (dashed-box + generic-icon vocabulary; `action` must not be optional); `dashboard-page` composition; the customer mobile header; `passport-card` (two stacked gradients + shadow + accent border — keep every word of its data-honesty reasoning).

**LEGACY — do not build on, do not delete yet:** `navbar` (one consumer, stale doc comment); the entire `[data-pro-marketing]` block (~345 lines, 32% of `index.css`, serving one route); `business-landing-page` and `components/for-business/*`; `business-listing-card`.

**REVIEW:** `[data-fu-pro]` forced dark (T-2); `[data-fu-customer]` wash — discovery-only as its own comment argues, or shell-wide as implemented?; the teal `--color-success-600` ("success is teal" is a strong identity choice needing approval); `dashboard-grid` + `organization_dashboard_layouts` (§13); `passport-card`; `command-menu`; `quick-action-sheet`.

---

## 8. Data / Query Architecture

**[VERIFIED]**

- **One Supabase client**, anon key only, lazily constructed. Enforced by `lib/browser-credentials.test.ts`, which fails if a second `createClient(` appears anywhere under `src/` or if any bundled file references `SERVICE_ROLE`/`SECRET_KEY`/`DB_PASSWORD`. **A structural guarantee, not a convention.**
- **The RPC-vs-table split tracks the authorization boundary.** Anon surfaces are RPC-only (RLS grants `anon` no SELECT, so an RPC is the only path); authenticated org-scoped surfaces use `.from()` where RLS suffices and RPCs where joins, derived state or privileged writes are needed. ~90 distinct RPCs.
- **Components perform data access in exactly one place.** `getSupabaseClient` is imported in ~86 files; outside `lib/` almost every call site is a Supabase **Auth** call (`signIn`/`signUp`/`signOut`/`resetPasswordForEmail`). **Corrected during review:** there is one genuine exception — `pages/onboarding-page.tsx:287` calls `supabase.rpc('complete_organization_onboarding', …)` directly inside a `useMutation`, bypassing `lib/queries/*`. One violation across the whole tree is a strong result, but the earlier absolute ("never") was wrong, and this is a query-layer bypass that §4's duplication table should list. **[VERIFIED]**
- **Defaults:** `staleTime: 30_000`, `retry: 1`. All 10 `refetchInterval` overrides live in `lib/queries/*`, none in components.
- **Exactly one optimistic mutation**, deliberately (`useMarkNotificationRead`), with correct rollback.
- **Zero per-row `useQuery`** anywhere in `pages/` or `components/`.

> **D-1 (MEDIUM).** Query-key conventions are split: `acquisition/*` and `platform.ts` namespace consistently; most domain modules use flat keys. No collision today, but no enforced convention either, and R5R will add surfaces. The exported key-builder pattern (`bookingRequestsKey`, `customerProfileQueryKey`) is the one to standardize on. **[VERIFIED]**

> **D-2 (LOW).** `passport.ts:118-140` issues one `createSignedUrl` per photo inside `Promise.all` — parallel, but N round-trips where Storage offers a batch API. **[VERIFIED]**

> **D-3 (LOW).** `acquisition/overview.ts:88-103` fires ~10 count-only queries in one `queryFn` rather than one aggregate RPC. Internal admin, bounded. **[VERIFIED]**

---

## 9. Auth / Permission Boundaries

**[VERIFIED]** — `require-pro-access.tsx` read in full.

The frontend does **not** treat hidden UI as authorization and says so in its own source: *"This is a redirect for the sake of the person using it, NOT the security boundary. The real enforcement is in the database: an applicant holds no membership, every tenant table is RLS-scoped to memberships, and `create_organization` refuses callers with a pending or rejected application."*

| Boundary | Mechanism | Assessment |
|---|---|---|
| Public vs authenticated | `RequireAuth`, per-door `loginPath` | Correct |
| Customer vs professional | separate doors; `RequireProAccess` on `/app` | Correct |
| Organization membership | `useResolvedOrganization` + RLS-scoped tables | Correct |
| Platform/admin | `RequirePlatformRole`, unlisted login | Correct |
| OAuth | one `/auth/callback` for all five doors | Correct — three callbacks would mean three implementations of "who is this", which is how a platform door ends up weaker than a customer one |
| UI role gating | `MANAGING_ROLES`, `canManageServiceMode` | Commented as UX-only; server enforces regardless |
| Readiness | `get_organization_readiness` — server's answer, never a local flag | Correct |

**No dangerous ambiguity found in the boundary itself. No escalation to `fable-critical` was warranted.**

> **Scope limit, added during review.** This audited *where* the boundary sits, not *what it renders when it fails*. That distinction produced a real miss:

> **A-2 (LOW).** `routes/require-platform-role.tsx` renders the raw Supabase error string to the user (`` `Couldn't check platform access: ${roleQuery.error.message}` ``) on the most privileged door in the product — low-severity information disclosure, and untranslated (§11, I-1). The guard's *logic* is correct: it checks the session, then `useOwnPlatformRole`, and deliberately does not redirect into `/app`. Only its failure-state rendering is at fault. **[VERIFIED]**

> **A-1 (LOW / latent).** `shop-profile-page.tsx:224-235` renders the sticky Book bar **unconditionally** ("a shop's bookability is unconditional"), with no service-mode check — unlike `public-barber-page.tsx:322`, which gates on `bookingAcceptingNewEntries`. Safe today because every marketplace organization is a claimed tenant. It is the one Book CTA not gated on real backend state and should not be inherited unexamined by R6. **[VERIFIED]**

---

## 10. Realtime Architecture

**[VERIFIED]** — `lib/realtime.ts` and its test read in full (working-tree content).

`useRealtimeInvalidation` is the single shared hook. Invariants, all sound:

1. **Never trusts the payload** — every event invalidates; the authoritative read is the RPC refetch, because the RLS-filtered row shape is not the authorization-curated shape the RPC returns.
2. **Per-mount unique channel topic** — survives `removeChannel()`'s async leave-ack, preventing "cannot add postgres_changes callbacks after subscribe()" on fast remounts and tenant switches.
3. **Reports status** (`connecting`/`live`/`offline`); force-invalidates once on `SUBSCRIBED` to close the disconnected gap.
4. **`filter` narrows traffic, never authorizes** — RLS is the boundary.
5. `pollingInterval(status)` — 120s live, 20s offline/connecting.

Its tests reproduce the real historical race (registry reuse, async `removeChannel`, stale cross-generation callbacks) rather than stubbing convenience.

**Genuine subscribers:** `useOrgQueue` (`queue_entries`), `useNotifications` and `useMyAppointments` (`notifications` INSERT), `usePlatformNotifications`, `useBookingRequests` (`appointments`), `useCalendarRange` (`appointments` + `time_blocks` on one shared channel — deliberately, to avoid doubling reconnects), `useServiceModeState`.

**Polls by design, correctly:** `usePublicQueueStatus` (6s), `usePublicServiceState` (120s), `useMyQueueStatus` (20s), `useMyProfessionalApplication` (30s while pending). All anon or near-anon surfaces where `anon` holds no SELECT, so Postgres Changes has nothing to deliver. Documented in-source as intentional.

> **RT-1 (MEDIUM).** `useOrgQueue` (`queue.ts:100-122`) calls `useRealtimeInvalidation` but **never captures its return value** and sets no `refetchInterval`. Every comparable surface captures `realtimeStatus` and wires `pollingInterval(realtimeStatus)` — `realtime.ts:176-185` states "THE FALLBACK MATTERS AS MUCH AS THE SUBSCRIPTION." `/app/queue` is the professional live-queue board: a silently-dropped websocket leaves it looking live and simply not updating. The 30s `staleTime` does not itself trigger a background refetch without focus/mount/interval. **[VERIFIED]**

> **RT-2 (LOW).** `usePlatformNotifications` has the identical gap. **[VERIFIED]**

> **RT-3 (LOW).** `realtime-value.tsx` holds no subscription — it is a diff-highlight wrapper that flashes on *any* change, including manual refetches. Honest in its own comment, but the name invites the inference that a surface using it is live. **[VERIFIED]**

No duplicate or leaked subscriptions; `.channel(` appears only inside `realtime.ts`. **[VERIFIED]**

---

## 11. Localization / Country Architecture

**[VERIFIED]** — architecture strong; two real defects ship through a gap in its own guard.

10 locales (`ar de en es fr it ja pt ru zh-CN`) × 10 namespaces. `i18n/index.ts:179` sets `document.documentElement[dir]` via `isRtl(lng)`. Structural suite: `direction.test.ts`, `locale-completeness.test.ts`, `logical-properties.test.ts` (fails on physical `left-`/`ml-` utilities that would not mirror), `no-browser-locale.test.ts`, `no-hardcoded-strings.test.ts`, `no-untranslated-status-maps.test.ts`, `terminology.test.ts`. R5 added a country override with tests. RTL is treated as first-class, including `--fu-dir` and a note in `dialog.tsx:46-49` on when a *physical* property is correct.

Runtime confirmation: with `locale: 'en-US'` requested, the app auto-selected **French** and rendered `PRENDRE RENDEZ-VOUS`, `Choisissez une prestation`, `Étape 1 sur 3`, `Page introuvable`, and `25,00 €`. Detection, translation and international formatting all work. **[VERIFIED in browser]**

> **I-1 (HIGH). User-facing English ships inside a French page, and the guard that exists to prevent it passes.**
> Observed at 390px on `/s/side-agency/walk-in`: beneath a fully French form (`Nom complet`, `Numéro de téléphone (facultatif)`, `S'enregistrer`) sits *"You'll join the walk-in line right away — no appointment needed."*
>
> - `pages/public-walkin-page.tsx:289` — written with an `&apos;` HTML entity
> - `pages/public-queue-display-page.tsx:192` — `{entry.status === 'in_service' ? 'In chair' : 'Called'}`
> - Also `friendlyWalkinError()` (`public-walkin-page.tsx:38-52`) and the walk-in `SuccessScreen`
> - **Third violation, found during review:** `routes/require-platform-role.tsx` ships two bare English strings — `` `Couldn't check platform access: ${roleQuery.error.message}` `` and `"This account doesn't have FadeUp platform access."` — on the most privileged auth-boundary surface in the product, and in `routes/` rather than `pages/`. It also renders the raw Supabase error message to the user, which is low-severity information disclosure. See A-2 in §9.
>
> **Root cause — corrected during review.** My first pass attributed the gap to line 81 "excluding `pages/app-*` and `pages/platform-*`". That reading was wrong: line 81 is the *complement* of a three-way partition (the other two buckets are asserted at lines 61-68 and 71-78), so nothing is excluded there. The real exclusion is the **`EXEMPT` array at lines 33-41**: `platform-acquisition-`, `platform-outreach-`, `platform-data-science-`, `components/acquisition/`, `components/marketing/product-previews`, **`components/for-business/`**, `components/brand/`.
> That last entry matters beyond i18n: **F-6's uncaptioned fake queue lives in `components/for-business/`**, so the same exemption that hides untranslated strings also hides fabricated-data copy from review.
> The detector was then executed directly against the offending files and returned `[]` for all three, confirming the blind spots are in the heuristic itself, not only in the exemption list.
>
> **A fourth violation and a third blind spot, both found during review.** With `<html lang="fr">`, **`/features` renders "Skin fade + beard", "In chair" and "Started 4 min ago" in English** — verified in the browser on a route this audit had already loaded and failed to inspect for i18n. Source: `components/marketing/product-previews.tsx:57` (and `:141`).
> Reading `scripts/find-hardcoded-strings.mjs` explains why it is invisible: the detector matches only **(a)** JSX text nodes, **(b)** a whitelist of user-facing props (`USER_FACING_PROPS` at line 38, matched by the `propPattern` at line 121), and **(c)** `toast`/`setError` payloads (line 154). **String literals inside object and array data structures that are later rendered are matched by none of the three.**
>
> So the guard has three blind spots, not two: (a) HTML entity escapes such as `&apos;`, (b) literals inside JSX ternary expressions, and (c) **literals inside rendered data structures**. The §25 criterion has been widened accordingly — the original wording would have fixed the walk-in page and still shipped `/features`. **The guard's existence has been mistaken for coverage.** **[VERIFIED — code, guard executed directly, and browser]**

---

## 12. R5 Change Forensics

**[VERIFIED]** — from `git diff ba1eede..HEAD`, inspecting changes rather than filenames.

**A. Database/contracts** — 2 migrations, both deployed live, plus `MASTER_R5` (712 lines) and `VERIFY_R5` (468 lines). See §13.
**B. Data access** — new `analytics-summary.ts`, `dashboard-layout.ts`; modified `marketplace.ts` (map/sort/coords), `public-barber.ts`. Additive.
**C. Design system** — `index.css` substantially rewritten; `design/tokens.test.ts`, `design/accessibility.test.tsx` added; new primitives `availability-label`, `follow-control`, `realtime-value`, `verified-badge`; modified `button`, `metric`, `tab-bar`, `toast`.
**D. Navigation/shell** — `customer-shell.tsx` +92: Discover/Search split, Passport moved out of the tab bar into Profile, centre BOOK added, desktop header nav. `router.tsx` +10.
**E. Marketplace** — new `marketplace/` directory (`marketplace-card`, `marketplace-results`, `results-map`, `inline-booking-sheet`). The most substantial R5 frontend addition, including the 3-tap inline booking path.
**F. Public profiles** — `public-barber-page.tsx` +189, `shop-profile-page.tsx` +122, new `profile-header.tsx`, `sticky-book-bar.tsx`.
**G. Pro dashboard** — `dashboard-page.tsx` +381 (largest single-file change); new `dashboard-grid`, `customers-panel`, `social-performance-panel`.
**H. Accessibility/responsive** — `design/accessibility.test.tsx` added.
**I. Realtime** — `realtime-value.tsx` (presentation only). No architectural change in the committed range.
**J. Localization/country** — `lib/intl/country-preference.ts` + field; **all 10 locales updated across 6 namespaces**. Translation coverage was maintained across the whole R5 surface, in every locale.
**K. Tests** — 10 new test files. R5 shipped with tests.
**L. Documentation** — `R5_EXPERIENCE_FOUNDATION.md` (443 lines), `ROADMAP.md`, `CUSTOMER_API_FREEZE.md` +59.

| Area | Backend-required? | Technically useful? | Visually rejected? | Safe to preserve? | Coupled to rejected design? |
|---|---|---|---|---|---|
| Marketplace RPC (map/sort) | Yes | **Yes** | No | **Yes** | No |
| Dashboard-layout table | No | Partly | **Yes** | Yes (dormant) | **Yes** |
| Design tokens | No | Gate yes, scale no | **Yes** | Gate yes | Application yes |
| Shell/nav | No | **Yes** | No | **Yes** | No |
| Marketplace UI + inline booking | No | **Yes (logic)** | **Yes (visual)** | Yes | Partly |
| Public profiles | No | Partly | **Yes** | Yes | **Yes** |
| Pro dashboard | No | Partly | **Yes** | Yes | **Yes** |
| i18n / country | No | **Yes** | No | **Yes** | No |
| Tests | No | **Yes** | No | **Yes** | Some assert rejected layout |

---

## 13. R5 Technical Contracts Worth Preserving

**[VERIFIED]** — DDL read directly; live DB queried read-only. **No migration was reverted, altered or re-run.**

### `search_public_professionals` — **Class A: KEEP AS-IS**

R5 dropped the 13-argument signature and created a 14-argument one adding `p_sort text default 'recommended'`. The drop is *required* so Postgres does not keep both and make a 13-arg call ambiguous once the trailing default applies; the new argument is **trailing with a default, so every existing call site keeps working**.

Returns real conversion fields: `latitude`, `longitude`, `distance_km`, `starting_price_cents`, `is_open_now`, `queue_waiting_count`, `total_count`.

**Evidence for keeping:** these are precisely the fields `BOOKING_UX.md` asks discovery cards to surface. The contract is *ahead* of the UI, not captive to it. `queue_waiting_count` is real queue data in search results. Grant is scoped, not blanket. **Independent of the rejected visuals; R5R should consume it more, not less.**

### `organization_dashboard_layouts` — **Class C: NEEDS REVIEW**

A new table storing per-organization dashboard module ordering, with `private.valid_dashboard_module_keys(text[])` validating keys, RLS `enable` **and** `force`, four policies, an `updated_at` trigger, and column-scoped `grant update (module_order, updated_by)` — a deliberately narrow write surface.

**The engineering is careful and correct.** The concern is scope: it persists the arrangement of **the rejected R5 dashboard**, and its valid module keys are defined by that dashboard's composition. If R5R.4/R14 rebuilds the dashboard around different modules, stored `module_order` values become meaningless and the key function needs redefinition.

**Recommendation: do not revert.** It is additive, RLS-forced and harmless while dormant. Defer to the lot that rebuilds the dashboard. Reverting now would delete correct, deployed, well-secured work to solve a problem that does not yet exist — and `CLAUDE.md` explicitly forbids deleting deployed database work merely because its frontend was rejected.

| Contract | Class | Rationale |
|---|---|---|
| `search_public_professionals` (14-arg) | **A — KEEP AS-IS** | Real conversion data; backward-compatible; under-consumed |
| `results-map` coordinate consumption | **B — KEEP, new consumption** | Coordinates real; map UI should be rebuilt around them |
| `get_organization_analytics_summary` | **B — KEEP, new consumption** | Server-computed; `bookingConversionRate` never recomputed client-side |
| `organization_dashboard_layouts` | **C — NEEDS REVIEW** | Sound engineering; keys coupled to rejected dashboard |
| `private.valid_dashboard_module_keys` | **C — NEEDS REVIEW** | Same coupling |
| — | **D / E** | **No obsolete frontend-only assumption and no unsafe contract found in R5 DB work** |

---

## 14. R5 Frontend / Design Problems

Each finding ties to usability, conversion, trust, mobile quality or hierarchy — not preference.

> **V-1 (BLOCKER). Book is not the dominant CTA on the booking surface.** Three mechanisms demote it on `/s/:slug/barbers/:barberId` — one of them a documented trade-off rather than an oversight.
> **Verification scope, corrected during review: this finding is CODE-verified, not browser-verified.** `/s/:slug/barbers/:barberId` was not among the 13 routes loaded (it needs a barber id, and the seeded tenant's single barber was reached only via `/search`). The mechanisms below are read from source and are individually exact; the *rendered* claims — "Follow renders above Book", "the page's only shadow" — follow from that source but were not observed. Confirm visually in R5R.1. **[VERIFIED in code / INFERRED in render]**
> **(i)** Follow renders *above* Book — `public-barber-page.tsx:231-261` passes Follow to `ProfileHeader`'s `actions` slot and Book to `meta`; `profile-header.tsx:108-110` renders `actions` first. **Qualified during review:** this placement is *deliberate*, carrying an 11-line comment explaining that an unconditional Book would offer a reservation to a walk-in-only barber, and that the intended order is "identity, credibility, Follow, Book". The visual outcome is still wrong, but the fix is not "swap the slots" — it requires moving `ServiceModeCtas` (which carries the service-mode gating) into `actions`, preserving that gating intact. Treating this as a careless ordering bug would break a real R4 contract.
> **(ii)** Follow carries elevation, Book does not — `follow-control.tsx:66-67` is `rounded-full … shadow-sm`; `button.tsx:51` primary has no shadow, while `button.tsx:58-62` states elevation is "the axis that separates BOOK from primary once both are wearing the accent." **The only elevated control on the page is the social action.**
> **(iii)** The in-page Book never uses the `book` variant — `service-mode-ctas.tsx:78` calls `buttonVariants({ size: 'lg' })`, defaulting to `primary`. The `book` variant appears only in the sticky bar, itself conditional.
> **Impact:** conversion and trust. `DESIGN_SYSTEM.md:120-126` and `FRONTEND_SPEC.md:100-104` require Book dominant and Follow secondary. Three button shapes coexist in one viewport, which reads as assembled rather than designed. **[VERIFIED]**

> **V-2 (BLOCKER for a social-first product). The customer product contains no imagery.** On `/s/side-agency/profile` at 390px the header is an **empty pale-green gradient band**; the shop is an `SA` monogram; the only team member is `BT`. On `/search`, both results are monograms. There is no portfolio, shop photograph or work imagery on any customer surface.
> **Impact:** `FRONTEND_SPEC.md` — "Barber work is visual… Do not bury professional work inside tiny dashboard-style cards." A barber cannot be chosen on the evidence of a two-letter monogram. This removes the primary trust and desire signal from a product whose identity is *social-first discovery* — the difference between a directory and a social marketplace. **[VERIFIED in browser]**

> **V-3 (HIGH). Nested-card syndrome, explicitly forbidden by spec.** The shop profile is a stack of discrete bordered, rounded, shadowed white cards on grey. The `/app` dashboard nests further: `main` → `DashboardGrid` `section` → `Panel` (border + header rule + footer rule) → rounded rows. At 390px, `lg:grid-cols-2` collapses to one column, producing a vertical stack of six bordered boxes; `main px-4` plus Panel chrome leaves ~324px of content width.
> **Impact:** `DESIGN_SYSTEM.md:82-88` — "Do not wrap every section inside a card… Avoid nested-card syndrome… Prefer layout, spacing and typography before borders." Uniform card treatment flattens hierarchy: Book CTA, address and team roster all carry identical weight. **[VERIFIED — code and browser]**

> **V-4 (HIGH). Desktop stretches controls to the full measure, and the cause is a primitive, not the page.**
> **Corrected during review.** My first pass estimated the `Liste | Carte` toggle at ~1330px and CTAs at ~1100px from a screenshot. Programmatic measurement refutes both: the `[role="radiogroup"]` is **960px** and the widest CTA **802px**, and both stay constant at 1280px, 1440px and 1600px viewports because `/search` is wrapped in `<Container size="lg">` (`marketplace-search-page.tsx:42`), a **1024px** cap. Nothing on that page reaches 1330px at any width.
> The defect is real but differently located: a two-option toggle occupying **960px** is still absurd, and the reason is that `segmented-control.tsx:52` hardcodes **`w-full`** in the primitive itself. The same default will stretch `time-slot-grid.tsx:90`, `service-mode-control.tsx:178` and `app-queue-page.tsx:246`.
> **Impact:** `DESIGN_SYSTEM.md:206-211` — "Do not simply stretch mobile components to 1440px." A measure cap *does* exist, so the earlier "pages have no desktop layout" framing was too broad. The accurate statement is that the measure is 1024px and the controls inside it are width-greedy **by primitive default**. Results still render as a single column with no grid and no list-beside-map. **[VERIFIED — programmatic measurement + source]**

> **V-5 (HIGH). Duplicated primary CTA competing with itself.** On the shop profile at 390px, **`Réserver` renders twice simultaneously** — header card and sticky bottom bar — both green, both prominent, both visible without scrolling.
> **Impact:** two identical dominant CTAs create hesitation rather than emphasis, and waste the sticky bar's purpose, which is to appear once the header CTA has scrolled away. **[VERIFIED in browser]**

> **V-6 (MEDIUM). Three overlapping save/relationship affordances.** The profile header carries `Réserver`, `Suivre` **and** a separate heart. `FRONTEND_SPEC.md` defines exactly two CTAs.
> **Impact:** Follow and Favourite are adjacent to a user ("save this shop") but structurally different in the backend (`follow_organization` vs `favorite_shop`). Presenting both pushes a database distinction onto the customer — exactly what `BOOKING_UX.md` warns against: "The user should not have to understand FadeUp's database structure." **[VERIFIED in browser]**

> **V-7 (MEDIUM). Discovery omits conversion data the backend already returns.** Cards show name, location, open/closed and "À partir de 25 €" — but not distance, next availability or queue state, though `search_public_professionals` returns `distance_km`, `is_open_now` and `queue_waiting_count`.
> **Impact:** `BOOKING_UX.md` — "The customer should not always need to open a profile merely to discover that no useful slot exists." The R5 RPC solved this; the R5 UI did not consume it. **A rebuild opportunity requiring no new backend work.** **[VERIFIED]**

> **V-8 (MEDIUM). Decorative gradients on conversion and identity surfaces.** Five gradients, four decorative: `profile-header.tsx:67-75` (96–112px of zero-information gradient atop the primary conversion surface, pushing Book below the fold); `business-listing-card.tsx:93`; `passport-card.tsx:60,68` (**two stacked gradients plus `shadow-sm` plus `border-accent-200` plus `rounded-2xl`** on one card); `now-card.tsx:98-101`, whose comment claims it is "the only decorative gradient in the Professional product" while being one of five app-wide.
> **Impact:** `REFERENCE_PRODUCTS.md:81-84` names "unnecessary gradients" as an AI cliché to avoid. Costs vertical budget above Book and reads as template. **[VERIFIED]**

> **V-9 (MEDIUM). Glassmorphism and glow, explicitly on the reject-on-sight list.** `index.css:634-775` defines a **four-variant glass system** with `backdrop-filter: blur(18px)`, an inner-highlight `::after`, and an **emerald bloom** (`0 0 60px -18px …`), plus `.pro-glow` and `.pro-ambient` radial utilities. The comments pre-argue restraint, but a four-variant glass vocabulary plus two glow utilities is a *system for* glow. Scoped to `/for-business`, which limits blast radius. **[VERIFIED]**

> **V-10 (MEDIUM). Marketing typography intrudes on operational surfaces.** `/search` opens with a two-line headline plus a three-line paragraph; results begin below the fold at 390px. `DESIGN_SYSTEM.md:74-78` — "Avoid giant marketing headings inside operational product flows." **[VERIFIED in browser]**

> **V-11 (MEDIUM). Unstyled native `<select>` inside a custom design system.** The `Trier / Recommandé` sort control is a raw OS `<select>` beside the custom `Liste | Carte` segmented control, breaking coherence at the moment the user ranks results and inheriting an OS dropdown that cannot match the system's touch-target or focus treatment. **[VERIFIED in browser]**

> **V-12 (MEDIUM). Section heading truncates at 390px.** `COIFFEURS PRÈS DE FRANCE` renders as **`COIFFEURS PRÈ…`**; the filter chip row clips at the right edge. A real long-translation defect on the primary discovery surface. **[VERIFIED in browser]**

> **V-13 (MEDIUM). Decoration causes horizontal overflow.** `/for-business` overflows at **both 390px and 430px**; the offender is `div.pro-ambient inset-0 scale-125 opacity-70`, reaching `right=419` in a 390px viewport and `right=464` at 430px. A purely decorative layer, scaled 125%, breaks horizontal containment. The other 12 routes show no overflow at any width. **[VERIFIED in browser]**

> **V-14 (MEDIUM). A user-rearrangeable widget grid is enterprise-BI chrome.** `dashboard-grid.tsx` implements drag-reorder, persisted layout and a "Rearrange" mode. `FRONTEND_SPEC.md:300-308` requires the dashboard to answer "What should I act on?" — a configurable widget grid explicitly **declines to answer that**, delegating prioritisation to the shop owner, as `dashboard-page.tsx:346-347` states outright. A barbershop OS should know that NOW outranks social analytics. **[VERIFIED]**

> **V-15 (LOW). Low-contrast wordmark.** In the public booking header the `FadeUp` wordmark renders as very pale grey on white. Flagged for measurement in R5R.1 — I did not compute this specific ratio. **[VERIFIED visually / ratio INFERRED]**

### What the browser did **not** show

No console errors, no uncaught exceptions, no 4xx/5xx, no missing assets, no broken navigation, no dead CTAs across 39 route×viewport combinations. **The rejected design is not a broken application.** **[VERIFIED]**

---

## 15. Legacy vs R5 Overlap

| Surface | Legacy / Pre-R5 | R5 | Both live? | Note |
|---|---|---|---|---|
| Result card | `business-listing-card` (196L) | `marketplace-card` (315L) | **Yes** | Discover legacy, Search R5 |
| Booking | `public-booking-page` (1,097L) | `inline-booking-sheet` (591L) | **Yes** | Both correct, different cost |
| Discovery | `/app/customer` | `/search`, `/app/customer/search` | **Yes** | Two visual languages |
| Search impl | — | `DiscoverySearch` shared | n/a | Correctly single |
| Profile header | inline markup | `profile-header.tsx` | Partly | — |
| Rebook rule | `discover-page.tsx:358-392` | `book-sheet.tsx:73-98` | **Yes** | Same rule, two implementations |
| Design system | product `@theme` | `[data-pro-marketing]` (32% of `index.css`) | **Yes** | Parallel system, one route |
| Top nav | `ui/navbar.tsx` | shells | Yes | One consumer, stale doc comment |

Nothing here is dead code deletable today. Per `CLAUDE.md`'s legacy-safety rule, **no removal is recommended during R5R.0**; migration should be route-by-route with rollback retained.

---

## 16. Component Classification

**KEEP:** `router`, `route-error-boundary`, all three guards, `CustomerShell`, `ProShell`, `marketing-layout`, `public-booking-layout`, `platform-layout` (+3), `lib/supabase.ts`, all `lib/queries/*`, `lib/realtime.ts`, `lib/query-client.ts`, `i18n/*`, `lib/intl/*`, and these primitives: `date-strip`, `availability-label`, `verified-badge`, `avatar`, `status-badge`, form primitives (`text-field`, `textarea`, `select-field`, `switch`), `table`, `tabs`, `alert`, `error-state`, `container`, `spinner`, `card`, `badge` — plus the `design/tokens.test.ts` **gate mechanism**.

**REUSE_LOGIC_ONLY:** `marketplace-card`, `inline-booking-sheet` (the 3-step machine and claim-token handling are correct), `public-booking-page` (phase machine, preselection-skip effects, `editStep()` downstream-clearing encode hard-won correctness), `sticky-book-bar`, `follow-control`, `metric`, `tab-bar`, `dashboard-grid` (keyboard-move pattern), `queue-entry-card`, `now-card`, `realtime-value`, dashboard panels, plus **six primitives reclassified during independent review**:
- `dialog`, `bottom-sheet`, `dropdown-menu`, `tooltip`, `toast` — **moved down from KEEP.** Radix wiring, focus trapping and scroll locking are correct; their portals escape `data-fu-pro`, so every one of them renders light chrome over the dark professional app (T-4). Each needs a `container` prop or a themed portal target.
- `segmented-control` — **moved down from KEEP.** Native radiogroup semantics and RTL handling are correct; the hardcoded `w-full` is the origin of the desktop-stretch defect (T-5).
- `time-slot-grid` — **REVIEW rather than KEEP-verbatim**, since it consumes `segmented-control` and inherits the same width default.

**REBUILD:** the radius scale; the typography layer; z-layer enforcement; `profile-header`; `service-mode-ctas` **styling only** (preserve its R4 service-mode logic verbatim); `empty-state`; shop and barber profile composition; `/search` composition; pro dashboard composition; the customer mobile header; `features-page` (must be rebuilt on `liveCapabilities()`/`plannedCapabilities()` as `/pricing` already is).

**LEGACY:** `business-listing-card`, `/app/customer` Discover composition, `ui/navbar`, the `[data-pro-marketing]` block, `components/marketing/*`, `components/for-business/*`.

**REVIEW:** `dashboard-grid` + `organization_dashboard_layouts`; `[data-fu-pro]` forced dark; `[data-fu-customer]` wash scope; teal `--color-success-600`; `passport-card`; `command-menu`; `quick-action-sheet`; `design/tokens.test.ts:139` regex gap.

**Nothing was deleted during this phase.**

---

## 17. Booking Flow Audit

**[VERIFIED]** — traced in code and confirmed against the running application.

### Entry A — Barber profile → booking

```
Profile (/s/:slug/barbers/:id) → tap Book [/s/{slug}?barber={id}&location={locId}]
  → FULL WIZARD page load → Service → Date/Time → Details → Confirm → Success
```
Screens: **2** (full navigation). Sheets: 0. Minimum for a returning authenticated customer: **1 + 3 = 4 taps.**
Services are listed as **non-interactive rows** — a real constraint, not laziness: `usePublicAvailableSlots` requires a `locationId`, which `list_public_barber_services` does not supply.

### Entry B — Shop wizard (`/s/:slug`)

```
[Location] → Service → [Barber] → Date → Time → Details → Confirm → Success
```
Worst case (anonymous, multi-location, multi-barber): **5 decisions + 2–4 form fields.**
Observed live: the wizard rendered **"Étape 1 sur 3 · Prestation"** for the seeded single-location shop — the collapse genuinely works. **[VERIFIED in browser]**
Best case (preselected barber + service, authenticated): **3 taps.**

### Entry C — Marketplace/search → booking

**C1 (Discover, legacy card):** `Book` is a `<Link>` to `/s/{slug}?barber={id}` → full wizard.
**C2 (Search, R5 card):** tapping `Book` on a *barber* result opens `InlineBookingSheet` **with zero navigation** — Book → Service → Slot → Confirm.

> **Counting convention — corrected during review.** My first pass counted Entry A's opening tap ("1 + 3 = 4") but silently dropped C2's, reporting "3 taps". That was inconsistent. Confirm is also an active submit, not a passive step: `inline-booking-sheet.tsx:522` is `<Button type="submit" variant="book" size="lg">` inside a real `<form onSubmit={handleSubmit(onSubmit)}>` with `customerName` registered `{ required: true }`.
> **Counting every tap the customer makes, the honest best case for a returning authenticated customer booking from a search result is 4 primary interactions** (Book → service → slot → Confirm), not 3. For a *shop* result add two more (expand team, pick member) = **6**.
> This matters because §25 previously set "≤3 primary interactions" as a hard gate that the audit's own preferred path cannot pass. That criterion has been corrected to ≤4 with the convention stated explicitly.

**Answer to the key question: yes** — C2 books from a search result without ever opening a profile. This is the best conversion path in the product.

### Entry D — Authenticated returning customer

No separate flow. `book_public_appointment` is the single write path for anonymous and signed-in alike; the RPC branches on `auth.uid()` internally. Authenticated users get contact prefill. The shell's centre BOOK opens `BookSheet`, which makes **0 booking decisions** (§6, S-1).

### Entry E — Repeat booking

Two independent surfaces, both using the most recent **completed** appointment, both deep-linking `/s/{slug}?barber=X&service=Y`. I confirmed those params are genuinely consumed at `public-booking-page.tsx:149-151` — **the rebook claim is real, not decorative.** Lands in the wizard with Location/Service/Barber pre-skipped.

### Interaction classification

| Step | Class | Evidence |
|---|---|---|
| Location before Service | **REQUIRED** | `usePublicServices` needs `locationId` |
| Service before Slot | **REQUIRED** | `usePublicAvailableSlots` `enabled` on `serviceId` |
| Barber before Slot | **REQUIRED** | same query needs `barberId` |
| Location step shown | **CONTEXT-DEPENDENT** | auto-skipped for single-location or preselected |
| Barber step shown | **CONTEXT-DEPENDENT** | auto-skipped when one eligible barber or preselected |
| Shop-result "choose professional" | **CONTEXT-DEPENDENT** | a shop genuinely has multiple bookable staff |
| **Profile → wizard instead of sheet** | **AVOIDABLE** | the profile already holds `barberId` and `locationId` |
| Step rail / crumb chrome | **AVOIDABLE** | presentation only |
| Anonymous contact re-entry | **AVOIDABLE-ish** | nothing persists between anonymous sessions |

> **BK-1 (HIGH). The profile takes the slow path.** `public-barber-page.tsx` navigates to the 1,097-line wizard while holding precisely the `barberId` + `locationId` that `InlineBookingSheet` needs. Same RPCs, same claim-token handling, ~1 extra page load and ~1 extra tap for no backend reason. `BOOKING_UX.md`'s ideal is `Profile → Book → Service → Slot → Confirm`; the sheet already implements it. **[VERIFIED]**

> **BK-2 (MEDIUM). Discover and Search disagree about how to book.** The same shop offers link-to-wizard on Discover and an inline sheet on Search, because they use different card components. Interaction cost depends on which screen the customer happened to be on. **[VERIFIED]**

**Authentication never interrupts booking** — booking is fully anonymous via an `anon`-granted RPC, and intent survives optional post-hoc signup through a **claim token** (`storePendingClaimToken` → `usePendingClaimRedemption`, wired at `customer-shell.tsx:64`), not a redirect param. Genuinely good architecture; preserve unchanged. **[VERIFIED]**

**All availability is real.** Single source: `get_public_available_slots`. No client-side slot generation exists anywhere. **[VERIFIED]**

---

## 18. Real Data / Mock Data Audit

**[VERIFIED]** — every item traced to a query/RPC or to its literal source.

### FABRICATED-AS-REAL

> **F-1 (HIGH). The pricing catalog has never matched the stated commercial decision.**
> `CLAUDE.md` and `FRONTEND_SPEC.md:311-320`: Independent **20 €**; Barbershop **35 / 49 / 69 €**, per establishment.
> Shipped (`lib/commerce/pricing.ts:74-84`), rendered live at `/pricing` and `/for-business`: `solo 19` · `salon_essential 29` · `salon_pro 49` · `salon_business 79` · `multi_growth 99` · `multi_pro 149` · `multi_scale 249` €.
> **I queried the live database directly:** `commercial_plans` returns exactly those eight rows (`free 0`, `solo 1900`, `salon_essential 2900`, `salon_pro 4900`, `salon_business 7900`, `multi_growth 9900`, `multi_pro 14900`, `multi_scale 24900`, all EUR, all `is_available = true`).
> **The frontend and the database agree with each other and both disagree with the specification.** Not drift — a catalog that has never matched the stated decision, with `catalog.test.ts` locking code to migration so the suite cannot notice.
> **Compliant:** no obsolete **39 €** exists anywhere, and pricing is genuinely per-establishment — `max_establishments` is a real column and `plans.ts:396-415` structurally forbids a per-barber multiplier.
> **This needs a product-owner decision, not an engineering fix.** Per `CLAUDE.md`, I have not silently chosen either source. **[VERIFIED — code + live DB]**

> **F-2 (MEDIUM). A hardcoded price inside all ten locale files.** `locales/*/landing.json:496` — "Growth is 99 € for up to two, not 99 € each." Violates `pricing.ts:10-13`'s own rule that no price is written into JSX **or a translation file**, and is region-blind: a US visitor sees the card render `$109` while the FAQ asserts `99 €`. Wrong for 5 of 6 regions. **[VERIFIED]**

> **F-3 (MEDIUM). "Most shops" is fabricated social proof.** `locales/en/landing.json:250`, rendered as a recommended-plan badge; other locales are stronger ("Le plus choisi", "Am häufigsten gewählt"). Backed only by an editorial boolean; there is no adoption query and billing is not live. `pricing-stage.tsx:78-80` comments that "no 'most popular' badge is fabricated" while rendering exactly that badge. **[VERIFIED]**

> **F-4 (MEDIUM). Dashboard occupancy uses a proxy denominator.** `pro/dashboard-page.tsx:188-199`, rendered as a headline `${occupancy}%`. Its comment claims the denominator is "the minutes the shop is actually open… not a hardcoded eight hours." The implementation divides by `Math.max(instants) - Math.min(instants)` — **the span between the first appointment's start and the last one's end**. A shop open 09:00–19:00 with two back-to-back appointments 14:00–15:00 renders **100% occupancy**. `location_hours` and `barber_working_hours` are real, already-wired queries and are not consulted. **I read this code directly and confirm comment and implementation disagree.** **[VERIFIED]**

> **F-5 (MEDIUM). `/features` advertises `planned` capabilities as shipped.** `features-page.tsx:30-139` is a hand-written array bypassing `lib/commerce/plans.ts`. It presents **Chair Mode** and **Analytics** ("Wait times, chair utilization and repeat-visit trends, in the product") as fact, while `plans.ts` marks `chairMode`, `advancedReporting` and `retentionInsights` as `planned` with evidence "GAP: no reporting or analytics surface exists." No wait-time computation exists anywhere — `queue-panel.tsx:15-21` explicitly refuses one. This is the exact failure `/pricing` was rewritten to eliminate; the hero disclaimer covers the *previews*, not the claims. **[VERIFIED]**

> **F-6 (MEDIUM). `/for-business` shows a live-looking queue with no illustration caption.** `for-business/product-stage.tsx:296-354` animates `{position: 3, eta: 22, ahead: ['Ines D.','Karim B.']}` → `2, 14` → `1, 0` on a 2400ms timer, rendering "#3", "about 22 minutes" and named people. The file's contract says "every stage is captioned as an illustration by its caller" — its only caller, `scrollytelling.tsx:178`, renders it bare; the caption was deliberately removed. `aria-hidden` hides it from screen readers, not from a sighted visitor. `consumer-landing-page.tsx` does this correctly, stamping every demo "Product illustration". **[VERIFIED]**

### UI PLACEHOLDER (labelled — acceptable)

`consumer-landing-page` slot/queue/passport/rebook demos (all captioned, `aria-hidden`); `marketing/product-previews.tsx` ("Illustrative preview" / "Sample data for illustration"); `for-business/scenes.ts` fictional worlds (documented DB-free).

> **Caveat:** `lib/onboarding/templates.ts:39-67` service-price templates are `recommended: true`, i.e. **preselected**, and are written by `apply_starter_services` into real `services.price_cents` — then surfaced to customers as `startingPriceCents` on marketplace cards. The file admits they are "plausible mid-market French figures", and currency is chosen in a *separate* step, so `2500` can ship as "25,00 MAD". Mitigated by editable fields before submit, but the default-accept path writes invented numbers into real customer-facing operational data. **[VERIFIED]**

### DEVELOPMENT MOCK
WhatsApp outreach `providerMode` defaults to `'mock'`, platform-gated, with an explicit "nothing is sent to any real number" banner. Correct.

### TEST FIXTURE
jsdom stubs in `test/setup.ts`. `Math.random` appears exactly twice outside tests, neither as data (a session id and an SVG gradient id); `lib/uuid.ts:10` bans it for identifiers. No `faker`, `lorem`, or fixture arrays in source.

### REAL BACKEND DATA
Slots (`get_public_available_slots`, `get_available_slots`); queue and positions (`queue_entries` + Realtime, `get_public_queue_status`); marketplace (`search_public_professionals`); analytics (`get_organization_analytics_summary`); follows/favourites; follower counts (shown only when > 0).

**No wait-time estimate is computed anywhere in the product** — the one number a queue product is most tempted to invent.

### External / unclaimed profiles — CLEAN
`get_public_external_professional` exists in the DB and is called by **zero** frontend files. `usePublicProfessionalIdentity` is enabled only when `professionalId` is non-null (claimed only). The verified badge means `professionalId !== null`. Barber-profile Book CTAs are gated on real `get_public_service_state`. The backend makes it structural: `professionals` carries no operational data, and a BEFORE INSERT trigger gates minting with no role exemption. **No fabricated availability, bookability, queue or live status reaches any external profile.** **[VERIFIED]**

---

## 19. Runtime / Browser Findings

**[VERIFIED — real browser]** Chrome DevTools MCP could not launch (no Chrome binary at `/opt/google/chrome/chrome`). I used the project's own Playwright Chromium driving the **running production container** `fadeup-web` on `localhost:15180` — healthy, with the full 15-container Supabase stack up. **13 routes × 3 viewports = 39 combinations**, against real seeded data (org `side-agency`; services *Coupe* 25 €/30min, *Coupe + barbe* 40 €/1h, *Taper* 25 €/30min; one barber *Barber Test*).

| Severity | Finding |
|---|---|
| **BLOCKER** | None. No route failed to render; no uncaught exception; no 4xx/5xx. |
| **HIGH** | Untranslated English on a French page — `/s/:slug/walk-in` (§11, I-1). |
| **HIGH** | Untranslated English on `/features` — "Skin fade + beard", "In chair", "Started 4 min ago" (`product-previews.tsx:57`). **Found during review on a route this audit had already loaded and failed to inspect for i18n**, and invisible to the detector via a third blind spot (§11). |
| **MEDIUM** | Clipped leaf text on `/` at 390 **and** 430 — the homepage's own search fields, `"De quoi avez-vous besoin ?"` and `"Où ?"` — plus `/s/:slug/profile` and `/for-business` (§20). Missed in the first pass, which checked only `/search`. |
| **MEDIUM** | Horizontal overflow on `/for-business` at 390px and 430px (V-13). |
| **MEDIUM** | Heading truncation `COIFFEURS PRÈ…` and clipped chips on `/search` at 390px (V-12). |
| **LOW** | `HydrateFallback` warning, observed on 11 of 13 routes at all three viewports in my run (33 occurrences logged). **A second independent run did not reproduce it.** The container serves a Vite dev server, so this is most likely a dev-only warning that does not reach a production build — recorded, but do not treat it as a production defect without re-confirming. |
| **LOW** | `GET /marketing/for-business/fadeup-product-film.webm` → `net::ERR_ABORTED`. Observed at all three widths in my run; an independent re-run reproduced it **only at 430px**. Timing-dependent, so "at all widths" overstates a single observation. |

**Load times — conclusion withdrawn.** My single-sample `networkidle` timings at 390px were `/` 4361ms, `/search` 2804ms, down to `/features` 789ms, and I concluded that `/` and `/search` are "the two slowest customer entry points". An independent re-run on the same container measured `/` at **1793ms** and `/search` at **1484ms**, with the slowest route being `/s/side-agency/profile` at 1805ms — **every value and the entire ordering changed.** These were single samples on a contended 2-core host with no repetition, variance or cold/warm-cache control. The ordering claim is retracted; the numbers are retained only as an illustration that the method was inadequate. Performance must be re-measured with n≥5 before any conclusion is drawn. **[INFERRED — method insufficient]**

Accessibility probes across all 39 combinations: **0 buttons without an accessible name**, exactly **1 `<h1>` per route**, `<main>` and `<nav>` landmarks present. **[VERIFIED]**

> **Corrected during review — one of these was a vacuous metric.** The first draft also reported "**0 images without `alt`**" and called the set "a genuinely good baseline". There are **zero `<img>` elements on any of the 13 routes at any viewport**; only 7 exist in the entire app, all on authenticated pages, reduced-motion branches, or avatars with no photo to render. The score is perfect because the images do not exist — which is precisely what V-2 calls a **BLOCKER**. The report was scoring a point for the thing it elsewhere identifies as the product's biggest gap. The remaining three probes stand on their own.

> **Touch-target counts qualified.** The first draft said "9–10 sub-44px targets on marketing pages and 1–3 on product surfaces" without stating the selector. That range holds only for a `button`-only query. Widening to `button, a[href], [role=button]` gives far higher counts — `/for-business` **25/46**, `/search` **15/34**, `/` **11/23**. The magnitude of this finding depends entirely on the selector, so the source-side evidence (the 116 `size="sm"` call sites, the named 16px/32px/36px controls) should be treated as the load-bearing evidence, not the browser tally.

`/app/customer` unauthenticated correctly redirects to login. `/nope-does-not-exist` renders a localized 404. **[VERIFIED]**

### Coverage limits of the browser audit — stated plainly

The 39 combinations cover **public/unauthenticated routes only**. No credentials were available, and creating an account would have mutated the database, which the audit boundary forbids. The following were therefore **not** exercised in a browser, and any conclusion about them rests on source reading:

- Every authenticated customer surface (`/app/customer/*` — Discover, Search, Profile, Appointments, Favourites, Passport)
- The entire professional application (`/app/*`), including the dashboard, the live queue board and the pro overlays
- Booking **completion** — the flow was traced to the confirm step and the RPC, but no booking was submitted
- Empty, error and offline states; realtime reconnection behaviour
- RTL locales, keyboard-only navigation, and screen-reader output

Consequences for how this report should be read: the design findings on the **shop profile, search, booking wizard, walk-in and queue-display** surfaces are browser-verified. The findings on the **professional dashboard** (V-3's nesting chain, V-14's widget grid, F-4's occupancy tile) and on **overlay theming** (T-4) are verified from source and, in T-4's case, from direct computed-style measurement — but not from a rendered pro session. They are marked accordingly and should be re-confirmed visually in R5R.1 rather than treated as closed.

Data realism is also limited: the seeded tenant has **one organization, one barber and three services**. Multi-location shops, multi-barber teams, long service lists, long names and populated queues were never rendered. Several findings (V-7's missing card data, V-12's truncation, the wizard's step collapse) could behave differently under realistic data volume.

### Contrast — computed, not assumed

`design/accessibility.test.tsx:31` states "§30 asks for WCAG 2.2 AA", but **there is no contrast assertion anywhere** in `apps/web/src/design/`. I computed WCAG 2.x relative luminance from the token values in `index.css`:

| Pair | Ratio | Required | Result |
|---|---|---|---|
| `#ffffff` on `--color-accent-600 #0d9b5f` — **the primary/book button** (measured live at **16px** semibold; the first draft said 14px) | **3.58:1** | 4.5:1 | **FAIL** — 16px is still normal text, so 4.5:1 applies and the verdict is unchanged |
| `--color-accent-600` on `paper-0` — **active customer tab label at 11px** | **3.58:1** | 4.5:1 | **FAIL** |
| `--color-ink-300 #9caaa2` on `paper-0` | **2.42:1** | 4.5:1 | **FAIL** — used for real content incl. the "Reconnecting" realtime warning |
| `--color-ink-500 #66766e` on `paper-50 #f5f8f6` — the app body background | **4.48:1** | 4.5:1 | **FAIL (marginal)** |
| `--color-ink-500` on `paper-0` | 4.79:1 | 4.5:1 | pass |
| `--color-accent-700 #0a7c4c` on `paper-0` | 5.25:1 | 4.5:1 | pass |

I independently recomputed the primary-button figure: `#0d9b5f` linearizes to L = 0.2435, giving `(1.05)/(0.2435+0.05)` = **3.58:1**. All six figures were then recomputed a second time during independent review and matched to four decimal places. Note the internal inconsistency this creates: `ProminentTab`'s BOOK label uses `accent-700` and passes, while the active tab label two lines away uses `accent-600` and fails. **[VERIFIED by computation, twice independently]**

### Dark mode is worse — added during review

The table above covers the **light palette only**, which understates the problem. `:root[data-theme='dark']` restates `--color-accent-600` to `#22c98a` (`index.css:216`) but — exactly as T-3 predicts — **never restates `--color-on-accent`**, which stays `#ffffff` from `index.css:113`:

| Pair (customer dark mode) | Ratio | Required | Result |
|---|---|---|---|
| `#ffffff` on `--color-accent-600 #22c98a` — **the primary/Book button** | **2.15:1** | 4.5:1 | **FAIL — worse than light mode, and below even the 3:1 large-text floor** |
| `--color-ink-300 #4c5f56` on `--color-paper-0 #16231e` | **2.38:1** | 4.5:1 | **FAIL** |

I computed white on `#22c98a`: L = 0.4395, giving `1.05/0.4895` = **2.15:1**.

Decisively, `[data-fu-pro]` **does** set `--color-on-accent: #06120c` (`index.css:845`), which scores 9.21:1 — so the author knew the fix and applied it in one scope only. The remedy in §24 ("darken toward `accent-700`") is light-mode-only and does **not** address this. **[VERIFIED by computation]**

### Touch targets

`index.css:986-988` declares `--fu-control-md: 2.75rem /* 44px — the touch-target floor */` and marks 36px as "dense pointer-only contexts ONLY". Violations: `toast.tsx:91` close (~16px, below even WCAG 2.2 SC 2.5.8's 24px); `dialog.tsx:61` close (32px); `dashboard-grid.tsx:146,155` move buttons (36px, though `:43-44` states these *are* the touch mechanism); `queue-entry-card.tsx:134` Call/Start/Finish (36px — while `:31-33` describes the user as "standing up, one-handed, with clippers in the other hand"); and `size="sm"` (36px) used **116× across 50 files** including `public-walkin-page` ×8 and `public-booking-page` ×4. My browser probe independently counted 9–10 sub-44px targets on marketing pages and 1–3 on product surfaces. **[VERIFIED]**

---

## 20. Responsive Findings

**[VERIFIED]** across 13 routes at each width.

### 390px
- Horizontal overflow: **`/for-business` only** (`right=419` vs 390). 12 of 13 routes contain correctly. **[VERIFIED]**
- Sticky bottom bar works on the shop profile — and duplicates the header CTA (V-5). **[VERIFIED]**
- Booking wizard is the cleanest surface measured: 19 elements, 4 rounded, **0 shadows**. **[VERIFIED]**
- **Truncation — corrected and expanded during review.** My first pass listed only `COIFFEURS PRÈ…` and the clipped chips on `/search`. A systematic `scrollWidth > clientWidth` sweep found clipped leaf text on more surfaces:
  - **`/` (home) — `"De quoi avez-vous besoin ?"` and `"Où ?"`, the homepage's own search fields, at 390 *and* 430**
  - `/s/side-agency/profile` — `"Profil de Side Agency"`
  - `/for-business` — `"Fade Passport · Malik R."`
  - nearly every marketing route — `"Thème: Système (light)"`
- **Customer-shell claims withdrawn from this section.** The first draft asserted here that "tab bar clearance (`pb-24`) is correct; no content sits under the bar" and that permanent chrome consumes ~124px. **`/app/customer` redirects to `/login` at all three viewports, so `CustomerShell` was never rendered in a browser during this audit.** Those statements are cascade/arithmetic inferences from source and are now marked as such in §6 (S-2). They do not belong in a `[VERIFIED]` browser section. **[INFERRED]**

### 430px
- Same `/for-business` overflow (`right=464` vs 430) — it scales with the viewport, confirming the `scale-125` ambient layer as the cause rather than a fixed-width child. **[VERIFIED]**
- **Corrected:** the first draft said "no new defects; no route regressed between 390 and 430." That was an artefact of missing the 390px defects — `/`'s search-field truncation is present at **both** widths. The accurate statement is that 430px surfaces the same defects as 390px, none of them newly introduced by the wider viewport.

### Desktop (1440px)
- **Controls fill the measure** (V-4): the `Liste | Carte` toggle measures **960px** and the widest CTA **802px**, constant at 1280/1440/1600px because `/search` is capped by `<Container size="lg">` at 1024px. A measure cap therefore *does* exist; the defect is that a two-option toggle fills it, caused by `w-full` in `segmented-control` itself (T-5). Results remain a single column with no grid and no list-beside-map. *(My initial screenshot-derived estimates of ~1330px and ~1100px were wrong and were corrected by programmatic measurement during review.)*
- Marketing header nav appears correctly.
- Customer shell correctly swaps the tab bar for a header nav with BOOK as a real button — **the shells handle desktop well; the pages do not.**
- No horizontal overflow at 1440px on any route.
- `pro-shell` caps at `max-w-[100rem]` (1600px) while `DashboardGrid` caps at `lg:grid-cols-2` — two columns across 1600px. **[INFERRED — pro app requires an authenticated session not exercised in this audit]**

---

## 21. Baseline Test / Typecheck / Lint / Build Results

**[VERIFIED]** — run from `apps/web` at HEAD `8287bff`. Nothing was weakened to obtain these results.

| Gate | Command | Exit | Run 1 (mine) | Run 2 (independent re-run) |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | **0** | PASS | PASS |
| Lint | `npm run lint` (`oxlint`) | **0** | PASS — **but 26 warnings** | same |
| Tests | `npm test` (`vitest run`) | **1** / **0** | 805 passed / 1 failed (806); 83/84 files; 431.50s | **806 passed (806); 84/84 files; 252.50s** |
| Build | `npm run build` | **0** | PASS — 2,839 modules, 5.39s | PASS — 2.91s |

> **Corrected during review — the headline test number was wrong as stated.** An independent re-run at the same HEAD produced **806/806 passing**. The suite is therefore **non-deterministic**, not "805/806 with a known failure". The honest baseline is: *typecheck, lint and build pass deterministically; the test suite passes in full but contains at least one load-sensitive test that can time out on a contended machine.*

> **Undisclosed in the first draft, added here:**
> - **Lint emits 26 warnings**, all `react(only-export-components)` (e.g. `require-platform-role.tsx:15`, `lib/theme.tsx:12,22,78`, `lib/auth-context.tsx:55`). Exit 0, but §1's "baseline health is green" was reported without them.
> - **Build warns `Some chunks are larger than 500 kB`** — `maplibre-gl` is **951.92 kB / 246.34 kB gzip**. This matters directly: §24 makes `/search` (the map surface) proof surface A, and §19 flags `/search` as slow. Those two facts were never connected in the first draft.

### The intermittent test — pre-existing, but my root cause was wrong

`src/pages/business-landing-page.test.tsx > shows Fade Passport as included in every column` — **`Test timed out in 5000ms`**, not an assertion failure.

**Still confirmed:**
1. Isolated run: **22/22 passed** (10.72s mine, 11.19s on re-run). **[VERIFIED]**
2. **R5 never touched it** — `git diff --name-only ba1eede..HEAD` returns nothing for `business-landing-page.*`; last touching commits `8b73ff4`, `1e717f1`, `d8272e6`, all pre-R5. **[VERIFIED]**

**Retracted — the mechanism I attributed.** I claimed the cause was jsdom's missing `HTMLMediaElement.prototype.play` at `for-business/product-film.tsx:77`. Independent review disproved it:
- The jsdom error fires **22 times on every run, pass or fail** (plus 22 × `load`, which I also omitted). **A constant cannot explain a variable outcome.**
- `product-film.tsx` already handles the jsdom path deliberately (`const played: unknown = video.play?.(); if (played instanceof Promise) played.catch(() => {})`), and jsdom's `notImplemented` emits to the virtual console rather than throwing into the caller — so there is no user-code error handling to be slow.
- Under 4 concurrent CPU burners on this 2-core host, wall time rose 2.5× and the file still passed **22/22 three times**; the allegedly-victimised test ran in **1,234 ms**, four times under the timeout, and is not even the heaviest test in its file.

**Most likely cause: machine contention and vitest fork/jsdom memory pressure** — my run took 431.5s versus 252.5s for identical code, a 71% slowdown indicating a loaded box. That is supportable; "`video.play()` causes it" is not.

**Consequence:** the fix this report originally mandated in §25 (stub `play` in `test/setup.ts`) is **unproven** and has been removed from the acceptance criteria. R5R.1 could ship that stub, still flake, and have burned its gate.

Worker V2 baseline was **not** run — this audit changed nothing in `apps/prospect-worker-v2`.

Worker V2 baseline was **not** run — this audit changed nothing in `apps/prospect-worker-v2` and nothing in the frontend audit could affect it.

---

## 22. Top 10 Problems

**1. Book is not the dominant CTA on the booking surface — BLOCKER**
*Symptom:* Follow renders above Book and carries the page's only shadow; the in-page Book never uses the `book` variant.
*Cause:* Slot ordering in `ProfileHeader`, `shadow-sm` on `follow-control`, and a missing `variant` argument.
*Evidence:* `public-barber-page.tsx:231-261`; `profile-header.tsx:108-110`; `follow-control.tsx:66-67`; `button.tsx:51,58-62`; `service-mode-ctas.tsx:78`.
*Impact:* Directly inverts the product's stated conversion hierarchy on its highest-intent surface.
*Direction:* Remove Follow's elevation and pass `variant:'book'`. For ordering, **do not simply swap the slots** — Book sits in `meta` deliberately, so that a walk-in-only barber is never offered a reservation. The fix is to move `ServiceModeCtas` itself (carrying its service-mode gating) into `actions`, preserving the R4 contract intact.

**2. The customer product has no visual content — BLOCKER for social-first**
*Symptom:* Monograms and an empty gradient band; no portfolio or photography anywhere.
*Cause:* No media surface was ever built.
*Evidence:* Browser at 390px — `/s/side-agency/profile`, `/search`.
*Impact:* Removes the primary trust and desire signal. The gap between a directory and a social marketplace.
*Direction:* Treat portfolio as a first-class R5R.1 primitive **and a data requirement** — verify what media the backend can store before designing around it.

**3. The design system is defined but not adopted**
*Symptom:* Semantic type at ~2.4% adoption; z-layers bypassed by every overlay; `--fu-control-xl` ("the BOOK action") unused.
*Cause:* Tokens were added without blocking the Tailwind defaults they replace, and without a gate on adoption.
*Evidence:* 20 vs 832 type-utility uses; 8 raw `z-50` in overlay primitives; §7 token table.
*Impact:* The system cannot deliver consistency it does not enforce; every new surface re-decides.
*Direction:* Extend the existing `tokens.test.ts` gate to radius names, arbitrary `text-[Npx]`, raw `z-` numerics and contrast.

**4. Overlay primitives break theme scoping; the radius scale is non-monotonic**
*Symptom:* Every dialog, sheet, dropdown, tooltip and toast in the professional app renders **light chrome over a near-black application**. Separately, `rounded-xl` (24px) > `rounded-2xl` (16px); `lg`≡`2xl`; `xl`≡`3xl`.
*Cause:* `pro-shell.tsx:109` themes a `<div>`, not `:root`, while all five overlays portal to `document.body` with no `container` prop — so they are siblings, not descendants. Radius: four of eight Tailwind steps overridden, the rest left at defaults.
*Evidence:* Browser measurement of computed tokens inside vs outside `[data-fu-pro]`; `dialog.tsx:40`, `bottom-sheet.tsx:31`, `dropdown-menu.tsx:12`, `tooltip.tsx:12`, `toast.tsx:98`. Radius: `index.css:169-172` vs `tailwindcss/theme.css:397-404`.
*Impact:* The portal break falsifies the "one primitive library, two palettes" mechanism this audit calls R5's strongest visual work — it does not hold where it matters most. Radius is the smaller of the two: recounted at **78 occurrences across 31 files**, with the colliding utilities barely used (`rounded-3xl` zero, `rounded-2xl` eleven), so it is a latent trap rather than a widespread defect.
*Direction:* Give the overlays a themed portal container; define all radius steps or block the unused ones. Both cheap, both blocking.

**5. Primary button fails WCAG AA contrast in two of three palettes, and the a11y suite does not check contrast**
*Symptom:* Light mode: white on `accent-600` = **3.58:1** at 14px. **Dark mode is worse: white on `#22c98a` = 2.15:1**, below even the 3:1 large-text floor. `ink-300` on white = 2.42:1 on real content, including the "Reconnecting" realtime warning.
*Cause:* Accent chosen for brand, never measured. `--color-on-accent` is restated for `[data-fu-pro]` (`#06120c`, 9.21:1) but **never for `[data-theme='dark']`** — the author knew the fix and applied it in one scope only. `accessibility.test.tsx:31` claims WCAG 2.2 AA but asserts no contrast at all.
*Evidence:* Computed twice independently from `index.css:113,109,216,845`; test file read.
*Impact:* The most-clicked control in the product is inaccessible in the customer app in both light and dark, and CI reports success. Note the pro app's *button* passes at 9.21:1 — so this is scoped to the customer palettes, which are the ones facing the public.
*Direction:* Restate `--color-on-accent` per palette and add a contrast gate covering all three.

**6. Pricing catalog contradicts the stated commercial decision — needs a product decision**
*Symptom:* `/pricing` shows 19/29/49/79/99/149/249 €; spec says 20 € + 35/49/69 €.
*Cause:* Frontend and DB agree with each other; neither matches the spec; `catalog.test.ts` locks the pair.
*Evidence:* `pricing.ts:74-84`; live `commercial_plans` query.
*Impact:* Public commercial commitments diverge from the stated decision. Blocks any R5R pricing surface.
*Direction:* Product owner decides. No 39 € exists and per-establishment pricing is correctly enforced — this is a values question.

**7. Untranslated English shipping past a guard that passes**
*Symptom:* French walk-in page renders an English sentence.
*Cause:* `no-hardcoded-strings.test.ts` misses `&apos;` entity escapes and JSX-ternary literals.
*Evidence:* Browser; `public-walkin-page.tsx:289`; `public-queue-display-page.tsx:192`; guard scope at line 81.
*Impact:* Globalization violated on public QR/kiosk flows; the guard's existence mistaken for coverage.
*Direction:* Close both blind spots first, then fix what the widened guard reveals.

**8. Two competing booking UIs; the profile takes the slow path**
*Symptom:* Profile → 1,097-line wizard, though a 3-tap sheet exists and the profile holds the data it needs.
*Cause:* `inline-booking-sheet` was added for marketplace only; the profile was never migrated.
*Evidence:* `public-barber-page.tsx:172-174` vs `marketplace-results.tsx:79-96`.
*Impact:* Extra page load and tap on the highest-intent surface, against Time To Booking.
*Direction:* One booking interaction language (R5R.3); the sheet is the better base.

**9. Desktop is mobile stretched; nested cards flatten hierarchy**
*Symptom:* A two-option toggle filling the entire 960px measure at every desktop width; every section a bordered rounded card; `/features` at 24 rounded + 33 bordered at 390px.
*Cause:* Page compositions have no desktop layout, and card is the default container.
*Evidence:* Browser at 1440px and 390px; density table §7.
*Impact:* Desktop looks unfinished on the main discovery surface; nothing guides the eye toward conversion.
*Direction:* Establish non-card grouping and desktop layout rules in R5R.1. The shells already prove the pattern.

**10. Discovery omits conversion data the backend already returns**
*Symptom:* Cards show price and open/closed but not distance, next availability or queue state.
*Cause:* R5's RPC work outpaced its UI consumption.
*Evidence:* `search_public_professionals` returns `distance_km`, `is_open_now`, `queue_waiting_count`; cards render none.
*Impact:* Customers must open a profile to discover no slot exists — the exact failure `BOOKING_UX.md` names.
*Direction:* Highest-value/lowest-risk R5R win: **no backend work required.**

---

## 23. Risks Before Rebuild

1. **The specs are untracked** (§2, B-1). *Commit them before R5R.1.* Cheapest risk to eliminate, most damaging to lose.
2. **No R5 checkpoint tag.** *Tag HEAD before R5R.1.*
3. **Uncommitted logic in the working tree** (§2, B-2). Commit or revert deliberately — do not begin a rebuild on an unrecorded baseline.
4. **The pricing conflict blocks any pricing surface** (F-1).
5. **Deleting R5 UI risks deleting real logic.** `inline-booking-sheet`, the wizard's preselection/`editStep` machinery, the claim-token flow, and `service-mode-ctas`' R4 service-mode logic all sit inside visually-rejected components. Extract before replacing.
6. **Do not revert either R5 migration** (§13).
7. **Tests assert the rejected layout.** `dashboard-grid.test`, `customer-shell.test`, `marketplace-results.test`, `tokens.test`, `accessibility.test` encode current structure; expect churn and do not weaken them to pass.
8. **Two customer discovery surfaces must stay in sync during migration** (§15).
9. **Three guards are weaker than they appear** — `no-hardcoded-strings` (§11), `tokens.test.ts:139` dark-completeness (§7, T-3), and `accessibility.test.tsx` (no contrast assertion, §19). Fix the guards before trusting them as R5R gates.
10. **The suite is slow (431s) with one load-dependent flake** (§21).

---

## 24. Recommended R5R.1 Scope

The smallest coherent lot that establishes the new visual foundation **without rebuilding the product**.

**Retain untouched:** router and guards; both shells; `lib/queries/*`; `lib/supabase.ts`; `lib/realtime.ts`; `i18n/*`, `lib/intl/*`; the `tokens.test.ts` **gate mechanism**; the best-in-class primitives named in §7 (`time-slot-grid`, `date-strip`, `segmented-control`, `availability-label`, `verified-badge`, `realtime-value`, `avatar`, `status-badge`, form primitives).

**Fix inside the retained foundation — these are prerequisites, not polish:**
0a. **Give the overlay primitives a themed portal container** (T-4) — `dialog`, `bottom-sheet`, `dropdown-menu`, `tooltip`, `toast`. Until this is fixed, the "one primitive library, two palettes" mechanism is not actually true, and every pro-app overlay is light-on-dark.
0b. **Remove `w-full` from `segmented-control`** and let callers own width (T-5).

**Establish/replace:**
1. **Fix the radius scale** — define all eight steps or block the unused ones (Top-10 #4).
2. **Fix contrast across all three palettes** — restate `--color-on-accent` for `[data-theme='dark']` (currently 2.15:1) as well as light, and add a contrast gate (#5).
3. **Enforce the type layer** — pick one system and gate arbitrary `text-[Npx]` (#3).
4. **Enforce z-layers** in the overlay primitives (#3).
5. **Grouping without cards** — spacing, typography and low-contrast separators as the default section treatment (#9).
6. **Media/portfolio primitive** — image, aspect ratio, grid, fallback, built against what the backend can actually store (#2).
7. **Desktop layout rules** — multi-column, constrained control widths (#9).
8. **A form/selector primitive** replacing the native `<select>` (V-11).
9. **Loading / empty / error patterns** per `DESIGN_SYSTEM.md`; `EmptyState.action` must become required.

**Proof surfaces — exactly three:**
- **A. Marketplace result card + results list** (`/search`) — proves grouping, media, desktop layout, and consumption of `distance_km` / `is_open_now` / `queue_waiting_count` (#10, zero backend work).
- **B. Public shop profile** (`/s/:slug/profile`) — proves profile hierarchy, media, and single-CTA discipline (#1, #2, V-3, V-5, V-6).
- **C. Booking sheet** (`inline-booking-sheet`) — proves the interaction language on the conversion core.

**Backend contracts consumed:** `search_public_professionals` (14-arg, including the unused conversion fields), `get_public_available_slots`, `book_public_appointment`, `get_public_service_state`, `list_public_organization_barbers`. **No new backend work.**

**Explicitly NOT built:** professional dashboard; analytics; Fade Passport surfaces; customer profile; queue UX; marketing pages; platform/admin; `/features`; any pricing surface (blocked on F-1); the barber profile page (R6); map view.

**One product decision required before starting:** is a permanently-dark professional app approved, given `DESIGN_SYSTEM.md` says light-first (T-2)? R5R.1 does not touch the pro app, but the answer determines whether `[data-fu-pro]` is a foundation or a defect.

---

## 25. Exact R5R.1 Acceptance Criteria

> **This section was substantially rewritten after independent QA review**, which showed the first draft's central gate was simultaneously self-contradictory and already satisfied on unmodified HEAD. Each fix is noted.

**Automated gates (all pass, none weakened):**
- `npm run typecheck` → 0; `npm run build` → 0
- `npm run lint` → 0 **and the 26 existing `react(only-export-components)` warnings do not increase**
- **Test suite:** exit 0 on **three consecutive runs**; no `.skip`/`.todo`/`.only` added; **test count strictly non-decreasing versus the 806 baseline**. *(Replaces "→ 806/806", which was unsatisfiable alongside this section's own demand for new assertions, and which an independent re-run achieved on unmodified HEAD with no work. The previously-mandated `HTMLMediaElement.play` stub is removed — §21 shows that mechanism is not the cause.)*
- `no-hardcoded-strings` **extended for all three blind spots** — entity escapes, JSX-ternary literals, **and literals inside rendered data structures** — then **every violation it reports is fixed, whatever the count**. *(Replaces "the two known violations", which presupposed a closed set; §11 names four sites and review found a fifth class the narrower fix would still have shipped.)*
- `tokens.test.ts` dark-completeness regex **fixed** to cover non-numeric colour tokens (it currently builds both sides of its comparison with the same numeric-only regex, so non-numeric tokens can never fail)
- **Radius:** assert the effective scale — `index.css` **merged with Tailwind defaults** — is **strictly increasing and value-unique**. *(Replaces "gate radius names", which a test that merely lists them would pass while the non-monotonicity survives.)*
- **Typography:** assert semantic-role adoption on the three proof surfaces, with a stated numeric threshold. *(Replaces "gate arbitrary `text-[Npx]`", which catches the wrong thing: the finding is 20 semantic uses vs 848 **numeric Tailwind steps** like `text-3xl`, none of which are arbitrary values.)*
- Raw `z-` numerics banned in overlay primitives
- **Contrast assertion** covering **all five palettes** (`:root`, `[data-theme='dark']`, `[data-pro-marketing]`, `[data-fu-pro]`, `[data-fu-customer]`), asserting 4.5:1 normal text, 3:1 large text, **and 3:1 non-text/UI-boundary contrast (SC 1.4.11)**
- **Touch-target assertion** at ≥44×44px on the three proof surfaces, **with the selector written into the test** (`button, a[href], [role="button"], input, select`) so the number is reproducible
- **Invariant guards that must not regress:** no `.from(`/`.rpc(` outside `lib/` in any rebuilt component; `browser-credentials.test.ts` single-client gate still passes

**Browser QA — three proof surfaces at 390px, 430px and 1440px:**
- **The QA harness must be committed to the repo** (there is currently no `playwright.config.*`, no `e2e/`, no `*.spec.ts`). Every number in §19/§20 of this audit was unreproducible by a reviewer, which is exactly how the 1330px and load-time errors survived to a first draft. R5R.2+ must be able to re-run it.
- Zero horizontal overflow at 390 and 430
- Zero console **errors**; zero failed requests; zero 4xx/5xx. Console **warnings** recorded and explicitly accepted or fixed — not silently passed
- **Zero clipped leaf text** (`scrollWidth > clientWidth` on text nodes) at 390 and 430, swept across the whole surface. *(The first draft said "no truncation of section headings or chips", which is how `/`'s own search-field truncation was missed.)*
- **CTA dominance, made mechanical** *(replaces "is the most visually prominent control", which was subjective and was the sole gate on BLOCKER #1)*: exactly one element carries the `book` variant; no non-Book control has a non-`none` `box-shadow`; Book precedes Follow in DOM order
- **Control widths at 1440:** a two-option segmented control ≤320px; no primary CTA at full measure width
- **Composition budget:** card-nesting depth ≤1; bordered-element count per surface ≤ the §7 baseline for that route
- Visible focus states; **full keyboard path** — tab order, focus trap in the booking sheet, Escape-to-dismiss
- `prefers-reduced-motion` respected
- **Rendered in `ar` (RTL)** — not merely "a non-English locale", which French already satisfies by default and which no change could fail
- **Rendered in dark theme**, since this lot fixes the dark-completeness gate; fixing the gate without rendering dark gives the newly-caught tokens values nobody has looked at
- Loading, empty and error states demonstrated **against a seeded empty tenant and a forced-failure path**, with screenshots attached

**Imagery criteria — new; BLOCKER #2 previously had no gate at all:**
- Every image carries meaningful `alt`; decorative images are `alt=""` — the "0 images without alt" baseline must stay true once images exist
- Defined aspect ratio and reserved space (no layout shift); lazy loading below the fold
- **No stock, placeholder or illustrative photography presented as a real professional's work** — a direct `CLAUDE.md` "never fabricate" exposure that this lot creates for the first time
- Explicit empty state when a professional has no portfolio

**Performance criteria — new:**
- LCP and transferred-bytes ceilings for proof surfaces A and B, measured n≥5. R5R.1 adds imagery and a **951.92 kB / 246.34 kB gzip `maplibre-gl` chunk** to `/search`, the surface §19 flagged as slow — it must not be rebuilt without a budget

**Behavioural regression criteria — new; protects the extraction risk §23 #5 names:**
- Claim-token store → redeem round-trip still works
- `editStep()` still clears only downstream state
- Service-mode gating still governs whether the Book CTA renders (this lot restyles `service-mode-ctas`)
- Anon booking still completes end-to-end via `book_public_appointment`

**Product/data criteria:**
- Result cards display `distance_km`, `is_open_now` and `queue_waiting_count` **when real, and nothing when null** — no defaults, no placeholders
- No new fabricated data; no new hardcoded prices in JSX or locale files
- Booking from a search result completes in **≤4 primary interactions** for a returning authenticated customer, measured in the browser. **Counting convention, stated so the gate is testable:** every deliberate tap counts, including the one that opens the booking surface and the final submit. Today's path is exactly 4 (Book → service → slot → Confirm); the gate therefore forbids regression rather than demanding an unachievable 3
- **Contrast is asserted in all three palettes** — light, `[data-theme='dark']`, and `[data-fu-pro]` — not light alone (§19)
- **Overlay theme scoping is asserted**: a dialog, bottom sheet, dropdown, tooltip and toast opened inside `[data-fu-pro]` must resolve dark tokens (T-4)

**Human gate (mandatory):**
- The product owner explicitly approves the visual direction on all three proof surfaces at 390px and desktop before any further frontend phase depends on it. **Technical PASS does not imply design approval.** R5R remains unapproved until this is given.
- **The approval must be recorded against artefacts** — screenshots of each proof surface at 390/430/1440, light and dark, plus the empty and error states — attached to the approval. This audit's own conclusions could not be reproduced from its prose; an approval with no attached evidence would inherit the same defect.

---

## 26. Explicitly Deferred Work

| Item | Ref | Defer to |
|---|---|---|
| Pricing catalog vs spec | F-1 | **Product-owner decision — blocks pricing UI** |
| Locale-file hardcoded `99 €` | F-2 | With F-1 |
| "Most shops" fabricated badge | F-3 | With F-1 |
| Dashboard occupancy denominator | F-4 | R14, or a small correctness fix |
| `/features` planned-as-shipped | F-5 | Marketing lot |
| Uncaptioned `/for-business` queue demo | F-6 | Marketing lot |
| `[data-fu-pro]` forced dark + inert `ThemeToggle` | T-1, T-2 | **Product decision; then R14** |
| Overlay portals escape `data-fu-pro` (light chrome on dark app) | T-4 | **R5R.1 — prerequisite** |
| `segmented-control` hardcoded `w-full` | T-5 | **R5R.1 — prerequisite** |
| Dark-mode `--color-on-accent` never restated (2.15:1) | §19 | **R5R.1 — prerequisite** |
| `onboarding-page.tsx:287` bypasses the query layer | §8 | Onboarding lot |
| `require-platform-role.tsx` renders raw Supabase error, untranslated | A-2, I-1 | Platform lot |
| `no-hardcoded-strings` `EXEMPT` array also hides `components/for-business/` | §11 | With F-6 |
| `useOrgQueue` polling fallback | RT-1 | R13, or a small fix |
| `usePlatformNotifications` fallback | RT-2 | Platform lot |
| Onboarding price templates + currency mismatch | §18 caveat | Onboarding lot |
| `passport.ts` N+1 signed URLs | D-2 | R11 |
| Query-key convention | D-1 | Before R5R adds query modules |
| Standalone barber profile URL | R-1 | **R6 — architectural prerequisite** |
| Missing `/app/analytics`, `/settings`, `/profile`, `/reviews` | R-2 | R14 |
| `/app/customer` namespace inversion | R-3 | Optional |
| Duplicate rebook-rule implementations | §4 | R5R.3 |
| Shop-profile unconditional Book bar | A-1 | R6 |
| `[data-pro-marketing]` parallel design system | §15 | Marketing lot |
| Glass/glow vocabulary | V-9 | Marketing lot |
| `/` 4.4s and `/search` 2.8s load | §19 | Performance lot |
| `HydrateFallback` warnings; aborted `.webm` | §19 | Low |
| Legacy component removal | §15 | Only after replacements verified |

---

## 27. Final Recommendation

**Proceed to R5R.1 as a design-foundation lot, scoped to §24 and gated by §25.**

The evidence does not support a broad rebuild. But it does not support a clean two-way split either — that framing was corrected during independent review. FadeUp's frontend has a strong **data/security/realtime/i18n** foundation, a **rejected composition layer**, and a **token/primitive layer that is partly good and partly defective**, and it is the third category that determines whether R5R.1 succeeds:

- **Strong and worth defending:** the data layer, the single-client security model, the realtime architecture, the i18n system, the auth boundaries, both application shells, and — most notably — a data-honesty discipline that repeatedly refuses to invent numbers it cannot source. The booking wizard is the least-decorated, most functional surface in the product.
- **Weak and correctly rejected:** the *composition* layer. Cards as the default container, no imagery in a visual product, a social action outranking Book on the booking screen, and discovery that ignores conversion data the backend already returns.
- **Mixed, and the real risk:** the token/primitive layer. Roughly two dozen primitives are genuinely good, but the token system is ~2.4% adopted, the radius scale is broken, the overlay primitives break theme scoping at the portal boundary, dark-mode contrast is worse than light, and `segmented-control` is width-greedy by default. **Six primitives moved from KEEP to REUSE_LOGIC_ONLY during review.**

Rebuilding the data, realtime, i18n or security layers would destroy the best work in the repository to fix a problem those layers did not cause. But "preserve the foundation intact" is too blunt an instruction: §24 items 1–4 and T-4/T-5 must be fixed *within* that foundation before proof surfaces are built on it.

Three things should happen **before** R5R.1 begins, all cheap:
1. **Commit `docs/product/`, `docs/design/`, `docs/frontend/`** — the rebuild's source of truth is currently untracked.
2. **Tag HEAD** — there is no post-R5 checkpoint.
3. **Get a product-owner decision on pricing (F-1)** and on the permanently-dark professional app (T-2).

Two clarifications the audit is obliged to make plainly:

- **R5's database work should not be reverted.** `search_public_professionals` is backward-compatible and returns exactly the conversion fields the specs ask discovery to show — it is *under-consumed*, not wrong. `organization_dashboard_layouts` is dormant, additive and RLS-forced; that decision belongs to the lot that rebuilds the dashboard.
- **A green suite is not approval.** Typecheck, lint and build pass, and 805/806 tests pass, on a frontend whose design has been rejected — and three of its guards (hardcoded strings, dark-mode completeness, accessibility) pass while the defects they exist to catch ship to production. That is precisely why R5R has two gates, and why the guards themselves are R5R.1 scope.

**R5R.1 not started. R6 not started. No implementation was performed, no legacy or rejected R5 code was deleted, no migration was reverted, no production data or schema was altered.**
