# /for-business — the professional acquisition experience

The page asks one question, and everything after it is the answer.

1. What kind of barber business do you run? — the mode selector
2. Watch FadeUp become that business. — the product world morphs
3. Scroll, and see how FadeUp runs it. — the product story
4. See how it remembers every customer. — Fade Passport
5. Understand what Pro turns that memory into. — Retention
6. Choose the plan that fits your operation. — the plan rail

---

## What already existed, and what happened to it

A scroll-driven version of this page was built in `27d8210`. It was good, and
most of it was kept rather than restarted.

**Retained**

- The sticky-stage-beside-scrolling-narrative architecture, and its two
  compositions (sticky from `lg`, inline stage per scene below it).
- `useActiveScene` — an `IntersectionObserver` with a centre band. It survives
  variable-height copy, font loading and zoom, which a pixel schedule does not,
  and it does no work per frame.
- `components/marketing/motion.tsx` — `Reveal`, `RevealGroup`, `RevealItem`.
  One motion vocabulary, built on `motion`, already a dependency.
- The product stage's scene components and their fixed, illustrative cast.
- The Loop and "already using booking software" sections.
- The geo-vs-language pricing separation in `lib/commerce/`.

**Replaced**

- **One plan became seven.** `pricing.ts` held a single subscription. It now
  holds a per-plan, per-region price table, and `plans.ts` is new.
- **Static business-type cards became global page state.** The old page ended
  with four "any shape of shop" cards. Business mode is now context that
  rewrites the headline, the world, the scene list, the copy and the pricing.
- **The stage became mode-aware.** It was one fixed shop; it now morphs between
  one barber, three, and five across two locations. Moved from
  `components/marketing/` to `components/for-business/`.
- **The pricing section.** A single large number became a plan rail with
  progressive disclosure and a comparison table.

**Not the active frontend**: there is no `apps/web-v2`. `apps/web` is the only
frontend in the repository.

---

## Business modes

`independent` · `barbershop` · `multi_location`, defined in
`lib/commerce/plans.ts` and held in `components/for-business/business-mode.tsx`.

Barbershop is the default because it is the middle of the three in every sense:
FadeUp's core customer, and one step from either neighbour.

The mode is **not** in the URL. Flicking through three shapes of business in the
first five seconds is an exploratory gesture, and writing each flick into history
turns the browser Back button into an undo button for a carousel. Plan intent —
a decision rather than a glance — *is* carried forward, as `?plan=`.

### The selector

Three ways in, all real controls: previous/next buttons, the progress dots
(buttons that jump straight to a mode), and arrow keys while the group has focus.
Swipe is added on top for phones, never as a substitute — a gesture that is the
only way to reach content excludes keyboard and screen-reader users entirely.

Selection loops in both directions.

**RTL**: the buttons sit in DOM order previous-then-next inside a logical flex
row, so Arabic mirrors the positions automatically while the meanings stay
attached to the right buttons. Arrow keys follow reading direction — in Arabic
`ArrowLeft` advances, because the key pointing at the next control should reach
the next control.

### Morphing

The same visual world, rearranged — not three screenshots. `BarberLane` is the
atom: Independent draws one, Barbershop three, Multi-location five plus a
location strip. Lanes that survive a mode change animate to their new row via
Motion's `layout`.

> `layoutId` was tried first and is wrong here. The same lane is rendered by
> every mounted stage at once — the hero, the sticky desktop stage, and the
> inline stage in every mobile scene block — so a shared id made Motion treat
> them as one element in several places, project them onto each other, and fade
> all but one to `opacity: 0`. The hero's product world rendered empty. Keyed
> reconciliation plus `layout` gives the morph that was actually wanted.

The hero's stage sits in a fixed-height box (`lg:min-h-[27rem]`) so flicking
through modes does not grow and shrink the hero by ~300px under the cursor.

---

## The scroll system

**Technology**: `motion` only. No GSAP, no second scroll engine, no custom RAF
loop. One `IntersectionObserver` decides the active scene; everything else is
enter animation or layout animation.

