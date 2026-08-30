# R5R.1A — the marketplace supply contract

**Status:** implemented and verified locally. **Not deployed, not pushed.**
**Migration:** `db/migrations/20260830090000_marketplace_supply_type.sql`
**Verification:** `db/tests/verify_marketplace_supply_type.sql`
**Artefacts:** `docs/frontend/artifacts/r5r1a-supply/`

A small, additive backend contract fix. It closes the one domain ambiguity left
open by R5R.1A-R2: `organizations.business_type` was authoritative and correct,
and was the one thing the public read contract did not return, so the customer
frontend could not truthfully tell Independent from Barbershop.

---

## 1. The RPC as it was found

`public.search_public_professionals`, last defined by
`db/migrations/20260828120000_marketplace_map_and_sort.sql`. Before writing
anything, the checked-in SQL was compared against the live function with
comments and whitespace normalised: **identical**. The migration below was then
generated *from that file* rather than retyped, so the body could not drift.

- 14 arguments: `p_country, p_city, p_query, p_service_query, p_latitude,
  p_longitude, p_radius_km, p_min_price_cents, p_max_price_cents,
  p_open_now_only, p_entity_type, p_limit, p_offset, p_sort`
- 24 result columns, `entity_type` … `total_count`
- `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`
- ACL `{postgres=X, anon=X, authenticated=X, service_role=X}`
- **No dependent views, rules or constraints** (checked via `pg_depend`)
- One real frontend caller: `apps/web/src/lib/queries/marketplace.ts`

## 2. CREATE OR REPLACE was not possible

PostgreSQL refuses to change a function's return type with `CREATE OR REPLACE`,
and appending a column to a `RETURNS TABLE` *is* a return-type change. So
**DROP + CREATE was required**, and it was done:

- inside one transaction, with `set lock_timeout = '5s'`;
- against the **exact** 14-argument signature;
- **without `CASCADE`** — nothing depends on the function, and if something ever
  did, this migration should fail loudly rather than silently drop it;
- with grants restored explicitly afterwards.

## 3. The field added

One appended column: **`marketplace_supply_type text`**, placed **last** so every
pre-existing column keeps its position and type. It carries only `independent`,
`barbershop` or `NULL`.

A first draft of this migration returned the raw `organizations.business_type`
and left the mapping to the frontend, arguing that one product rule belongs in
one place. **That was the wrong trade for a public contract, and it was
corrected before this migration was ever committed.**

Returning the raw enum publishes FadeUp's internal organization modelling to
every anonymous client. `hair_salon` and `mixed_salon` are distinctions the
customer marketplace does not make; `multi_location` describes an organization's
topology rather than anything a customer books. Once a public contract leaks
those, clients couple to them and the enum can never change.

So the contract exposes only what the customer product actually means, and the
internal enum stays internal — free to gain values without touching a single
consumer.

The mapping is enumerated value by value rather than with a catch-all `else
'barbershop'`, so an unhandled business type resolves to `NULL` and renders no
label. Guessing would be worse than silence.

## 4. Security, verified rather than assumed

| Property | Before | After |
|---|---|---|
| signature | 14 args | **identical** |
| `prosecdef` (SECURITY DEFINER) | `t` | `t` |
| `provolatile` | `s` (STABLE) | `s` |
| `proconfig` | `search_path=""` | `search_path=""` |
| ACL | `postgres=X, anon=X, authenticated=X, service_role=X` | **identical** |

`organizations` RLS is **unchanged** — still `is_org_member() OR
is_platform_admin()` — and the verification proves `anon` still reads **0 rows**
from the table directly. No `WHERE` clause in the function changed, so **no row
became visible that was not visible before**: a hidden organization
(`marketplace_visible = false`) and an inactive location both still return zero.

The disclosure is smaller than what the same row already prints. Every row is
already an active location of a `marketplace_visible` organization carrying that
organization's name, slug, street address, city, postal code, country and
coordinates.

And what is exposed is **less than the column behind it**: five internal values
collapse to two, so a caller cannot tell a `hair_salon` from a `mixed_salon`, or
a branch of a chain from a standalone shop.

## 5. The mapping, performed in SQL

```sql
case o.business_type
  when 'solo_professional' then 'independent'
  when 'barbershop'        then 'barbershop'
  when 'hair_salon'        then 'barbershop'
  when 'mixed_salon'       then 'barbershop'
  when 'multi_location'    then 'barbershop'
  else null
end::text as marketplace_supply_type
```

In both union branches, at the same position, since `union all` is positional.

`multi_location` **stays `multi_location` in the database**. It is a real
organization type and is not renamed, flattened or merged. Only the customer
presentation flattens: each eligible location of such an organization is already
returned as its own row, and each renders as an ordinary Barbershop.

## 6. Real RPC output, before and after

```
BEFORE
 entity_type | organization_name | location_name |  (no classification at all)
 shop        | Side Agency       | Side Agency   |
 barber      | Side Agency       | Side Agency   |

AFTER
 entity_type | organization_name | marketplace_supply_type | total_count
 shop        | Side Agency       | barbershop              | 2
 barber      | Side Agency       | barbershop              | 2
```

The internal value behind that row is `business_type = 'barbershop'`, but a
`hair_salon` or a branch of a `multi_location` group would be indistinguishable
here — which is the point.

And on Home, at 390 / 430 / 1440 against the production build:

