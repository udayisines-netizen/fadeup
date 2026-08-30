# R5R Final Report — Greenfield Frontend, Technical Completion

Date: 2026-08-30
Branch: `rebuild/social-first-v2`
Status: **R5R TECHNICALLY COMPLETE — READY FOR FINAL HUMAN REVIEW**

R5R is not finally approved by this report. The R5R approval gate has two
parts — technical verification and human product/design approval — and this
document closes only the first. Visual polish was deliberately deferred to a
designer; what this phase locked down is information architecture, product
logic, truthful states, real backend integration and i18n.

---

## 1. What was built

All fifteen R5R lots, each committed individually with its own gate
(focused tests → typecheck → lint → production build → authed browser QA at
390/430/1440 → fix findings → scoped commit):

| Lot | Surface | Commit |
| --- | --- | --- |
| R5R.1A | Customer shell + Home (approved separately) | `12d1f28` |
| R5R.1B | Marketplace + search | `6318715` |
| R5R.1C | Barber profile | `b79c86d` |
| R5R.1D | Barbershop profile | `51b6de3` |
| R5R.1E | Booking | `e5e8648` |
| R5R.1F | Appointments + Book again | `190746b` |
| R5R.1G | Live queue | `6eda796` |
| R5R.1H | Customer profile + activity | `7258bd6` |
| R5R.1I | Fade Passport | `4a15296` |
| R5R.2A | Pro shell + dashboard | `2502027` |
| R5R.2B | Pro calendar | `53e24f1` |
| R5R.2C | Customers CRM | `e9824c1` (+ `01baf01`) |
| R5R.2D | Analytics | `5e14942` |
| R5R.2E | Retention + memberships | `c489187` |
| R5R.2F | Profile editor + onboarding tail | `3a5b1d8` (+ `11cbecb`) |

Everything lives in the isolated preview namespace — customer at
`/_preview/r5r`, professional at `/_preview/r5r/pro` (behind the existing
`RequireAuth`) — beside the canonical routes, which were not switched.
During the autonomous completion run nothing was deployed, no migration was
applied, nothing was pushed, and R6 was not started. (The
`marketplace_supply_type` migration that customer-v2 consumes was applied to
the live database earlier, during the separately-approved R5R.1A backend
supply-contract lot — it is live by that approval, not by this run.)

After the independent reviews, one further commit (`e24e086`) fixed their
findings — booking availability landing, signed-in prefill, slot-conflict
recovery, service deep-links, multi-location deep-link branch choice, R3
funnel instrumentation across all v2 customer surfaces, the anonymous
language override in both shells, two-tap cancel with an error surface,
Book-tab loading/error states, and 44px touch targets — with focused tests
covering the new behavior. That commit sits outside the per-lot gates by
construction: it is the audit's own findings pass.

## 2. Architecture decisions that held

- **Zero parallel layers.** Every read and write goes through the existing
  TanStack Query modules in `src/lib/queries`. One additive hook was added
  to an existing module (`useOrgAppointmentsSince` in `appointments.ts`) for
  the retention win-back arithmetic; no new API client, auth path, realtime
  channel type or state system exists.
- **Zero database changes during the master run.** Every surface was
  satisfiable through existing contracts.
- **Marketplace supply model.** Customer surfaces consume the RPC-derived
  `marketplace_supply_type` (`independent` | `barbershop` | NULL) and a test
  bans the internal business-type vocabulary from customer-v2 code.
- **Role gates mirror RLS, never replace it.** Plan management renders for
  owner/manager, enrollment for owner/manager/receptionist, profile editors
  for owner/manager — each matching the RLS boundary that actually enforces
  it server-side.
- **Timezone correctness** via the existing `lib/calendar/time` helpers;
  drag-reschedule on the pro calendar performs no optimistic move (server
  confirm, then realtime refetch).

## 3. Truthful absences (backend gaps, not UI omissions)

Recorded in each file's header at the point of omission:

1. **Revenue / margin / forecast** — appointment rows carry no charged
   amount; `get_calendar_appointments` joins the *services* table's current
   price, so summing history would misstate any visit predating a price
   change. Dashboard, CRM, analytics and retention all decline to invent it.
2. **Analytics location scope** — `get_organization_analytics_summary` has
   no location parameter; the panels state the whole organization and say so
   when a location scope is active. Only the daily completed series narrows
   (server-side `p_location_id`).
3. **Promotions / discount codes / campaigns** — no table, RPC or delivery
   contract exists; the retention page ships memberships (real
   `membership_plans` / `customer_memberships` rows) and a win-back list with
   the customer's own contact data instead of a send button that goes
   nowhere. No SMS anywhere, per product rule.
4. **Queue join** — the customer queue page ships zero join affordances;
   joining remains QR + proximity, and the rule was not weakened.
5. **Portfolio media, avatar upload** — no media/storage contract for
   either; neither is faked.
6. **Customer privacy toggles, org-follow names** — no contracts; count-only
   or omitted.

## 4. Deterministic verification (final run)

- Full test suite: **880 passed / 880** (97 files), including the focused
  specs added for the review corrections (availability landing, auto-answered
  barber, signed-in prefill).
- TypeScript: clean (`tsc -b --noEmit`).
- Lint: **0 errors**, 27 warnings — none introduced by v2 code except one
  fast-refresh DX warning in `pro-v2-shell.tsx` (the `useProScope` hook is
  exported beside the shell component by design).
- Production build: clean (single chunk-size warning, pre-existing).
- Locale parity: all 10 locales carry identical key sets (plural forms
  padded to the union across locales); no hardcoded user-facing strings in
  v2 code (enforced by tests).