**Sticky architecture**: from `lg`, the stage is `sticky top-0 h-svh` inside the
story section and releases at its end. Below `lg` there is no sticky element at
all — each scene carries its own compact stage inline, so a phone gets short
scroll distances instead of a half-screen panel eating the viewport.

**No scroll hijacking.** Nothing pins the viewport, nothing prevents scrolling
back, and no section holds you for a fixed duration.

**Scene order** (`components/for-business/scenes.ts`):

| # | Scene | Modes | Status |
|---|-------|-------|--------|
| 01 | today | all | live |
| 02 | appointments | all | live |
| 03 | walkins | all | live |
| 04 | queue | all | live |
| 05 | barber | all | live |
| 06 | chair | all | live |
| 07 | passport | all | live |
| 08 | history | all | live |
| 09 | retention | all | **planned** |
| 10 | control | all | live |
| 11 | team | barbershop, multi | live |
| 12 | marketplace | all | live |
| 13 | discovery | all | live |
| 14 | rebook | all | live |

Then the Loop, the existing-software moment, pricing, and the final CTA.

Independent gets 13 scenes: `team` is absent, because a barber working alone
should not scroll through a staff-management chapter to reach the pricing. The
absence is part of what Solo is.

**Mode adaptation of copy** is by key fallback: a locale may define
`scenes.<id>.modes.<mode>.<field>`, and it wins over `scenes.<id>.<field>`. Most
beats read the same whatever shape of business you run — a walk-in is a walk-in
— so only the beats that genuinely differ carry overrides. A locale that has not
written one yet still renders correct copy instead of a missing-key string.

**Switching mode mid-scroll** re-anchors on the scene being read, but only when
that scene genuinely occupies the centre band. An earlier, looser test fired
from the hero (scene 01 begins just below the fold) and threw the visitor down
into the story on every arrow press.

---

## Product truth: what was audited

Every capability in `lib/commerce/plans.ts` carries a `status` and an `evidence`
string naming what was checked. `live` means it exists in this repository today.

**Verified live**: marketplace listing and search, public shop/barber profiles,
services, availability (location hours, barber hours, exceptions), online
booking, customer records, visit history, Fade Passport (customer-owned, with
photos and shares), manual rebooking, walk-in intake, team and invitations, live
queue, in-shop queue screen, chairs, waitlist and no-show rules, multiple
locations, location switching, cross-location read for owners/managers.

**Confirmed NOT built** — packaged and priced, never advertised as available:

- **The entire Retention Suite.** `grep -ril "retention\|win.back\|inactive
  customer\|return.cycle" db/migrations` returns nothing. There is no
  return-cycle computation, no scheduled outbound messaging, no inactivity
  detection, no segmentation, no automation engine, no retention analytics.
- **Chair Mode** as a distinct surface. `queue_status` reaches `in_service` and
  `chairs` exists, but chairs are not joined to `queue_entries` and there is no
  barber-facing chair screen. The `chair` scene therefore describes what happens
  at the chair today — the queue's in-service state plus the customer's last cut
  — and does not claim a dedicated product.
- **Advanced permissions.** `membership_role` is a fixed four-value enum.
- **Advanced booking rules, operational reporting, priority support.**
- **Billing.** No subscription table exists anywhere.

This is the tension in the brief, resolved rather than papered over: the
packaging decision the brief asks for is encoded in full, and the display layer
gates on `status`. `liveCapabilities()` is what the plan cards render, so an
unbuilt feature cannot reach the list by someone forgetting a flag. The
comparison table has three cell states — included, **Coming**, not included —
and a checkmark meaning "we intend to build this" is a lie a pricing table tells
very efficiently.

The retention scene is marked "On the roadmap" *in the story itself*, so nobody
reaches the plan rail and discovers that something they just watched is a plan.

---

## Fade Passport

Included in all seven plans. `assertPassportEverywhere` is not a comment — it is
a loop in `plans.test.ts` asserting `hasFadePassport(planId) === true` for every
plan id, plus a check that `passport` is not in `RETENTION_SUITE`.