```
before   Side Agency
         19 rue Danton · Antony (92)      <- no type; it could not be known

after    Side Agency
         Barbershop · Antony (92)          <- from marketplace_supply_type
```

## 7. Tests

**Database** — `db/tests/verify_marketplace_supply_type.sql`, all **eleven**
sections passing. It seeds one organization per enum value plus a hidden one and one with
an inactive location, gives the multi-location organization three locations, and
attaches one public bookable staff barber.

| # | Proof | Result |
|---|---|---|
| 1–4 | every business type maps correctly | `solo_professional` → `independent`; `barbershop`, `hair_salon`, `mixed_salon` → `barbershop` |
| 5 | multi-location returns one ordinary row **per location** | 3 rows, each `barbershop`, no aggregate row, the word `multi_location` nowhere in the output |
| 6 | staff barber unchanged | still returned for `p_entity_type='barber'`; **0** rows under `'shop'` |
| 7 | hidden org and inactive location stay hidden | 0 and 0 |
| 8 | anon cannot read `organizations` | **0 rows** |
| 9 | input contract compatible | positional-14, positional-13 and named forms all return 7 |
| 10 | result semantics unchanged | `total_count` = 7 and constant; distance/open-now/price still null rather than invented; column order historical with `marketplace_supply_type` last and **no** `business_type` |
| 11 | the public vocabulary is closed | only `barbershop` and `independent` are ever returned; all five enum labels proven to be explicitly classified, so a new one fails here |

**It never commits.** The whole script is one transaction ending in `ROLLBACK`,
and that is not tidiness — `organizations` gets an append-only
`commercial_plan_changes` row on insert whose guard states it has *"no role
exemption, on purpose"*. A committed fixture organization therefore cannot be
deleted by anyone, so seeding one would leave permanent residue. This was
learned the hard way; see §10.

The multi-location fixture is put on a `multi_pro` plan rather than the free
one, because `enforce_establishment_capacity` correctly refuses a second active
location on the free plan. That guard was **not** worked around — the fixture is
simply modelled the way a real multi-location organization is.

**Frontend** — `marketplace-supply.test.ts` no longer tests a mapping, because
the frontend no longer has one; the enum cases moved to the database
verification where the mapping now lives. It covers eligibility, the closed
two-value vocabulary, the null path, and one architectural guard: **it scans
every file under `customer-v2/` and fails if any of them names `business_type`,
`BusinessType`, `solo_professional`, `hair_salon`, `mixed_salon` or
`multi_location` in code.** Comments are exempt on purpose — coupling is
something code does, and the prose explaining why the enum is absent is what
stops someone reintroducing it.

35 tests in `customer-v2`, **841 in the suite**. The count fell from 848 because
seven frontend mapping tests were replaced by the database's, not because
anything was weakened: the behaviour they covered is no longer the frontend's.

## 8. Gates

| Gate | Result |
|---|---|
| database verification | 10/10 sections pass; rollback total, `fixtures_remaining = 0` |
| `npm test` | **841 passed / 841** — see §7 on why this is lower than the raw-enum draft |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 26 warnings — the baseline, none in `customer-v2` |
| `npm run build` | exit 0 |
| browser QA 390/430/1440 | one "Near you" section; `Barbershop · Antony (92)`; 0 clipped, 0 overflow, 0 console errors, 0 failed requests, 0 4xx; none of Multi-location / multi_location / Organization / Group / hair_salon / mixed_salon / solo_professional present |

## 9. A related frontend change this forced

The type label sits at the head of the second line, and adding it pushed the
city off the end at 390px — `Barbershop · 19 rue Danton · Antony (92)` truncated
and the ellipsis ate the locality, which is the part a customer scanning a
country-wide list needs. The street now appears only when there is no city. The
full address belongs one tap deeper, on the profile, where it has room. Covered
by three new tests.

## 10. Recorded honestly: residue in the local database

The first run of the verification committed its fixtures before the rollback
design was adopted. Seven organizations could then not be deleted — the
append-only commercial audit trail blocks the cascade, deliberately and with no
role exemption. Disabling that trigger to tidy up would have defeated a guard
whose own comment anticipates exactly that, so it was not done.

Those seven rows were instead renamed to `zz-dead-r5r1a-fixture-*` and pinned
`marketplace_visible = false`; their locations were already gone, so they return
zero marketplace rows and are invisible to customers. They remain in the local
development database and cannot be removed.

**This affects more than this lot.** Any `db/tests/verify_*.sql` that inserts an
organization and commits leaves permanent residue, and several existing scripts
claim to "clean up their own fixtures" while creating organizations. Recorded as
D-7 in `R5R_DEFECTS_FOUND.md`.

---

## 11. Confirmations

- The raw `business_type` is **not** required by, or reachable from,
  `customer-v2` — enforced by a test that scans the directory.
- `organizations` RLS was **not** weakened — policy unchanged, `anon` reads 0 rows.
- `multi_location` is **unchanged internally** — still a real `business_type`
  value, still a real organization type, not renamed or flattened; only the
  customer presentation flattens its locations into ordinary Barbershops.
- Staff barbers **remain excluded** from marketplace supply — Home still requests
  `p_entity_type = 'shop'`, barber row behaviour is unchanged, and the DB
  verification proves 0 staff rows in supply.
- **Not deployed. Not pushed.** The migration was applied to the local
  production-aligned stack only.

**R5R.1B not started. R6 not started.**
