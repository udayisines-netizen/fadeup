# R5R.1A-R2 — Marketplace entity classification

**Status:** implemented. The domain ambiguity it opened is now closed — see §7
and `docs/frontend/R5R1A_SUPPLY_CONTRACT.md`.
**Branch:** `rebuild/social-first-v2`
**Preview route:** `/_preview/r5r`
**Artefacts:** `docs/frontend/artifacts/r5r1a-r2/`

A product/data-classification correction, not a redesign. The visual language of
R5R.1A-R1 is preserved; the only visual changes are the ones the corrected model
required.

---

## 1. The eligibility rule, exactly

Implemented in `apps/web/src/customer-v2/marketplace-supply.ts`:

```
a row whose entity_type is 'barber'  -> NOT eligible  (reason: staff-of-a-shop)
a row whose entity_type is 'shop'    -> eligible, labelled by the contract's
                                        marketplace_supply_type:
                                        'independent' | 'barbershop' | null
```

Eligibility is enforced twice on purpose: `p_entity_type: 'shop'` is passed to
the RPC so the exclusion happens in Postgres and `total_count` counts only what
the customer can actually see, and `classifyMarketplaceSupply` runs over the
result anyway, so the rule has one stated, tested home.

## 2. How independent supply is identified

An independent professional is their **own organization**, with
`organizations.business_type = 'solo_professional'`, and reaches the customer as
that organization's own bookable location. `supplyTypeOf` maps that single enum
value to `Independent`; every other value is an establishment.

## 3. How barbershop supply is identified

Any active location of a `marketplace_visible` organization whose business type
is not `solo_professional`. The RPC's `shop_base` already emits exactly one row
per active location, so no additional filtering was needed.

## 4. How staff barbers are excluded

**Structurally, from the RPC's own shape.** `barber_base` joins
`barbers b → organizations o → locations l`, so *every* barber row is by
construction a member of an organization at one of its locations — which is the
definition of staff. A barber row is a person who works somewhere, not a business
bookable independently of that somewhere.

The exclusion is safe rather than lossy, and this is the load-bearing part:
`barber_base` requires `o.marketplace_visible` and `l.is_active`, and `shop_base`
emits a row for every active location of every marketplace-visible organization.
**Every barber row therefore has a shop-shaped row for the very same location.**
Dropping barber rows cannot make a bookable place disappear — it can only stop
counting one place once per public team member.

Verified live: Home previously rendered two results for one bookable place
(`Side Agency` and its team member `Barber Test`). It now renders one.

Their profiles remain valid and discoverable through the shop's team, portfolio,
follows, social content, direct links and booking context. They are simply not
separate supply.

## 5. How multi-location organizations are presented

As ordinary barbershops, one listing per location, titled with the **location's**
own name whenever it differs from the organization's:

```
organization "Fade Factory Group"
  location "Fade Factory Créteil"   ->  listing titled "Fade Factory Créteil"
```

A single-site shop stores the same string twice (`Side Agency` / `Side Agency`)
and the customer sees it once. Nothing in the customer UI knows, or can say, that
an organization has more than one location — no group, no parent, no count. The
Organization → Location → Professional hierarchy is untouched and remains a Pro
concern.

## 6. Section label

One section, headed **"Near you"** (`v2.discovery.nearYou`), localized in all ten
locales. The `Barbers` / `Barbershops` group headings and their keys are gone.

## 7. The domain ambiguity — RESOLVED by the supply-contract lot

When this lot shipped, `organizations.business_type` was unreachable from any
customer-facing contract, so the classifier resolved to `null` and no listing
claimed a type. That gap is now closed by
`db/migrations/20260830090000_marketplace_supply_type.sql`, which appends
`business_type` to `search_public_professionals`. See
`docs/frontend/R5R1A_SUPPLY_CONTRACT.md`.