Every expanded plan card carries the same Passport line, deliberately identical,
so flicking between plans shows it never changing. That is the fastest way to
communicate "this is not the thing you upgrade for".

---

## Retention

The Retention Suite is exactly: `returnCycles`, `comebackReminders`,
`inactiveCustomers`, `customerSegments`, `retentionAutomation`,
`retentionInsights`.

| Plan | Passport | Retention Suite |
|---|---|---|
| solo | ✓ | — |
| shop_essential | ✓ | — |
| shop_pro | ✓ | ✓ (packaged, not built) |
| shop_business | ✓ | ✓ (packaged, not built) |
| multi_growth | ✓ | — |
| multi_pro | ✓ | ✓ (packaged, not built) |
| multi_scale | ✓ | ✓ (packaged, not built) |

A test asserts the suite is all-or-nothing: no plan gets half of it.

Another test asserts Pro has a **live** differentiator over Essential — live
queue, chairs, in-shop screen — because if the only difference between two plans
were unbuilt, the upgrade would be a promise rather than a product.

---

## Pricing

**Source of truth**: `lib/commerce/plans.ts` (identity and packaging) →
`lib/commerce/pricing.ts` (region and amount). One direction, nothing imports
back. No price appears in JSX or in a translation file: copy is translated,
money is data.

**France reference catalog** (`eu`), asserted plan-by-plan in `pricing.test.ts`:

| Plan | € / month |
|---|---|
| solo | 19 |
| shop_essential | 29 |
| shop_pro | 49 |
| shop_business | 79 |
| multi_growth | 99 |
| multi_pro | 149 |
| multi_scale | 249 |

**Geo behaviour**: `PricingProvider` resolves a country from the first-party
`locale-detect` edge function — the same call the language default uses, so one
network request and one server-side answer. Country → pricing region is
independent of country → language default. Switching the interface to English in
Paris changes the words, not the currency; a French speaker in Texas sees French
words and dollars. Tested both directions.

**No FX.** Every region is a literal column. `uk`, `us`, `ca`, `ch` are explicit
commercial prices anchored on FadeUp's pre-existing positioning, and a test
asserts no two regions are derivable from each other by a single factor.

> **Open commercial question**: only `eu` is a signed-off catalog. The other four
> regions were extended from the single pre-existing anchor price and want a
> commercial decision before launch outside the euro zone.

**Fallback**: `intl` — EUR at the European prices — for any unlisted country and
while detection is pending. Billing an unlisted country in euros is honest;
inventing "$29" because the euro price is 29 is not. `isResolved` is false until
geo settles so the UI shows a neutral state rather than the wrong currency.

**Service prices are unrelated.** A Paris shop charging 25 € shows 25 € to
someone browsing from Chicago. Only FadeUp's own subscription follows the region
table.

**Mode-aware presentation**: Independent sees one plan and no rail affordance
(there is nothing to choose between). Barbershop and Multi see a three-row plan
rail with one expanded, the recommended one badged, and the detailed comparison
behind a disclosure — not forty checkmarks in the first pricing viewport.

---

## Registration

Plan CTAs go to `/pro/register?plan=<canonical_id>`. Never `/pro/signup`; a
browser test asserts no such link exists on the page.

`?plan=` is **intent**. `parsePlanId` rejects anything outside the seven
canonical ids, so an edited query string produces no banner rather than an
invented plan name — and a valid one changes only what one paragraph says. Tests
assert the plan id never reaches the application payload, that the application
still goes to a platform reviewer, and that an unknown id renders nothing.

There is no checkout. Joining sends an application; a person reviews it. No card,
no charge, no fabricated subscription state.

Employee invitations (`/invite/:token`) are untouched: an invited barber joins an
existing shop and never picks a plan, creates an organization, or triggers
platform business approval.

---

## i18n, theme, accessibility

**Locales**: all ten — `en fr es de it pt ar zh-CN ja ru` — under the `landing`
namespace. `src/i18n/locale-completeness.test.ts` fails on any missing, stray or
blank key, so a half-translated namespace cannot ship.

