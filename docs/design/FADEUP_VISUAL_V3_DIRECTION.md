# FadeUp V3 — Visual Direction

Date: 2026-08-31 · Author role: creative director / product design director.
Binds every V3 surface. Product law: `FADEUP_V3_PRODUCT_TRUTHS.md`.
Creative-stack constraints: `ARTLIST_CAPABILITY_INVENTORY.md`.

---

## 1. Brand thesis

FadeUp sells two things at once and the interface must sell both:

1. **The haircut** — craft, culture, identity, the confidence of walking out
   fresh. This is emotional and photographic.
2. **The certainty** — the right barber, the real price, the real slot, the
   real queue. This is typographic and structural.

The R5R interface sold neither: it was a correct form on a white sheet. V3's
thesis is **"editorial certainty"**: the emotional layer is carried by
editorial composition, material backgrounds and (when assets exist)
photography; the certainty layer is carried by dense, confident, numeric-strong
product typography. The two never blur — marketing surfaces may be cinematic,
operational surfaces are precise — but they are recognizably one brand because
they share ink, green, type voice and spacing DNA.

The desired reaction to any screenshot: *"this looks like a serious funded
consumer company that understands barber culture."*

## 2. Mood words — with visual meaning

- **Premium** = fewer, larger, better-placed elements; generous type contrast
  (display vs metadata); hairlines not boxes; nothing default-looking.
- **Young / street** = confident scale jumps, tight letter-spaced uppercase
  labels, editorial crops, real-city references; never slang copy or graffiti
  clichés.
- **Editorial** = every section is a composed spread (asymmetry, a dominant
  element, intentional white space), not a title + subtitle + card grid.
- **Technically precise** = aligned baselines, tabular numerals for every
  operational number, consistent 4px rhythm, motion that answers a question.
- **Culturally believable** = barbering vocabulary used correctly (skin fade,
  taper, lineup); imagery where the haircut itself is the hero.

## 3. Anti-references (redesign triggers)

Random bento grids · glowing/glass cards · purple-blue gradients · giant 80px
generic SaaS headline over three floating widgets · 3D blobs/spheres · sparkle
icons · black-and-gold barber-pole cliché · neon cyberpunk · crypto-card
passport · Shadcn/Bootstrap default look · Dribbble banking app · fake
dashboards in marketing shots · stock-like AI people. If a section resembles
any of these at review, it is redesigned, not tweaked.

## 4. Color world

Foundation stays on the proven accessible core (WCAG-verified in v2), extended
with marketing-surface materials. All tokens live in one `ui-v3` layer.

**Core (product surfaces):**

| Token | Value | Role |
| --- | --- | --- |
| `ink` | `#101512` | primary text; near-black, faint green undertone |
| `ink-soft` / `ink-mute` | `#5a6862` / `#647269` | secondary/metadata |
| `paper` | `#ffffff` | product canvas |
| `ground` | `#fafbfa` | app background behind paper |
| `fill` | `#f1f4f2` | quiet fills |
| `hairline` | `#e4eae7` | separators (1.22:1 — deliberately light) |
| `green` | `#0a7c4c` | Book, live/positive, active nav — nothing else |
| `green-deep` | `#08633c` | pressed/hover of green |
| `green-tint` | `#eaf5ef` | selected-state wash |
| `alert` | `#a8442f` | failure only |

**Marketing materials (new in V3, never inside operational Pro surfaces):**

| Token | Value | Role |
| --- | --- | --- |
| `pearl` | `#f4f2ec` | warm editorial neutral (BG-02) |
| `fog` | `#eef1ee` | cool editorial neutral (BG-02) |
| `stone` | `#e6e3da` | deeper warm band edge |
| `graphite` | `#171d1a` | high-contrast spotlight surfaces (BG-05) |
| `graphite-soft` | `#222b26` | raised element on graphite |
| `on-graphite` | `#e8f0ea` | text on dark |
| `on-graphite-dim` | `#8ba79a` | secondary on dark |
| `sage` | `#dfe9e2` | restrained green atmosphere (BG-03) |