Home now renders `Barbershop · Antony (92)` from `marketplace_supply_type`,
derived authoritatively in the RPC. The frontend does not own the mapping and
must not recreate it — the raw `organizations.business_type` is deliberately
absent from the public contract, so `hair_salon`, `mixed_salon` and especially
`multi_location` never reach a customer client.

The null path remains and is still tested: a `business_type` added later arrives
unrecognised, renders no label, and fails `marketplace-supply.test.ts` so that a
product decision is made rather than inherited.

---

## 8. Files changed

```
apps/web/src/customer-v2/marketplace-supply.ts             new — the rule
apps/web/src/customer-v2/marketplace-supply.test.ts        new — 9 tests
apps/web/src/customer-v2/hooks/use-home-discovery.ts       two queries -> one; eligibility filter
apps/web/src/customer-v2/home/discovery-section.tsx        two group plates -> one "Near you" plate
apps/web/src/customer-v2/home/professional-result.tsx      place-only row; supply-type line; location-first title
apps/web/src/customer-v2/home/discovery-section.test.tsx   rewritten to the unified model
apps/web/src/customer-v2/home/professional-result.test.tsx rewritten; supply-type and multi-location cases
apps/web/src/customer-v2/README.md                         rule 2 rewritten
apps/web/src/locales/*/customer-app.json  (10)             +nearYou, +typeIndependent, +typeBarbershop;
                                                           -barbers, -shops, -fadeUpProfessional
docs/frontend/GREENFIELD_RULES.md                          + MARKETPLACE SUPPLY MODEL
docs/frontend/PRODUCT_UI_BLUEPRINT.md                      + MARKETPLACE SUPPLY MODEL, §5/§6 cross-referenced
docs/frontend/SCREEN_BLUEPRINTS.md                         + MARKETPLACE SUPPLY MODEL, C2/C3 cross-referenced
```

No migration, no RLS change, no pricing or entitlement change, no organization or
multi-location change, no Worker V2 change, no booking-rule change, no deploy.

## 9. Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 26 warnings — the pre-lot baseline, **none in `customer-v2`** |
| `npm test` | **841 passed / 841, 88 files** (was 830/87) |
| `npm run build` | exit 0 |

The seven required proofs, and where they live:

| Required | Test |
|---|---|
| 1 independent may appear | `marketplace-supply.test.ts` — "admits an independent professional…" |
| 2 barbershop may appear | `marketplace-supply.test.ts` — "admits a barbershop" |
| 3 multi-location location appears as Barbershop | `marketplace-supply.test.ts` — "presents a multi-location organization location…"; `professional-result.test.tsx` — "titles the listing with the LOCATION's name…" |
| 4 staff barber is not separate supply | `marketplace-supply.test.ts` — "never lets a barber who works at a shop…" and "excludes a barber row whatever the organization…" |
| 5 one unified discovery group | `discovery-section.test.tsx` — "heads the list 'Near you' and draws no entity-type sections" (asserts exactly one `h2`) |
| 6 type is Independent or Barbershop | `marketplace-supply.test.ts` — "is only ever Independent or Barbershop"; `professional-result.test.tsx` — label cases including the null path |
| 7 no Barbers / Barbershops grouping | `discovery-section.test.tsx` — same test asserts neither heading exists |

Plus a guard the brief did not ask for: "has an answer for every business type the
database can hold" fails the day an enum value is added without a decision.

## 10. Browser QA

Production build (`vite preview`), Home at **390 / 430 / 1440**:

```
h2 headings in main : ["Near you"]   (exactly one section at every width)
listings            : 1  — "Side Agency", "19 rue Danton · Antony (92)"
no "Barbers" section, no "Barbershops" section
horizontal overflow : 0     console errors : 0
failed requests     : 0     4xx/5xx        : 0
```

Before this lot the same query rendered **two** results for one bookable place;
the staff barber is now correctly absent.

Screenshots: `docs/frontend/artifacts/r5r1a-r2/home-390.png`, `home-430.png`,
`home-1440.png`.

---

**R5R.1B not started. R6 not started.**