**RTL**: verified in a real browser. `dir="rtl"` on `<html>`, mirrored layout,
chevrons rotated, next-means-next preserved, pricing rail and comparison table
mirrored.

**Theme**: semantic tokens only (`ink-*`, `paper-*`, `accent-*`, `forest`,
`ivory`, `on-forest`). No isolated hardcoded palette. Light/dark/system all work;
dark was screenshotted.

**Accessibility**: mode arrows and dots are real buttons with labels; visible
focus rings; the group takes arrow keys; mode changes announce via a polite live
region; the stage is `aria-hidden` because the narrative column already carries
the same information as text; the comparison is a real table with `scope`d
headers and screen-reader-only cell values.

**Reduced motion**: verified with `prefers-reduced-motion: reduce`. All 18 `h2`
headings present, mode switching works, pricing accessible. Motion is removed;
content never is.

---

## Verification

```
cd /opt/fadeup/apps/web
npx tsc -b --noEmit       # clean
npm run lint              # 0 errors (pre-existing fast-refresh warnings only)
npx vitest run            # 43 files, 260 tests, all passing
npm run build             # clean; for-business route chunk 48.6 kB / 11.5 kB gzip
```

**Browser QA** ran against a real headless Chromium driving the dev server.

Viewports: 390×844, 430×932, 768×1024, 1024×768, 1366×768, 1440×900, 1920×1080.
Modes: all three, at 1440 and 390. Locales: `fr-FR`, `ar-SA` (RTL), `ja-JP`, plus
the English default. Checked at every stop: horizontal document overflow, console
errors, page errors.

Checks that ran: mode looping forward and backward, arrow keys, mid-scroll mode
switching, full-page scroll per mode, per-mode pricing amounts and the absence of
irrelevant ones, the Passport line in all three modes, the comparison table's
Coming-vs-Included cells, navigation hrefs, plan intent, header professional-vs-
consumer split, and reduced motion.

Two real bugs were found this way and fixed:

1. **The hero's product world rendered completely empty** — the `layoutId`
   collision described above. Not visible in jsdom; obvious in a screenshot.
2. **Pressing a mode control in the hero threw the page down into the story** —
   the re-anchor guard was too loose.

A third was found by the overflow assertion: the comparison table's `sr-only`
cells are `position: absolute`, and with no positioned ancestor they escaped the
scroll container and made the document 95px wider than the viewport at 390px —
a page scrolling sideways because of text nobody can see. Fixed by making the
scroll container the containing block.

### Environment notes

The sandbox had neither browser libraries nor fonts. Both were resolved without
root by downloading `.deb` packages and extracting them to a scratch prefix
(`LD_LIBRARY_PATH`, `XDG_DATA_HOME`). Worth knowing: **before fonts were
installed, Chromium rendered every screenshot with no text at all** — a
convincing-looking layout with invisible copy. Any visual QA in a bare container
should check that text renders before trusting a screenshot.

`/pro/register` crashes the browser tab in this sandbox. Verified pre-existing by
stashing the change to that file and reproducing on the untouched version; the
machine has 3.8 GB RAM with swap already in use. Plan-intent behaviour on that
route is covered by jsdom tests instead.

---

## Known issues

- **Non-EU pricing needs commercial sign-off** (above). Only `eu` is agreed.
- **Touch targets in the shared marketing chrome**: the language and theme
  toggles are 32×36 and the footer links 43×16 at 390px, under the 44px
  guideline. These are shared components used across the whole product, so
  changing them is a global chrome decision rather than part of this page.
- **Hero height still varies ~60px** between Barbershop and Multi-location at
  1440. The fixed stage box absorbs most of it; the remainder is the location
  strip.
- **Mobile hero height varies** more (884–1191px) because the stage is inline
  rather than in a fixed box. The selector still lands inside the first
  screenful in all three modes.
- **The scroll cue sits below the CTAs on mobile**, so it is not in the first
  screenful. The product panel is visibly cut off by the fold, which does the
  same job, but a dedicated mobile cue would be better.