Rules: green is strategic — it never floods a screen; graphite is earned —
Queue, Passport reveal, campaign moments only; alert never decorates. Dark
surfaces use the forest-tinted graphite (green undertone), never pure black —
that IS the FadeUp dark, distinct from black/gold barber cliché.

## 5. Background system (BG-01…BG-07)

Backgrounds change because the narrative changes, never mechanically.

- **BG-01 Pure Product Canvas** — `paper` on `ground`. All functional customer
  surfaces (marketplace list, booking, appointments) and their desktop frames.
- **BG-02 Soft Editorial Neutral** — `pearl`/`fog`, full-bleed band. Landing
  section rhythm changes (Discovery → Culture hand-offs), onboarding chapter
  breaks.
- **BG-03 Brand Atmosphere** — `sage`→`fog` very low-contrast light wash (CSS
  gradient + grain, no purple, no glow). Landing pro section, signed-in Home
  greeting band.
- **BG-04 Photography Environment** — the Artlist hero master (and future
  editorial assets) integrated into layout with protected negative space; text
  sits on image only where the composition reserves it. Landing hero + culture.
- **BG-05 High Contrast Spotlight** — `graphite`. Queue scene on the landing,
  the active Queue ticket surface, Passport reveal band. Sparingly: at most
  two graphite moments per page.
- **BG-06 Premium Product Reveal** — graphite base + controlled light
  (radial highlight, layered SVG material, subtle texture). Fade Passport
  object and its landing section.
- **BG-07 Clean Data Canvas** — near-distraction-free `paper` with `ground`
  wells. Entire Pro product, calendar, analytics.

## 6. Typography

Two voices, one family system:

- **Product voice:** the existing system sans stack (SF-adjacent) — every
  operational surface. Efficient, never dramatic inside the app.
- **Marketing display voice:** `Instrument Serif` (already in the repo, no new
  dependency) for landing display headlines only — an editorial,
  fashion-adjacent counterpoint that no generic SaaS template ships. Used at
  large sizes with tight leading; never inside the product shell.

Scale (clamp() on marketing, fixed in product):

| Style | Spec | Use |
| --- | --- | --- |
| Marketing Display | serif, clamp(44px→92px), lh 0.98, -1% tracking | landing hero/section leads |
| Marketing Kicker | sans 12–13px, uppercase, +8% tracking, `ink-mute` or green | section eyebrow |
| Product H1 | sans semibold 24–30px | page titles |
| Section Heading | sans semibold 18–22px | in-page sections |
| Entity Heading | sans semibold 16–18px | result/venue/person names |
| Body | sans 15–16px | prose |
| Metadata | sans 13–14px `ink-soft` | operational context lines |
| Label | sans medium 12–13px, +2% tracking | chips, uppercase labels |
| CTA | sans semibold 15–16px | buttons |
| **Numeric** | sans semibold, `font-variant-numeric: tabular-nums`, sizes 20→96px | queue position (display 64–96), prices, times, KPIs |

Numbers are a brand asset: queue position, price, slot time and calendar time
always render in the Numeric style — larger and darker than their labels.

## 7. Grid, composition, depth

- Desktop measure: marketing sections compose on a 12-col grid inside 1200–1440
  content width with deliberate full-bleed bands; product surfaces keep the
  proven measures (marketplace wide 75rem+, transactional flows ~34rem,
  profiles 1100–1250px).
- Editorial devices allowed: asymmetric splits (7/5, 8/4), overlapping product
  surfaces onto photography/bands (negative margin, not absolute chaos), wide
  content bands, sticky scenes, intentional crop. Readability always wins.
- Depth comes from **composition first**: background bands, overlap, scale
  difference, occlusion. CSS effects second: one soft ambient shadow token for
  genuinely floating objects (map panel, passport, queue ticket, sticky bars),
  hairline borders elsewhere. No frosted glass, no glow, no heavy elevation
  ramp. Subtle parallax only in landing hero, disabled under reduced motion.

## 8. Photography, casting, lighting (BG-04 material)

- Subjects: contemporary, diverse, fashion-aware urban people; technically
  believable haircuts (crisp skin-fade gradients, clean lineups, real hair
  texture, real skin); barbers with correct tool handling; no scissor-posing,
  no barber pole, no logos, no in-scene text.
