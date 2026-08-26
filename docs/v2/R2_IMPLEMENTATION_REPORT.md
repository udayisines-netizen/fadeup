# R2 — Pricing and Entitlements Foundation

Status: **Complete (2026-08-26).** Branch `rebuild/social-first-v2`, on top of
R1A and R1B.

R2 gives FadeUp a commercial model the database can enforce: eight canonical
plans, four commercial families, real capacity limits, one entitlement
resolver, and a plan-assignment path no client can reach. It is **not** the
billing lot — no provider is chosen, no payment is fabricated, and nothing here
takes money.

---

## 1. Starting state

### What existed

| Surface | State before R2 |
| --- | --- |
| `apps/web/src/lib/commerce/plans.ts` | 7 plans (`solo`, `shop_essential/pro/business`, `multi_growth/pro/scale`), 30 capabilities with `live`/`planned` + `evidence`, `locationLimit` 1/1/1/1/2/5/10. Its own header: *"this is a DISPLAY and PACKAGING matrix … not authorization"*. |
| `apps/web/src/lib/commerce/pricing.ts` | 6 regions × 7 plans in minor units. The `eu` column already matched the canonical matrix exactly (1900/2900/4900/7900/9900/14900/24900). No `free`. |
| `/for-business` | Data-driven from that catalog. Sound. |
| **`/pricing`** | **A second, contradictory pricing truth — routed and live.** Hardcoded tiers `Starter / Growth / Multi-Location`, *"Unlimited locations"*, its own 10-row comparison table, and a ✓ against **Chair Mode**, which `plans.ts` marks `planned` because it is not built. |
| Database | **Nothing.** No plan, subscription, entitlement, capability or feature-gate table. `grep stripe` returned zero hits in `db/migrations` and `apps/web/src`. |
| Worker V2 | **No FadeUp commercial assumptions at all.** `publishes_pricing` is a signal about a *prospect's own website*; `runSearchPlanJob` is a search plan. Both unrelated. |
| `docs/v2/PRODUCT_CONSTITUTION.md` §6 | Obsolete: Independent €20; Shop Essential/Pro/Scale €35/€49/€69 **per location**. |
| `docs/v2/ENTITLEMENTS_DRAFT.md` | Proposed a `subscription_seat` row **per billed location** to make per-location billing "real rather than a number in a marketing table". |

### What was actually enforceable

Nothing. `?plan=` was discarded at registration, and **no feature anywhere in
the app was gated on a plan**. `public.locations` is written by a direct
PostgREST INSERT under an owner/manager policy, so a single-salon shop could
open a browser console and create its eleventh address; the only thing standing
in the way was a number rendered on a page.

### Hardcoded-pricing sweep

Every occurrence of `19/20/29/35/39/49/69/79/99/149/249` and their minor-unit
forms was classified rather than replaced. Findings:

* **Obsolete subscription prices existed in exactly one place:** Constitution §6.
* `price_cents: 3500`, `priceCents: 2000`, `€35.00` in tests and
  `lib/onboarding/templates.ts` are **haircut prices**, a shop's own service
  catalog. Unrelated; untouched.
* `6900`, `3900` in `pricing.ts` are **UK and Canadian** amounts for *different*
  plans (`uk.salon_business`, `ca.salon_essential`, `ca.salon_pro`). They are
  pre-existing regional commercial decisions, documented in
  `docs/design-2026/for-business.md` as awaiting per-region sign-off. Not the
  obsolete EU prices; untouched.

---

## 2. Contradictions found, and how they were resolved

1. **Constitution §6 vs. the authoritative R2 model.** The authoritative model
   wins. Resolved by an **explicit written amendment** — the Constitution's own
   preamble requires one — recorded as v1.1 in its amendment table. The
   "billing unit is the location" rule is not softened; it is **reversed**.
2. **`ENTITLEMENTS_DRAFT.md` §2/§3 (`subscription_seat` per billed location).**
   Directly contradicts "no generic per-location pricing". Not built. The draft
   now carries a superseded banner naming exactly which parts are wrong and
   which survived.
3. **`shop_*` (application) vs. `salon_*` (authoritative).** The *database* had
   no naming convention to retain, so the canonical keys win. The application
   was renamed; `?plan=shop_pro` links still resolve through an explicit alias
   map, because dropping a visitor's stated intent to tidy a rename is a poor
   trade.
4. **Two live pricing pages.** `/pricing` was the wrong one and was rebuilt from
   the catalog.

---

## 3. The commercial model

### Four families, eight plans

`public.commercial_family` — `free | independent | salon | multi_salon`. This is
a **third axis** and duplicates neither of the two that already existed:

