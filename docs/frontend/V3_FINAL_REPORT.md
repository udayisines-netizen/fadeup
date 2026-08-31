# FadeUp V3 — Complete Visual Reconstruction: Final Report

Date: 2026-08-31 · Branch: `rebuild/social-first-v2` · Preview: `/_preview/v3`
Status: **FADEUP V3 COMPLETE — READY FOR HUMAN VISUAL REVIEW**

Technical green is necessary but insufficient (R5R approval gate §2): nothing
here is product-approved until the product owner validates the rendered
direction. Canonical routes were not touched; nothing was deployed or pushed.

---

## 1–2 · Documents reread, product truths

Every mandated document was read in full before any code: GREENFIELD_RULES,
PRODUCT_UI_BLUEPRINT, MOTION_SYSTEM, SCREEN_BLUEPRINTS, GREENFIELD_ROADMAP,
R5R_FRESHA_REDESIGN_PLAN, R5R_FINAL_REPORT, DESIGN_SYSTEM,
REFERENCE_PRODUCTS, FRONTEND_SPEC, BOOKING_UX, PRODUCT_CONSTITUTION (frozen
v1.1), R5R_DEFECTS_FOUND, the customer-v2 README, plus the Design Pass A/A.1
artifacts. The extracted truths live in
**`docs/design/FADEUP_V3_PRODUCT_TRUTHS.md`** (sections A–N as briefed),
including three recorded conflicts NOT silently resolved: the CLAUDE.md
pricing table vs the frozen Constitution §6 v1.1 (V3 hardcodes no pricing),
the claimed-badge idiom, and the un-signed-off "€ expected today" derivation
(slot stays collapsed).

## 3 · Safety checkpoint

`backup/pre-fadeup-v3-visual-reset-20260831` (annotated, on `a7217f3`) and
`backup/pre-fadeup-v3-dirty-snapshot-20260831` (a `git stash create` commit
preserving the uncommitted realtime/queue query work without touching the
tree). No `reset --hard`, no `clean -fd`, no `add .` anywhere; remote state
verified (`origin/rebuild/social-first-v2` = local base). Neither tag pushed.

## 4–5 · Old architecture rejected → V3 architecture

The rejected R5R visible implementation (customer-v2, pro-v2) was used only
as a contracts reference and is now deleted (§41). V3 is a clean namespace:

```
src/ui-v3/ui-v3.css        foundation: tokens, BG-01…07, type voices, primitives
src/customer-v3/           landing, shell, home, marketplace(+map), profiles,
                           booking, appointments, queue, profile, passport,
                           book tab, hooks (relocated nonvisual logic), ui
src/pro-v3/                shell, dashboard, calendar, customers, analytics,
                           retention, profile editor
```

Routes mount at `/_preview/v3` (landing at the root; customer app one segment
deep; pro under `/pro` behind `RequireAuth`), beside the untouched canonical
product.

## 6–8 · Artlist