- Lighting: fashion-editorial — soft directional key, controlled contrast,
  natural skin rendition; environments are modern studio/shop architecture
  with a restrained green environmental accent (a wall plane, glass tint —
  never a green color flood).
- Every master is generated with **protected negative space** where real HTML
  (search, cards) will sit, and a subject placement that survives a 4:5 crop.

## 9. Creative exploration — four directions, one winner

Per `ARTLIST_CAPABILITY_INVENTORY.md` the account has **2 free image + 1 free
video generations, total, ever**. A 4-direction generated shootout is
impossible; the exploration is executed as full written briefs judged against
the five criteria (desktop hero, mobile crop, subject placement, UI
readability, brand energy + cultural authenticity), and generation is reserved
for the winner.

**A — Editorial Precision.** Fashion-editorial barber craft: one subject with
an immaculate fresh fade, professional hands at work, modern shop
architecture, soft directional light, neutral base + green environmental
accent, wide composition with reserved left/right negative space.
*Judgement:* communicates barbers-booking-craft in under a second; crops to
4:5; ages well; casting risk manageable in one frame.

**B — Urban Premium.** Premium streetwear-campaign city energy: subject
post-cut in the city, architecture, day-to-dusk sophistication.
*Judgement:* strong energy but weakest booking signal (reads sneaker campaign
before barber product) and highest multi-asset appetite — needs a city series
to hold together, which the credit budget cannot supply.

**C — Product Cinema.** The product is the star: real React surfaces layered
over soft studio-light material backgrounds.
*Judgement:* zero fabrication risk and cheap, but with today's media-less
data (no photos, no reviews) the product surfaces alone cannot carry
desire — it risks "beautiful empty software".

**D — Abstract Brand World.** Pearl/graphite/green material world, light and
texture, no people.
*Judgement:* ownable and safe but fails "understands barber culture" as the
PRIMARY world; material language is still adopted as the supporting system
(BG-05/06 are exactly this).

**WINNER: A — Editorial Precision**, with D's material language as the
supporting system for signature objects and C's product-theater as the hero's
foreground (real UI over the photograph — mandated by the brief anyway).

Why it wins: it is the only direction whose single image answers "barbers,
booking, craft, premium" in the first three seconds (§28 requirement); it
converts because the haircut is the product's emotional payload; it works
mobile by construction (subject placement rule); it scales globally (casting
rotates, grammar stays); it ages well (editorial light does not date the way
trend-graphics do).

## 10. Artlist spend plan (exact)

| Slot | Use | Model intent | Status |
| --- | --- | --- | --- |
| Image 1 | Direction-A desktop hero master, 3:2 or 16:9 at 2K+ (Seedream 5.0 / Nano Banana Pro tier), prompt engineered for protected negative space + 4:5 crop survival | text-to-image | to spend in Phase V2 |
| Image 2 | Reserve: retry of Image 1 on casting/hands/hair failure, OR second scene (Culture section) if Image 1 is right first time | text-to-image or I2I edit | hold |
| Video 1 | Only after hero approval and only if a 5–8s silent loop clearly beats the still (I2V from the approved master, free-eligible Kling 2.5 Turbo Pro tier) | image-to-video | default: unspent |

Estimated credit usage: 0 credits (free slots only). Everything beyond is
blocked on an Artlist subscription — flagged to the product owner. Fallback if
both image slots fail quality review: the landing hero ships on BG-05/BG-06
material composition (D-language) with real product theater, which the system
is designed to support without any generated asset.

## 11. Asset governance

Folders (created when the first asset lands):

```
apps/web/src/assets/brand/          (exists — marks, lockups)
apps/web/src/assets/marketing/home/ hero masters + derivatives
apps/web/src/assets/marketing/pro/  pro-section product frames
apps/web/src/assets/editorial/      culture/onboarding editorial stills
apps/web/src/assets/textures/       grain/material SVG + tiles
```

Every generated asset records in `docs/design/ASSET_PROVENANCE.md`: filename
(descriptive), purpose, tool + model, generation id, dimensions/AR,
optimization (AVIF/WebP sizes emitted), responsive usage, alt behavior
(decorative → empty alt), provenance/license note. Masters are never shipped
raw: build emits AVIF+WebP at 2560/1600/1080/720/480, hero `<picture>` with
art-directed mobile source, `fetchpriority="high"` on the LCP image only.