## 5. Browser matrix

Fifteen routes (nine customer, six authed pro) × 390/430/1440, English,
via the extended harness `e2e/r5r-final/sweep.mjs` (probes: horizontal
overflow, clipped text, sub-44px touch targets, unnamed controls, missing
alt, h1 presence, box-shadow ban inside `[data-fu-v2]`, console errors,
failed requests, 4xx/5xx responses).

Result (English, final build): **45/45 combinations free of console errors,
page errors, failed requests, 4xx/5xx responses, horizontal overflow,
clipped text, unnamed controls, missing alt text, missing h1 and
box-shadows; 36/45 fully clean.** The nine remaining findings are one
shared, accepted note: the customer shell's desktop top-navigation links are
36px tall on 1440px captures. That nav renders only at desktop widths
(mobile uses the 44px bottom tab bar), 36px exceeds WCAG 2.2's 24px target
minimum for pointer input, and the shell is part of the separately-approved
R5R.1A — left for the design pass rather than changed post-approval.
Screenshots for every combination were captured; the representative set is
committed under `docs/frontend/artifacts/r5r-final/`.

RTL: the same sweep under `QA_LOCALE=ar` (probe records `dir`).
Reduced motion and keyboard order: `e2e/r5r1a/states.mjs`.

Result (Arabic): **`dir="rtl"` on all 45 combinations, with zero overflow,
zero clipping and zero console errors** — logical properties and `<bdi>`
isolation hold across every surface, including the pro cockpit. The only
findings are the same desktop top-nav note as the English run. The
reduced-motion, keyboard-order, focus, empty/error-state and card-overlay
probes from `states.mjs` all completed with their captures
(`home-reduced-390` is in the committed set).

## 6. Independent reviews

**Security (security-auditor): PASS.** No RLS weakening, no parallel auth, no
client-fabricated tenant scope, no secret exposure, no queue-join bypass, no
injection surface; anonymous booking reuses the existing claim flow and the
passport share token is server-generated with a server-clamped TTL. Three LOW
hardening notes, all backend-owned and none blocking: (a) the win-back read
pulls 180 days of appointment rows client-side — an org-scoped RPC returning
only `customer_id, last_completed_at, has_upcoming` would scale better;
(b) win-back customer contact details render to every org role, consistent
with the `is_org_member` SELECT policy — narrowing that is an RLS decision
first; (c) `customer_memberships.created_by` and the period arithmetic are
client-supplied — a trigger defaulting `created_by = auth.uid()` would harden
the audit trail.

**Product/design/code (opus-reviewer): NOT PASS on first pass**, with one
blocker (the QA account then still existed while §8 claimed otherwise — a
sequencing failure of this report, corrected above and closed by the cleanup
record) and four HIGH findings (booking dead-day landing, missing R3
instrumentation, missing anonymous language override, signed-in re-typing).
Every BLOCKER/HIGH/MEDIUM finding was fixed in commit `e24e086` and the
booking corrections were re-verified in a live browser against the real
zero-slots-today data the reviewer used. LOW/NIT items deliberately not
taken now, each a conscious decision: the pro nav scroll strip and missing
pro sign-out (preview shell; canonical `/app` keeps account controls), the
global 404 for unknown preview paths, neutral artwork for a NULL supply
type, the verified-badge idiom question (a designer call), and the
pre-existing router `HydrateFallback` warning.

## 7. Known limitations for the human review

- Visual design is intentionally plain; the v2 token system
  (`data-fu-v2` plates/chips/Notice) is a foundation for a designer, not a
  finished skin.
- Booking is barber-first because `get_public_available_slots` requires
  `p_barber_id`; an "any professional" path needs a backend contract.
- The win-back list uses a fixed, plainly-labelled 60-day threshold over a
  180-day lookback; both constants are one-line changes.
- The daily analytics series buckets in the viewer's timezone (documented in
  the file header) — exact for the ordinary case of an operator in their own
  shop's timezone.
- Defects discovered against pre-existing surfaces during the run are in
  `docs/frontend/R5R_DEFECTS_FOUND.md` (D-1…D-7) and were deliberately not
  fixed inside R5R lots.

## 8. QA hygiene

The local QA login (`r5r-qa-owner@fadeup.test`, owner membership on
side-agency) existed only for authed browser QA; the deletion record below
states exactly what was removed and when, and the FINAL sweep harness takes
its credentials from `QA_PRO_EMAIL`/`QA_PRO_PASSWORD` at run time — no
credential is committed anywhere in the tree.

Deleted on 2026-08-30, after the final authed sweep and before this report
was committed, in one transaction: 1 row from `public.memberships`, 1 from
`auth.identities`, 1 from `auth.users` (user
`facade00-0000-4000-8000-000000000a01`); verified zero rows remain for
`r5r-qa-owner@fadeup.test`. The uncommitted `qa-tmp.mjs` scratch script that
carried the password was deleted from the working tree.

Separately: seven quarantined R5R.1A fixture organizations remain in the
database, renamed `ZZ dead R5R1A fixture…` and `marketplace_visible=false`.
They are unreachable through every public contract (verified via the search
RPC) but cannot be deleted because `commercial_plan_changes` is append-only —
recorded as defect D-7 in `R5R_DEFECTS_FOUND.md`, decision on an audited
cleanup path belongs to the product owner.

## 9. Tag

Local annotated tag `backup/post-r5r-complete-20260830` —
"FadeUp R5R greenfield frontend technically complete". Not pushed.