Capabilities inventoried live in **`docs/design/ARTLIST_CAPABILITY_INVENTORY.md`**.
Governing constraint discovered before any spend: the account is a **free
trial — 2 image + 1 video generations total, no credits**. The briefed
4-direction generated shootout was therefore executed as written briefs, with
generation reserved for the winner. Spend: **2 free image generations, 0
credits** — (1) the Direction-A hero master (4 variants in one call, winner
at 2K with protected negative space and a surviving 4:5 crop) and (2) the
Culture mirror-check scene (the reserved Image-2 slot, spent to close the
review's duplication finding). The **1 free video generation remains
unspent** by §26's still-first rule. Provenance, masters, derivatives and
optimization are recorded in **`docs/design/ASSET_PROVENANCE.md`**.

## 9–13 · Creative direction and visual systems

**`docs/design/FADEUP_VISUAL_V3_DIRECTION.md`** — thesis "editorial
certainty". Winner: **Direction A, Editorial Precision**, with D's material
language as the supporting system and real product theater in the hero.
Color world: the audited ink/green core extended with pearl/fog/stone/sage
and a forest-tinted graphite (never pure black). Background system BG-01…07
implemented as composable band primitives. Typography: system sans product
voice + Instrument Serif marketing display (one recorded in-app exception:
the Home greeting), tabular Numeric styling on every operational number.
Motion extends MOTION_SYSTEM.md — press 120ms, settle 240ms, queue position
roll, passport tilt, hero scrim; everything dies correctly under reduced
motion.

## 14–33 · The surfaces (all rebuilt from zero)

**Landing (14)** — editorial page: BG-04 hero (real photograph, serif
display, REAL search into the marketplace, one live result card overlapping
the image), Discovery proof (live rows + honest coordinate-field slot that
collapses while locations are ungeocoded), Culture (own asset), Booking
demo, Independents, Queue graphite scene, Passport reveal, Follow, Pro
outcomes — every demonstrative object wears a visible EXAMPLE chip; no fake
counters anywhere. ~19KB JS + 14KB CSS + 35KB AVIF hero.

**Home (15)** — personal and truth-gated: serif greeting, search, location
scope chips (precise/country/everywhere), NEXT appointment plate (realtime
stage), heading that claims only what the data supports (Near you ⇄ In
{country} ⇄ Discover), live Near-you rows, Book-again rail from completed
history. Anonymous degrades to discovery+search.

**Marketplace + map (16–17)** — one row grammar at every width; chip rail
(Open now toggle + a real sort radiogroup); URL contract `?q&city&open&sort&view`;
in-place paging against the server total; desktop 24rem list + sticky map
with V3 price-pill pins and two-way pin↔row coordination; maplibre stays
lazy and mounts only when real coordinates exist. (Data gap: current
locations are ungeocoded, so the split awaits geocoded rows for a live
browser capture — the RPC itself returns coordinates unconditionally.)

**Shop (18)** — venue commerce: typographic header (no empty media chrome),
real queue line, site switcher that never names the group, services as
commerce rows with per-service Book, human team rail, sticky mobile Book
with the real from-price, desktop sticky rail. **Barber (19)** — social
identity: avatar-led header, claimed badge/handle/headline/followers only
when the claimed identity resolves, Working-at in green text, Book dominant,
Follow claimed-only, honest one-line portfolio absence. **Booking (20)** —
the audited machine intact (auto-skips, availability landing, conflict
recovery, prefill, claim token, analytics) in the V3 grammar: context chips,
date rail, Morning/Afternoon/Evening groups, price-carrying confirm;
interactive flow verified in-browser to the details step against real
slots. **Confirmation (21)** — Apple-calm: check, when/who/where/price, Add
to calendar (ICS), View booking, Done.

**Appointments (22)** — NEXT plate, compact upcoming/past rows, two-tap
cancel with error surface, queue banner, Book again carrying
location+barber. **Queue (23)** — the signature graphite boarding-pass:
real position (Intl-formatted), people ahead, position roll, You're-next and
in-chair states, ZERO join affordances, empty state that states the
QR+proximity rule. **Customer profile (24)** — identity, miniature Passport
pass entry, real following (org follows count-only per the contract gap),
activity with mark-all-read and a real error state, language, sign out.
**Passport (25)** — BG-06 reveal, real fields as pass rows (nulls collapse),
server-token QR share, edit as a separate form, tilt under motion
preferences.

**Pro (26–33)** — BG-07 only. Shell: scope resolved once
(org→location, selector only when plural), role gates mirroring RLS.
Dashboard: NOW (in-chair/≤15min) / NEXT / QUEUE (creation-order ordinals)
worklist in the shop's own day, 30-day server-verbatim strip labeled
org-wide under location scope; revenue/expected/margin/forecast truthfully
absent. Calendar: per-professional columns, 15-minute ticks, compact
status-edged blocks, a real now-line, drag-reschedule with the
no-optimistic-move rule, mobile timeline with Complete/No-show. CRM: the
at-a-glance band (visits · interval · last · NEXT — next visit is new and
real), timeline, no spend. Analytics: 7/30/90 window control, funnels,
product-designed daily bars, audience deltas vs the previous window.
Retention: Worth-a-call worklist with each customer's own interval, plans
as products, member transitions, no send button, no SMS. Profile editor:
YOUR PUBLIC LISTING as the org's own row from the anon search RPC through
the real V3 row grammar, verbatim readiness checklist, publish via
`complete_onboarding` only, business/location/team forms. (Onboarding
proper: the editor covers the R5R "onboarding tail"; the full wizard remains
canonical `/onboarding`, out of R5R/V3 scope by the roadmap's own lots.)

## 34–39 · Quality gates

**Responsive (34):** the V3 final sweep (`e2e/v3/final-sweep.mjs`, the R5R
probe set) — 17 routes × 390/430/1440, EN and AR: **zero overflow, zero
console errors, zero failed requests, zero 4xx/5xx, zero unnamed controls,
zero missing alt, h1 everywhere** in 102 combinations. **Performance (35):**
landing chunk ~19KB JS/14KB CSS, hero 35KB AVIF (budget 220KB), maplibre
lazy, no 4K assets shipped. **Accessibility (36):** 44px targets enforced
(chips, inputs, links; two accepted notes below), one green focus ring,
semantic landmarks, reduced-motion parity, WCAG-checked contrast pairs.
**i18n/RTL (37):** new `v3` namespace across ALL 10 locales with enforced
parity and full plural forms, no hardcoded strings (test-enforced), logical
properties + `<bdi>` throughout — AR runs 51/51 with `dir="rtl"` and zero
clipping. **Tests (38):** 820/820 (86 files), incl. the re-expressed V3
truth-guard tests and the ported enum-leak guard; tsc clean; lint 0 errors;
production build clean. **Browser QA (39):** every surface captured;
curated set in `docs/frontend/artifacts/v3-final/` (EN + AR). Two accepted
notes, both documented: the balanced-serif headings trip the clip probe by a
3–5px vertical metric overhang with `overflow-y: visible` (verified nothing
is cut), and the listing-visibility switch is 24×24 (WCAG 2.2 minimum)
inside a larger label.

## 40 · Independent review

`opus-reviewer` ran a full independent pass (code + live browser at
390/430/1440 in fr/ar/ja + artifacts): verdict — landing **passes** as a
serious 2026 consumer product, culturally credible, "Fresha translated, not
copied", no AI-template resemblance; app honest but with behavioral gaps;
Pro correctly operational. It returned 3 HIGH / 8 MEDIUM findings; **all
actionable findings were fixed in `ec4edb1`** (location scope restored,
paging restored, truthful headings, NOW semantics, shop-timezone today,
error states, both landing duplications — including spending the reserved
Artlist slot — semantics, RTL label, Intl digits, dead code retired).
Remaining, disclosed: fuller migration of the deleted v2 behavioral test
suite beyond the ported truth guards; signed-in customer-state captures
(below); the calendar's inherited 07–21h window and roster-scoped columns
(v2 behavior, listed to not be mistaken for new).

## 41–44 · Deletion, retention, gaps, provenance

**Removed (41):** `src/customer-v2`, `src/pro-v2`, their router branches,
stylesheet import, r5r e2e harnesses, and the orphaned v2 locale subtrees.
**Import audit:** `grep -rn "customer-v2\|pro-v2" src/ e2e/` → zero
matches. **Retained deliberately (42):** the nonvisual location resolver,
debounce hook and map tile-source config (relocated into customer-v3), the
supply-model guard (now scanning customer-v3), and every `lib/` contract —
queries, auth, realtime, intl, calendar time, analytics. **Backend gaps
(43):** unchanged and restated in PRODUCT_TRUTHS §M — venue/work media,
reviews, next-available, public hours, charged amounts, any-professional
availability, campaigns, privacy toggles, org-follow names — plus one data
gap surfaced by this run: current `locations` rows carry NULL coordinates,
so the LIST+MAP split and distance/N nearest sort await geocoded data (the
contracts are ready). **Provenance (44):** `docs/design/ASSET_PROVENANCE.md`
records both generated assets end-to-end.

## 45–46 · Git

Commits, in order: `d81bf2f` docs (truths + direction + Artlist inventory) ·
`d03f161` foundation + landing · `61c568b` shell/Home/Marketplace ·
`30a4fc9` profiles + booking · `33b86fa` customer account · `84b9417` pro
operations · `b3fe1e2` pro growth · `b90c9d0` quality pass · `a0fc3a9`
remove rejected R5R · `ec4edb1` review findings · this report's commit.
Final `git status`: clean tracked tree apart from pre-existing untracked
inventory files and the pre-existing uncommitted realtime/queue
modifications preserved from before this run (snapshot-tagged, untouched).

## 47–51 · Confirmations

- **Backend was not redesigned.** Zero migrations, zero RPC changes, zero
  schema edits; every surface consumed existing contracts. The one DB write
  of the run was the temporary QA login (below), deleted the same day.
- **RLS untouched.** No policy read, weakened or bypassed; role gates in UI
  mirror the existing boundaries.
- **R6 was not started.**
- **Nothing was deployed.** The only server run was a local `vite preview`
  on port 4174 for QA (the pre-existing 4173 service belongs to another
  project and was not touched).
- **Nothing was pushed.** All commits and tags are local.

**QA hygiene:** authed pro sweeps used `v3-qa-owner@fadeup.test` (owner on
side-agency), created for the run with a random per-run password held only
in the session scratchpad; deleted in one transaction (memberships →
identities → users), verified zero rows remain; the scratchpad password file
was removed. No credential exists in the tree. Because deletion preceded the
artifact refresh, the curated set evidences signed-in PRO states but the
customer signed-in states (Next plate, Passport pass, live queue ticket)
are demonstrated on the landing's example objects and in tests rather than
authed captures — flagged for the human review session, where the owner can
view them signed in directly.