## 12. Motion

`MOTION_SYSTEM.md` remains the law; V3 adds no second system. Signature
applications: hero environmental parallax (marketing only, reduced-motion
kills it); search → marketplace continuity; result → profile spatial
continuity (View Transitions where supported, deliberate fade fallback);
booking progressive transform with 160ms settle; queue position single
vertical counter-roll; passport tilt ≤4° pointer-follow with light response
(BG-06), off under reduced motion; nav icon nudge on activation only. Timing
bands and spring character per the doc; nothing else animates.

## 13. Per-surface strategy (delta from R5R plan)

The Fresha-derived IA in `R5R_FRESHA_REDESIGN_PLAN.md` §2 remains the
information-architecture baseline (it is data-verified); V3 replaces its
*visual* execution:

- **Landing** — full editorial rebuild (Phases V2–V3): hero (BG-04 + real
  search + one result card + one signature object), Discovery (list+map proof,
  BG-01 in a BG-02 band), Culture (BG-04 editorial), Booking demo (real V3
  steps, scroll-linked but legible static), Independents (map environment +
  professional card), Queue scene (BG-05, ticket object), Passport reveal
  (BG-06), Follow-your-barber, Pro (BG-03, real V3 pro frame, outcome copy),
  honest trust layer (no fake counters), SEO-ready semantic sections.
- **Marketplace** — the strongest commercial surface: desktop 45/55 list+map
  with sticky map, price-pill markers, linked hover states; mobile list-first
  with compact chip rail; three candidate card systems designed in code and
  judged in browser before adoption (media-led / compact-informational /
  hybrid); no giant empty image frames while media contract is absent.
- **Queue** — signature screen: full-viewport pass composition on BG-05,
  display-numeral position, die-cut ticket silhouette, realtime roll.
- **Passport** — signature object: layered SVG pass on BG-06, real fields,
  QR, tilt/light response; edit is a sheet, the pass is never a form.
- **Barber profile** — Instagram grammar within truth gates (claimed vs
  placement split untouched).
- **Venue profile** — Fresha venue IA with typographic header while media is
  absent; services as commerce; sticky Book with from-price.
- **Booking** — context chips, date rail, day-part slot groups, sticky
  confirm; ~34rem transactional measure.
- **Pro** — BG-07 only. Operational worklist dashboard (NOW/QUEUE/NEXT),
  dense calendar (compact blocks, strong now-line), CRM summary band,
  windowed analytics with product-designed charts. No cinematic anything.

## 14. Responsive art direction

Landing reviewed at 390/430/768/1024/1440/1920; app at 390/430/1440. Each
breakpoint family is art-directed: hero uses separate mobile crop (or the
protected-crop master), marketing splits collapse to intentional stacked
scenes (not squeezed columns), product surfaces keep the one-grammar rule
(rows stay rows; desktop changes the page, not the row). No accidental voids
at 1440/1920: wide sections either extend content (map, calendar columns) or
band the background, never stretch a mobile column.

## 15. Performance budget

LCP ≤ 2.5s on the landing (hero image preloaded, AVIF, poster-first if video
ever ships); CLS < 0.05 (all media sized, fonts with `font-display: swap` and
metric fallbacks); initial JS for the landing route stays lean (no map bundle,
no charts); hero master ≤ 220KB AVIF at 1600w; no 4K asset ever reaches a
phone; grain/material as tiny tiled SVG/PNG (<10KB). Motion compositor-only.

## 16. Accessibility

Contrast per the existing verified pairs (green on paper 5.09:1, on-graphite
pairs ≥ 7:1 for body); focus ring: 2px green, everywhere; 44px targets
including the desktop top-nav links (fixes the accepted R5R 36px note); full
keyboard paths; semantic landmarks per surface; decorative imagery empty-alt;
reduced-motion parity of function; RTL structural (logical properties, `<bdi>`,
mirrored accents) — the V3 shells inherit the v2 RTL discipline.