| Axis | Question it answers | Where |
| --- | --- | --- |
| `organizations.business_type` | What kind of business is this? (`solo_professional`, `barbershop`, `hair_salon`, `mixed_salon`, `multi_location`) | Editable configuration. Drives onboarding. Says nothing about money. |
| `BusinessMode` (frontend) | Which marketing narrative is being told? | Never persisted. |
| **`commercial_family`** | **What is FadeUp owed, and what capacity is granted?** | The only axis an entitlement decision may consult. |

### The catalogue

| plan_key | family | display | € /month | max establishments | max operational professionals |
| --- | --- | --- | --- | --- | --- |
| `free` | free | Free | 0 | 1 | 1 |
| `solo` | independent | Solo | 19 | 1 | **1** |
| `salon_essential` | salon | Essential | 29 | 1 | `NULL` (unlimited) |
| `salon_pro` | salon | Pro *(recommended)* | 49 | 1 | `NULL` |
| `salon_business` | salon | Business | 79 | 1 | `NULL` |
| `multi_growth` | multi_salon | Growth | 99 **total** | 2 | `NULL` |
| `multi_pro` | multi_salon | Pro *(recommended)* | 149 **total** | 5 | `NULL` |
| `multi_scale` | multi_salon | Scale | 249 **total** | 10 | `NULL` |

**Identity is the key, never the label or the price.** `display_name` carries
no unique constraint — deliberately, because "Pro" is legitimately the label of
both `salon_pro` (€49, one salon) and `multi_pro` (€149, up to five). The
migration asserts that two rows *do* read "Pro", so anyone who "fixes" it by
renaming one trips a check and has to read why.

### No per-seat, no per-location — by construction

The only defence against a future `price × count` that actually works is for
there to be no count. So:

* exactly **one** price column (`price_minor`) plus its currency;
* capacity columns are **caps**, named `max_*`, never `quantity_*` or
  `included_*`;
* **no** seat, unit, quantity, headcount or `per_*` column anywhere on a
  commercial table.

`20260826110700` asserts that absence at migration time and fails the install if
a matching column ever appears. `scripts/generate-master-r2.sh` additionally
greps the generated MASTER for `price_minor *` arithmetic and for `per_seat` /
`seat_count` / `per_barber` / `per_location_price`.

**`NULL` means unlimited, deliberately rather than a large number** — a large
number is a multiplier waiting to be discovered.

### Free is a state, not a failure

Free grants `marketplace`, `publicProfile`, `services`, `availability`,
`passport` — and nothing else. No booking, no customer records, no team, no
queue. That is the honest reading of *"Soyez visible"*, and it is what makes
Solo at €19 an upgrade rather than a formality. The migration asserts free's
capability set is **strictly smaller** than solo's.

Fade Passport is in **every** plan including Free, asserted in the migration and
in the application test suite. A customer owns their Passport and carries it
between shops; paywalling it would break the thing that makes it worth having.

---

## 4. Schema changes

