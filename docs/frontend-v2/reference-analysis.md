# Frontend V2 — reference analysis

What the four supplied references actually specify, and — just as important —
which parts of them FadeUp's backend cannot honestly render today.

The references contain concept data. Copying it would mean shipping invented
ratings, revenue and promotions. Every row below is marked REAL (backend
supports it) or CONCEPT (must not be rendered).

---

## 1. `pro-dashboard-desktop.png` — Professional desktop shell

### Composition
- Near-black canvas, charcoal surfaces lifted by a faint emerald tint.
- **Left sidebar ~230px**: wordmark, icon+label nav, active item as a filled
  pill with a left accent bar, then an organization card, then an upsell card.
- **Top bar**: wide search with a `⌘K` affordance, then notification / calendar
  / messages icons, then an account cluster (avatar, org, role, chevron).
- **Greeting row**: `Bonjour {name}` + subtitle, right-aligned secondary action
  and a primary emerald split-button.
- **Primary operational row is ASYMMETRIC** — NOW ≈ 2/3, NEXT ≈ 1/3. This is
  the single most important compositional decision on the screen: it is what
  stops the page reading as a grid of equal boxes.
- **KPI row**: four tiles, each an icon square + label + large value + delta,
  plus a radial goal at the right edge.
- **Three-column operational row**: Today Flow (time gutter + status rail),
  Queue (rows with an action per row), Insights (icon tile + headline + sub).
- **Full-width performance chart** with a totals rail on the right.

### What FadeUp can render
| Element | Verdict |
|---|---|
| Sidebar, top bar, search, account cluster | REAL |
| Greeting, date, primary action | REAL |
| NOW / NEXT from `get_calendar_appointments` | REAL |
| Appointments today, occupancy, booked value, no-shows | REAL (derivable) |
| Queue rows + waiting count | REAL (`queue_entries`) |
| Today Flow timeline | REAL |
| Avatar photos of customers | CONCEPT — no customer photo column; use initials |
| Caisse / POS | CONCEPT — no payments |
| Marketing | CONCEPT |
| Avis & Réputation | CONCEPT — no reviews table |
| "Objectif mensuel 68%" | CONCEPT — no goal model |
| Revenue / "Chiffre d'affaires" | CONCEPT — no payments. Booked **value** is real; revenue is not. |
| Insights ("Skin Fades durent 37 min") | CONCEPT — no analytics engine |
| "+18% vs hier" deltas | CONCEPT unless the comparison period is actually queried |
| FadeUp Pro upsell | CONCEPT |

---

## 2. `pro-dashboard-mobile.png` — Professional mobile

- Header: wordmark, notification bell with dot, menu. Location switcher row.
- **EN COURS card** dominates: status dot, start time, avatar, name, service,
  duration, a very large elapsed timer, full-width primary action.
- **PROCHAIN card**: oversized time as the anchor, relative countdown, divider,
  then customer, then a compact action.
- **KPI strip**: four columns, icon above value above label. No boxes — a
  single surface divided by whitespace.
- **Agenda du jour**: dot rail, time + duration, avatar, name, service, status
  chip. The active row is tinted and outlined.
- Two half-width cards: queue (avatar stack) and an insight sparkline.
- **Bottom nav with an elevated central FAB.**

### Verdict
Timer, next, agenda, queue, bottom nav, FAB: REAL.
Rating "4,8/5 (29 avis)", "Chiffre d'affaires", sparkline insight: CONCEPT.

---

## 3. `customer-discovery-mobile.png` — Customer marketplace

- **Light theme**, off-white with a mint wash at the top. This is the
  deliberate counterpart to the Professional dark shell.
- Header: large wordmark + a location pill.
- Search field (white, elevated) + a filter icon button.
- Horizontal category chips, each an icon tile + label.
- Section header + chevron, then a **horizontal card carousel**.
- **Listing card**: image with overlaid status pill (top-left), favourite heart
  (top-right) and a floating dark badge (bottom-right); then name + rating,
  location + distance, service tags, "À partir de {price}", then a state chip.
- Dark promotional banner.

### Verdict
| Element | Verdict |
|---|---|
| Search, categories, favourite, distance, city | REAL |
| `is_open_now`, `queue_waiting_count`, `starting_price_cents` | REAL — the search RPCs return exactly these |
| Business photo | CONCEPT — no business image column. Needs a deliberate branded fallback. |
| Rating "4,9 ★" | CONCEPT — no reviews |
| "Prochain rdv 08:30" on the card | CONCEPT — search does not return next availability |
| "-20% aujourd'hui" | CONCEPT — no promotions |
| "Recommandé pour vous" | CONCEPT — no personalisation. Rename to something true. |
| "Offres exclusives" banner | CONCEPT |

---

## 4. `booking-mobile.png` — Booking

- Back + centred wordmark; H1 + subtitle.
- Business identity card.
- **Numbered steps** — a numeral chip beside each section heading.
- **Compact horizontal date strip**, not a month grid. Selected date is
  outlined in emerald and tinted; a dot marks days with availability.
- **Time-of-day segmented control** (Matin / Après-midi / Soir) above a
  4-column slot grid.
- **Recap**: service card and professional card.
- **Sticky bottom bar**: total + primary CTA.

### Verdict
Date strip, availability dots, time-of-day segmentation, slot grid, recap,
sticky CTA: REAL — `get_public_available_slots` gives everything needed.

CONCEPT: struck-through pricing and "-50%" (no promotions), "Meilleur créneau"
and "Disponible plus tôt" (no ranking model), service photos, professional
rating, "Paiement sécurisé" (no payments — and implying payment when none is
taken would be a lie to the customer).

---

## The rule this analysis exists to enforce

Take the **composition, hierarchy, density and craft** from the references.
Take **none of the data**. Where a reference element has no backend behind it,
either drop it or replace it with something FadeUp can actually prove — and
never leave a zero-state that looks like a real value (no "0 ★", no "0 €").