Five tables, three enums, sixteen functions, and six behavioural triggers
(plus the schema's standard `set_updated_at` triggers on the new tables). Eight
append-only migrations, `20260826110000`–`20260826110700`.

| Migration | What it does |
| --- | --- |
| `…110000_commercial_plan_catalog.sql` | `commercial_family` enum; `commercial_plans`, `commercial_capabilities`, `plan_capabilities`; the seed; the self-assertion blocks. Asserts R1A+R1B preconditions and refuses to install without them. |
| `…110100_organization_commercial_state.sql` | `commercial_status` + `entitlement_source` enums; `organization_commercial_state`; append-only `commercial_plan_changes`; the new-organization default trigger. |
| `…110200_commercial_state_backfill.sql` | One INSERT-only pass giving every pre-existing organization commercial state. Three post-conditions. |
| `…110300_entitlement_resolution.sql` | `private.effective_plan_key`, `org_has_capability`, `assert_org_capability`, `org_active_establishments`, `org_active_professionals`; public RPCs `get_organization_entitlements`, `my_organization_has_capability`. |
| `…110400_establishment_capacity_enforcement.sql` | `enforce_establishment_capacity()` + trigger on `locations`. |
| `…110500_operational_professional_capacity.sql` | `private.assert_professional_capacity`; triggers on `barbers` and on `staff_profiles` reactivation. |
| `…110600_plan_assignment_controls.sql` | `enforce_commercial_state_integrity()` trigger; `assign_commercial_plan()` RPC; privilege re-assertion. |
| `…110700_r2_privilege_hardening.sql` | The whole privilege/RLS/`search_path`/EXECUTE matrix, re-asserted and **failed loudly** if wrong; the pricing-model structural assertions; R1A/R1B regression assertions. |

### Foreign keys — every one chosen, not inherited

| FK | On delete | Why |
| --- | --- | --- |
| `organization_commercial_state.organization_id` | **CASCADE** | Commercial state is meaningless without its organization, and an orphan row would let a recreated slug inherit a stranger's plan. This cascades **into** the commercial model, never out of it. |
| `organization_commercial_state.plan_key` | **RESTRICT** | A plan an organization is on cannot be deleted out from under it. |
| `organization_commercial_state.assigned_by` | **SET NULL** | Erasing a staff account must not dead-end on a foreign key or destroy an organization's commercial state. |
| `plan_capabilities.plan_key` / `.capability_key` | **RESTRICT** | Removing a plan or a capability that is still packaged must be a visible act, never a cascade that silently shrinks four plans. |
| `commercial_plan_changes.organization_id` | **CASCADE** | History follows its organization. |
| `commercial_plan_changes.previous/new_plan_key` | **RESTRICT** | History must keep naming a real plan. |
| `commercial_plan_changes.changed_by` | **SET NULL** | The actor may be erased; the record stays. |

**Commercial deletion never cascades into social identity.** Deleting a plan,
or an organization's commercial state, deletes no professional, no follow, no
Passport, no appointment. R1B's guarantees are untouched and re-asserted.

---

## 5. The effective resolver

```
authenticated actor
     ↓  private.is_org_member / has_org_role / is_platform_admin
membership or ownership
     ↓
organization
     ↓  organization_commercial_state (exactly one row)
commercial plan + status
     ↓  effective plan — status applied HERE, once
plan_capabilities
     ↓
allow / deny, with a reason
```

The actor is resolved from `auth.uid()` and **never** from an argument. The
organization id *is* an argument — the caller is asking about something — but it
is a **question, not a credential**: every entry point re-derives the caller's
relationship before answering.

### Status semantics, applied once

| status | effective plan | rationale |
| --- | --- | --- |
| `active` | the assigned plan | — |
| `past_due` | **the assigned plan** | A failed payment is a conversation, not a shutdown. Access is preserved while it is resolved. |
| `canceled` | **`free`** | The organization keeps its identity, establishments, customers, professionals and history, and drops to network presence. Caps then apply going forward: a cancelled five-location group keeps all five and can create no sixth. |

`plan_key` is never rewritten by cancellation, so the history stays legible and
`effective_plan_key` derives rather than destroys.

### `planned` capabilities resolve FALSE for everyone

`org_has_capability` requires `commercial_capabilities.status = 'live'`. The
honest answer for a capability FadeUp has not built is no — for every plan, at
every price. Packaging is still recorded (the pricing surface still says "on the
roadmap"), but a gate that opened `salon_business` onto `retentionAutomation`
would be opening onto nothing.

### Fails closed on every unknown

Missing state, unknown plan, unknown capability, `NULL` argument — all false.
Written as an explicit positive match rather than `not exists`, because the
`not exists` form fails **open** on a typo'd capability name, which is precisely
what makes a gate decorative.

---

## 6. Enforcement boundaries

### Hard, in the database

| Invariant | Mechanism | Fires for |
| --- | --- | --- |
| Establishment capacity | `BEFORE INSERT OR UPDATE OF is_active, organization_id` on `locations` | every writer, incl. `service_role` and `postgres` |
| Solo/Free professional cap | `BEFORE INSERT` on `barbers` + `BEFORE UPDATE OF is_active` on `staff_profiles` | every writer |
| Downgrade must not orphan capacity | `BEFORE UPDATE` on `organization_commercial_state` | every writer |
| Plan assignment authorization | `assign_commercial_plan()`, platform-admin only, plus **zero** client write privilege and **zero** write policy on the table | — |

**Why triggers, not RLS `with check`:** `service_role` and `postgres` both hold
`BYPASSRLS` in this stack (verified against the running image, not assumed), so
a cap expressed as a policy would hold for the browser and evaporate for every
server-side path — the wrong way round for a *commercial* rule. A `with check`
also cannot take a lock, so it cannot be made race-free.

There is **no session-GUC override** on any capacity trigger, deliberately: a
magic setting is a bypass a future RPC could learn to set. A restore that must
exceed capacity uses `pg_restore --disable-triggers` (explicit and loud) or an
audited plan change. `20260826110700` and VERIFY 13.02 both assert no capacity
trigger calls `current_setting`.

### What counts

* **establishment** = an **active** `locations` row. A deactivated location is
  not being operated, so it consumes no capacity — which is what makes
  deactivation the non-destructive route back into compliance, and why
  *reactivation* is a capacity event too (otherwise "deactivate → downgrade →
  reactivate" is a three-step bypass).
* **operational professional** = a `barbers` row whose `staff_profiles` row is
  **active**. Deliberately *not* `count(barbers)`: R1A made offboarding a
  deactivation rather than a deletion, so counting every row ever created would
  make a long-lived shop permanently over capacity for people who left, turning
  R1A's durable history into a punishment.

Both counts are defined **once**, in `private.org_active_establishments` /
`org_active_professionals`, so the triggers, the plan-change guard and the read
RPC cannot disagree about what a word means.

### Deliberately NOT hard-enforced, and why

R2 does **not** gate booking, the queue, customer records or retention at the
database boundary. Those capabilities resolve through the same resolver and the
UI consumes it, but switching hard enforcement on would **silently remove
working behaviour** from organizations that have used it throughout early
access. That is a product decision with its own migration and its own
communication, not a side effect of installing a price list. Stated here rather
than left as an implication: **frontend gating is UX; only the four rows in the
table above are security.**

---

## 7. Authorization model

* `anon`: **nothing.** No privilege on any commercial table, no EXECUTE on any
  R2 function, no policy. The marketing pricing page renders the application's
  compiled catalog, so there is no anonymous read to serve.
* `authenticated`: `SELECT` only, on all five tables, and EXECUTE on exactly the
  two public RPCs. **No INSERT/UPDATE/DELETE policy exists on any commercial
  table for any role** — so `PATCH plan_key = 'multi_scale'` is not a request
  that gets refused, it is a request with no statement to make.
* `prospect_worker`: **nothing**, on every table and every function. R1A
  tightened the acquisition worker precisely because parsing third-party
  scraped content is a materially higher-risk surface than the customer API; it
  discovers prospects and has no business knowing what any tenant pays.
* `service_role` / `postgres`: hold `BYPASSRLS`, so RLS does not constrain them
  — which is exactly why every capacity and integrity rule is a **trigger**.
* Platform roles: `platform_owner` and `platform_admin` may assign a plan.
  **`platform_support` deliberately may not** — `20260810130000` argues that
  support carries no financial authority, and VERIFY 7.10 proves the RPC
  refuses it.
* The organization's **own owner** may not change its plan. The party being
  charged cannot decide what it owes.

`assign_commercial_plan` takes **no actor argument** — asserted by VERIFY 7.19
against `information_schema.parameters`, so a future signature change that added
one would fail the suite.

`entitlement_source` is **hard-coded to `platform_grant`** inside the RPC. No
argument can dress a staff decision up as a payment.

### No cross-tenant existence oracle

`get_organization_entitlements` raises the **identical** `42501` for "not a
member", "belongs to someone else" and "does not exist". VERIFY 6.04 asserts the
two SQLSTATEs are equal rather than merely both being refusals — a friendlier
split would also answer *"does this organization exist?"* for anyone willing to
guess UUIDs.

`my_organization_has_capability` returns `false` rather than raising, and
`false` is indistinguishable across all four "no" cases.

---

## 8. RLS review

All five tables: `ENABLE` **and** `FORCE ROW LEVEL SECURITY`. Enabled alone
exempts the table owner, and several definer functions run as `postgres`.

| Table | SELECT policy |
| --- | --- |
| `commercial_plans`, `commercial_capabilities`, `plan_capabilities` | `authenticated`, `using (true)` — this is the published commercial offer, and reading it is what lets the application prove at runtime that its catalog has not drifted. |
| `organization_commercial_state` | org **member** or platform admin. |
| `commercial_plan_changes` | org **owner/manager** or platform admin — a receptionist or barber has no business reading their shop's commercial decision history. |

**Write policies: none, anywhere.** The database's count of `anon` policies is
still **zero**, unchanged since it shipped; R1B asserted it and R2 adds none.
Asserted globally in `20260826110700` and again in VERIFY 12.05, and the MASTER
generator greps for `to anon` on any `create policy`.

---

## 9. SECURITY DEFINER review

Sixteen R2 functions. Every one:

* has `search_path` **pinned** (`set search_path = ''`) and every name
  schema-qualified. Asserted for *all* R2 functions, not only the definer ones —
  an unqualified name resolves through the **caller's** `search_path` either
  way, which is a privilege-escalation primitive: a caller creates their own
  `commercial_plans` in a schema they control and the function reads capacity
  from there. Definer functions make that worse, not different.
* resolves the actor from `auth.uid()` — which reads the JWT claims GUC and is
  unaffected by the definer's role switch, so it always checks the real caller
  and never `current_user`.
* has EXECUTE **revoked** from `PUBLIC` and `anon`.

The seven `private.*` helpers are callable by **no client role at all** —
asserted in `20260826110700` §2e and VERIFY 12.13. A directly callable
`private.org_has_capability(uuid, text)` would answer questions about any
organization in the database.

**A defect found and fixed during review:** Postgres grants `EXECUTE` to
`PUBLIC` by default on every new function, including the six R2 **trigger**
functions, so `anon` could call `enforce_commercial_state_integrity()` and
`handle_new_organization_commercial_state()` by name. VERIFY 12.12 caught it.
Fixed by explicit revokes in `20260826110700`, which now also asserts the
result. Because Postgres checks EXECUTE when a trigger is **created** and not
when it fires, the revoke is safe — and VERIFY **9.40–9.43** now prove that
empirically, by driving both caps as a real `authenticated` owner and asserting
the refusal is `P0001` (the trigger ran and said no) rather than `42501` (a
privilege stopped it).

---

## 10. Concurrency

Every capacity check takes `SELECT … FOR UPDATE` on the organization's **single**
commercial-state row before counting. That row is exactly-one-per-organization
because `organization_id` is its primary key — a property that is load-bearing
rather than tidy: if an organization could have two commercial rows, two
transactions could lock different ones and both pass the same cap check.

Counting alone is never enough. Two managers pressing "add location" at the same
instant both count 2, both conclude one more fits, and both insert. With the
lock, the second transaction **blocks** until the first commits or rolls back,
and only then takes its count — under READ COMMITTED that is a fresh statement,
so it sees the committed sibling row.

A real row lock rather than an advisory lock keyed on a hashed UUID, because it
shows up in `pg_locks` as what it is and is released by ordinary transaction end.

`assign_commercial_plan` takes the **same** lock, so "downgrade while another
location is being created" cannot interleave into a state where both succeeded.

### `scripts/r2-concurrency-test.sh`

VERIFY runs in one session, so its refusals prove serialized contention, not a
race. This script fires genuinely simultaneous connections. **7/7 scenarios pass
at `RACERS=8` and again at `RACERS=24`:**

| # | Scenario | Result |
| --- | --- | --- |
| 1 | `multi_growth` at 2, N racers for a 3rd | 2 active (cap 2) |
| 2 | `multi_pro` at 5, N racers for a 6th | 5 active (cap 5) |
| 3 | `multi_scale` at 10, N racers for an 11th | 10 active (cap 10) |
| 4 | `salon_pro` **empty**, N racers for the FIRST — nobody has won, every racer counts 0 | exactly 1 |
| 5 | `solo` empty roster, N racers each rostering their **own** profile | exactly 1 |
| 6 | A downgrade racing N location creations | ended coherent: active ≤ the cap of the plan it ended on |
| 7 | N simultaneous plan assignments | exactly 1 state row, one coherent final plan, an audit row per applied change |

Scenario 4 is the sharpest: with no prior winner, every racer counts zero and
every racer believes it may proceed. VERIFY 13.01 additionally asserts the
`FOR UPDATE` is still present in each function's source, because removing it
would leave every cap above passing while becoming racy in production.

---

## 11. Downgrade protection

**A downgrade fails; it never deletes.** `multi_scale` with eight
establishments cannot become `multi_growth`: the change is refused with an
explanation naming both numbers. Nothing is deactivated, archived or hidden to
make a plan fit.

Enforced **twice**: in the RPC (which produces the good error message) and in a
`BEFORE UPDATE` trigger that fires for `postgres` and `service_role` too, so an
operator running raw SQL at 2am cannot silently put an organization on a plan
that does not cover it. The RPC is the ergonomics; the trigger is the guarantee.

The precise rule: *a change of `plan_key` is refused when the new plan's
capacity is below current usage **and** the new capacity is lower than the old
one.* The second clause lets an already-over-capacity organization move
sideways or upward — without it, the backfilled eleven-location organization
would be frozen forever, unable even to be moved to a plan that helps it, which
would be a rule punishing the wrong party.

**Cancelling is not a downgrade.** `status = canceled` resolves to free capacity,
which a five-location group obviously exceeds — so if cancellation were treated
as a downgrade, an organization that stopped paying could never be cancelled.
Cancellation is always permitted, changes no data, and simply stops growth.

**The route down that works:** deactivate what you no longer operate, first and
deliberately, then change plan. VERIFY 11.10–11.11 walk exactly that path and
assert every deactivated establishment still **exists** afterwards.

VERIFY 11.06–11.08 snapshot locations, professionals, appointments, customers,
Passports, follows and relationship aggregates before the refused downgrades and
assert every count is unchanged after.

---

## 12. Upgrade and backfill

Every pre-existing organization is assigned **the cheapest plan whose capacity
already covers the shape it has today**, with `entitlement_source =
'early_access'` and `provider = NULL`.

| Shape (L = active locations, P = active professionals) | Plan |
| --- | --- |
| L = 0 and P = 0 | `free` |
| L ≤ 1 and P ≤ 1 | `solo` |
| L ≤ 1 | `salon_essential` |
| L ≤ 2 | `multi_growth` |
| L ≤ 5 | `multi_pro` |
| L ≤ 10 | `multi_scale` |
| L > 10 | `multi_scale`, overage recorded in `assignment_note` |

**Nothing is granted that the organization is not already using, and nothing is
taken away that it is.** The tempting alternative — look at a shop using the Pro
workspace and record `salon_pro` — **fabricates a tier**: it decides that this
shop chose the €49 product when nobody ever asked them. So the rule is minimal
instead, and a shop that uses the live queue every day still lands on
`salon_essential`.

### What the backfill is allowed to claim

Not that anyone paid. There is no billing integration in this repository, so
there is no evidence to record. `'early_access'` is a **true statement about the
world** — FadeUp has been telling visitors exactly this on `/pricing` — and the
`organization_commercial_state` CHECK would refuse `'billing'` anyway for lack
of a provider. `20260826110200` asserts, after running, that **zero** rows claim
`billing`.

### The over-capacity case is not resolved by deleting anything

An organization with eleven active locations exceeds every plan FadeUp sells.
It is assigned `multi_scale`, the discrepancy is written into `assignment_note`
so it is discoverable rather than silent, and the trigger refuses a **twelfth**.
Existing data is preserved; growth is what stops.

### Consequences an operator must understand before applying

1. **A one-location, one-professional organization lands on `solo`, and solo
   covers one professional.** The next barber that organization hires will be
   refused until its plan is changed. That is the intended commercial behaviour
   and the most visible effect of applying R2.
2. **New organizations default to `free`**, which covers one establishment and
   one professional — enough to complete onboarding (one location, the owner as
   the one professional) and not enough to add a second barber. Until billing
   exists, `assign_commercial_plan()` is the supported, audited, platform-admin
   path to the plan a shop actually agreed to.

---

## 13. Application changes

| File | Change |
| --- | --- |
| `lib/commerce/plans.ts` | `shop_*` → `salon_*`; added `free`; added `CommercialFamily`, `Plan.family`, `Plan.maxEstablishments` (was `locationLimit`), `Plan.maxOperationalProfessionals`, `plansForFamily`, `familyForPlan`, `FREE_PLAN`; `parsePlanId` maps the legacy `shop_*` keys forward. `Plan.mode` is now nullable — Free is on no marketing rail. |
| `lib/commerce/pricing.ts` | Renamed keys; `free: 0` in all six regions; `missingPlanPrices()` now treats 0 as valid for `free` and as an **error** for any paid plan. |
| **`lib/commerce/catalog.test.ts`** *(new)* | **The synchronisation mechanism.** Parses `20260826110000` and compares it to the compiled catalog: plan keys, families, prices, both capacity caps, recommended flags, tiers, all 30 capability keys with their group and status, and the fully expanded plan→capability matrix. Plus an asymmetry check: the application may never claim a capability the database would refuse. |
| **`lib/queries/entitlements.ts`** *(new)* | `useOrganizationEntitlements` over the resolver RPC, with `hasCapability` / `canAddEstablishment` / `canAddProfessional`. All default to **false** while loading or on error — an entitlement question that fails open on a network error is not a gate. |
| `components/for-business/pricing-stage.tsx` | Uses `maxEstablishments`; renders the supporting sentence **under the price**; renders "team included" driven by `maxOperationalProfessionals === null` rather than a hardcoded plan list. |
| **`pages/pricing-page.tsx`** | **Rebuilt from the catalog.** The Starter/Growth/Multi-Location tiers, "Unlimited locations", the hand-written comparison table and the Chair Mode ✓ are gone. Now: Free band, three family sections, all eight plans, and a full 30-row matrix with three cell states (✓ / Coming / —) where `CAPABILITIES[id].status` decides the cell. Same light marketing design system — R2 changed what the page *says*, not what FadeUp looks like. |
| `locales/*/landing.json` (×10) | `shop_*` → `salon_*`; `free` plan copy; the canonical short label and supporting copy for every plan; `teamIncluded`; a rewritten `/pricing` intro (the old one sold tiers "grouped by location count" — the obsolete model in so many words); four FAQ entries that were previously hardcoded English inside the component. |

**Why a compiled copy of the catalog is allowed to exist at all:** the database
needs it because a trigger cannot ask a TypeScript module whether an
organization may open an eleventh salon; the application needs it because a
marketing page rendered to an anonymous visitor must not depend on a round trip.
Two copies of a price list is exactly how a product ends up quoting different
numbers on different screens — which FadeUp had actually done. `catalog.test.ts`
is what makes two copies safe.

---

## 14. Changes to older VERIFY suites

Both documented **before** being made. Neither weakens anything.

### `VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql`, check 10.7

*Reason:* the check defends "R1A itself creates no table" via an absolute count
of 89 **plus an explicit allow-list of named later-lot tables** (R1B already
extended it once the same way). R2 legitimately adds five more, so the check
would fail for the right reason and hide any wrong one behind it.

*Change:* the five R2 table names were appended to the allow-list.

*Why it is at least as strict:* the allow-list is explicit names. It passes at
89 pre-R1B, 94 post-R1B, 99 post-R2, and still **FAILS** the moment an
unexpected hundredth table appears — which is the property the check exists for.

### `VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql`, fixtures only

*Reason:* R2 gives every new organization commercial state defaulting to `free`,
which covers one professional. R1B's suite deliberately rosters three barbers
into one shop and two into another, because the case R1B exists to prove is one
human cutting hair at two shops. After R2 those inserts are refused, the
transaction aborts, and the suite reports **`PASS=0 FAIL=0`** — which looks like
success and is not. (That is exactly how this regression was discovered.)

*Change:* one guarded `DO` block puts the three fixture organizations on
`multi_scale` immediately after they are created.

*Why it weakens nothing:* it changes the commercial state of a fixture, not an
assertion. All 161 R1B assertions are unchanged and all still pass. The block is
guarded on `to_regclass('public.organization_commercial_state')`, so the file
still runs unchanged against a pre-R2 database. R2's own suite is what proves
the cap actually bites.

---

## 15. Defects found and fixed during R2

| # | Defect | Found by | Fix |
| --- | --- | --- | --- |
| 1 | `/pricing` advertised plans that do not exist, "Unlimited locations", and Chair Mode as shipped | audit | page rebuilt from the catalog |
| 2 | Capability count asserted as 29; the real audited set is 30 | fresh replay | assertion corrected to 30 with the arithmetic spelled out |
| 3 | `search_path` pin assertion used equality; Postgres stores `search_path=""` | fresh replay | prefix match, verified against `pg_proc` on the live stack |
| 4 | `pg_get_constraintdef(c)` — needs the OID | VERIFY run | `pg_get_constraintdef(c.oid)` |
| 5 | Regex `{0,400}`; Postgres caps repetition bounds at 255 | VERIFY run | `{0,255}` |
| 6 | **`anon` held default `EXECUTE` on all six R2 trigger functions** | VERIFY 12.12 | explicit revokes + assertion + empirical proof the triggers still fire (9.40–9.43) |
| 7 | VERIFY asserted every roster row points at an identity — a guarantee R1B **explicitly declines** to make for an account-erasure tombstone | upgrade run | assertion corrected to the real property, plus a new check that the tombstone is left honestly unlinked |
| 8 | R1B's suite silently reported `PASS=0 FAIL=0` under R2 | R1A/R1B regression run | fixture accommodation (§14) |
| 9 | `missingPlanPrices()` rejected `0`, which would make Free indistinguishable from an unpriced plan | catalog work | bound moved to `< 0`, plus a new check that a **paid** plan priced at 0 is still an error |
| 10 | Catalog sync test matched nothing under jsdom (`import.meta.url` is not a `file:` URL) | test run | resolved from `process.cwd()`, with an explicit existence check so a wrong path fails by name instead of passing vacuously |

---

## 16. Test results

### Fresh database — full migration chain from zero (89 migrations)

| Suite | PASS | FAIL | INFO |
| --- | --- | --- | --- |
| `VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26` | **197** | **0** | 2 |
| `VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26` | **161** | **0** | 1 |
| `VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25` | **70** | **0** | 2 |

### Upgrade database — pre-R2 chain (81 migrations) → SEED → MASTER R2 → VERIFY

| Suite | PASS | FAIL | INFO |
| --- | --- | --- | --- |
| `VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26` | **216** | **0** | 2 |

The upgrade run exercises 19 further assertions the fresh run cannot: the
backfill's five branches, the over-capacity case, and non-destruction of every
class of R1A/R1B data (appointments with trustworthy completion, Passport
content and number, follow edges, relationship aggregates, the claimed identity,
acquisition provenance, customers, the served walk-in).

The suite ends with a self-check (15.01) asserting at least 120 checks were
recorded — the guard against an early abort printing `PASS=0 FAIL=0`.

### Concurrency — `scripts/r2-concurrency-test.sh`

**7/7 scenarios pass at `RACERS=8` and at `RACERS=24`.** See §10.

### Worker V2 — exactly at baseline

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass — **3 pre-existing warnings**, unchanged: unused `normalizeBusinessName` import (`jobs/discovery.ts:6`), useless spread (`http.ts:21`), control-char regex (`outreach/template-engine.ts:119`) |
| `npm run test` | **13 files, 225 tests passing** (baseline: 13 / 225) |
| `npm run build` | pass |

R2 changed no Worker file. The worker holds no privilege on any commercial table
and can execute no R2 function.

### Web

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass — only the pre-existing `react(only-export-components)` Fast Refresh warnings |
| `npm run test` | **69 files, 644 tests passing** (baseline: 68 / 578; +1 file and +66 tests, all from R2's new and extended commerce specs) |
| `npm run build` | pass |

### Tooling

* `scripts/generate-master-r2.sh --check` — in sync.
* `scripts/generate-master-r1b.sh --check`, `generate-master-r1a.sh --check` — still in sync; R2 touched neither.
* `bash -n` on all 12 scripts — clean.
* `git diff --check` — clean.

### Known warnings (not regressions)

* Web: `react(only-export-components)` Fast Refresh warnings — pre-existing.
* Web tests: jsdom `Not implemented: HTMLMediaElement.play` / `window.scrollTo`
  noise — pre-existing.
* Web build: the 955 kB `platform-acquisition-map-page` chunk warning —
  pre-existing.
* Worker lint: the three warnings listed above — pre-existing.

---

## 17. Deferred, explicitly

| Item | Why |
| --- | --- |
| **Stripe / any billing provider** | Out of scope. No checkout, no portal, no webhook, no price id, no payment method, no invoice. Three opaque `provider_*` columns exist so the billing lot needs no schema migration; R2 leaves all three NULL and the MASTER generator greps for provider names to keep it that way. |
| **`service_mode`** (`reservation_only` / `queue_only` / hybrid / unavailable) | Out of scope. No column, no enum, no reference. |
| **Mobile app / Expo / React Native / push** | Out of scope. |
| **R3 analytics and event architecture** | Out of scope. |
| **Hard DB gating of non-capacity capabilities** | Reserved with justification (§6). Switching it on would silently remove working behaviour from live organizations. |
| **`barbers.professional_id` → `NOT NULL`** | Reassessed and left. R1B deliberately leaves it NULL for an account-erasure tombstone; making it NOT NULL requires deciding what such an insert should do, which is an identity decision, not a pricing one. Recorded in `ROADMAP.md`. |
| **DB type codegen + the `Database` generic** | Cross-cutting; would have made R2's diff unreviewable. Still open and still worth doing. |
| Social feed, comments, messaging, verified-celebrity UI, public unclaimed-profile rollout | R6/R7/R10. |
| Regional price sign-off (UK/US/CA/CH) | Pre-existing; unchanged by R2 and still awaiting commercial sign-off per `docs/design-2026/for-business.md`. |

---

## 18. Deployment implications

**Nothing has been applied to any live database.** All validation ran in
disposable containers. `fadeup-supabase-db` was read only for schema
introspection and role attributes.

To deploy:

```
psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql

psql -U postgres -d postgres -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
psql -U postgres -d postgres -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
psql -U postgres -d postgres -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
```

Confirm **0 FAIL** rows in all three.

MASTER runs in a single transaction: it either fully applies or fully rolls
back. It removes no table, no column, truncates nothing and — asserted by the
generator — contains **no `DELETE` of any kind**.

### Behaviour changes to expect on the day

1. Every existing organization gains commercial state, on the cheapest covering
   plan, marked `early_access`. No payment is claimed.
2. **A one-location, one-professional organization lands on `solo` and cannot
   add a second barber** until its plan is changed.
3. **New organizations default to `free`** — one establishment, one
   professional. Onboarding still completes; a second barber does not.
4. Creating a location beyond the plan's cap now raises `P0001` with an
   explanatory hint, through every path including PostgREST.
5. `/pricing` shows the real catalog. Anyone linking to `?plan=shop_pro` still
   lands correctly.
6. `assign_commercial_plan()` is the only way a plan changes, and it needs a
   `platform_owner` or `platform_admin`. **Provision at least one before
   applying**, or no organization can be moved off its backfilled plan.

### Rollback

R2 is additive and independent of R1B. Dropping the five R2 tables, the three
enums, the sixteen functions and the six behavioural triggers returns the
database to its pre-R2 behaviour with no R1A/R1B object touched. No R1A or R1B function is
redefined by R2 — asserted by the MASTER generator.
