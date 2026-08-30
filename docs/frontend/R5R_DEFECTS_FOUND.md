# Defects found during R5R lots, outside the lot's own scope

`CLAUDE.md`'s scope discipline says to record unrelated defects separately
rather than fixing them inside a lot. This file is that record.

---

## D-1 — Every `_one`/`_other` plural in the product renders a raw key in Arabic, and several in Russian

**Found during:** R5R.1A browser QA, at 390px in `ar`.
**Severity:** HIGH for Arabic and Russian readers. Cosmetically catastrophic —
the literal string `v2.discovery.count` was rendered on screen.
**Status:** fixed for the two keys R5R.1A introduced. **Not fixed anywhere else.**

### What happens

i18next resolves `key_<CLDR category>` and, when that key is missing, falls back
to the **unsuffixed base key** — never to `_other`. Verified directly against
i18next 26:

| locale | n | category | `_one`+`_other` only | base+`_one`+`_other` | all categories |
|---|---|---|---|---|---|
| ar | 0 | zero | **`count`** (raw key) | `base:0` | `zero` |
| ar | 2 | two | **`count`** (raw key) | `base:2` | `two` |
| ar | 3 | few | **`count`** (raw key) | `base:3` | `few:3` |
| ar | 11 | many | **`count`** (raw key) | `base:11` | `many:11` |
| ar | 1 | one | `one:1` | `one:1` | `one` |
| ar | 100 | other | `other:100` | `other:100` | `other:100` |

Arabic selects `zero`, `two`, `few` and `many` for counts 0, 2, 3–10 and 11–99.
Russian selects `few` for 2–4 and `many` for 0 and 5–20. A key that ships only
`_one` and `_other` is therefore broken for **most counts a customer will
actually see** in those two languages.

### Why no guard caught it

`locale-completeness.test.ts` compares key *sets* across locales and passes
happily when all ten agree on `_one`/`_other`. Agreeing on an incomplete set is
exactly the failure mode. The test is not wrong; it answers a different
question.

### Known affected keys (not exhaustive)

Found by grep, all present in `ar` and `ru` with only `_one`/`_other`:

- `customer-app.json` → `home.queuePosition`, `home.lastCutDays`
- `app.json` → `waitedMinutes`, `doneToday`, `appointmentCount`
- `booking.json` → `followers`, `locationCount`

### Fix

Ship every CLDR category a supported locale can select — `_zero`, `_one`,
`_two`, `_few`, `_many`, `_other` — with the ones a given language does not
distinguish reusing the `_other` wording. R5R.1A did this for
`v2.discovery.count` and `v2.result.waiting`; see those entries for the shape.

Worth adding alongside the fix: extend `locale-completeness.test.ts` to assert
that any key ending in a plural suffix carries the **full** category set, so the
guard starts answering the question it appears to answer.

### Suggested owner

A localization lot, or the first lot that touches a counted string in `ar`/`ru`.
Not R5R.1B — that lot is discovery UX and this would enlarge it.

---

## D-2 — Discovery has no image column for a SHOP, so a shop result can never show a photograph

**Found during:** R5R.1A independent review.
**Severity:** MEDIUM. It caps the ceiling of a social-first marketplace.
**Status:** not fixed — this is a backend gap, not a frontend one.

`search_public_professionals` sets `barber_avatar_url` to `null::text` on every
`shop` row by construction, and `organizations` carries no logo, cover or photo
column at all (`grep -rl "logo_url\|cover_url\|banner_url" db/migrations` returns
nothing). So the R5R.1A result is built around a media well that a barber row
can eventually fill from `staff_profiles.avatar_url` and a shop row structurally
cannot, whatever the owner uploads.

Nothing in the frontend can close this. Discovery needs either an organization
image column exposed on the RPC's projection, or a portfolio/work-media table
that both entity types can draw from — the latter is what
`PRODUCT_UI_BLUEPRINT.md` §13 assumes when it describes portfolio grids.

**Suggested owner:** the lot that builds the shop profile (R5R.1D) or a
dedicated media lot; R5R.1B will feel it first, because the marketplace list is
the same grammar at greater volume.

---

## D-3 — The Vite dev server intermittently serves a blank page; the production build does not

**Found during:** R5R.1A browser QA, where a route occasionally captured with an
empty `#root`.
**Severity:** LOW — developer experience and QA reliability only.
**Status:** not fixed; characterised so it is not mistaken for a product defect.

Measured 8 rounds per route, 390px, on a quiet host:

| Route | dev server (`vite`) | production build (`vite preview`) |
|---|---|---|
| `/_preview/r5r/appointments` | 3 ok / **5 blank** | **8 ok / 0 blank** |
| `/_preview/r5r` | 5 ok / **3 blank** | **8 ok / 0 blank** |
| `/pricing` (pre-R5) | 2 ok / **6 blank** | **8 ok / 0 blank** |
| `/` (pre-R5) | 6 ok / **2 blank** | **8 ok / 0 blank** |

Two things follow. It is **not introduced by R5R.1A** — the two worst-affected
routes in the sample are pre-R5 marketing pages. And it **does not survive a
production build**, where 32/32 mounts succeeded. The `HydrateFallback` warning
the R5R.0 audit recorded disappears in the built bundle for the same reason.

The practical consequence is for whoever runs browser QA next: capture artefacts
from `vite preview` against a build, not from the dev server, or a blank
screenshot will eventually be filed as a rendering bug. `e2e/r5r1a/*.mjs` both
honour `QA_BASE` for exactly this.

---

## D-4 — `apps/web/.env.local` was stale against the running Supabase stack

**Found during:** R5R.1A browser QA — every `search_public_professionals` call
returned **401 Unauthorized** in the dev server while the same RPC returned 200
for the key in `infra/web/.env`.
**Severity:** LOW, developer-experience only. Both files are untracked and no
shipped artefact is affected.
**Status:** the local file was repointed at `http://127.0.0.1:18100` with the
working key so browser QA could run. Nothing was committed.

The trap is that a stale anon key fails as a *401 on every query*, which looks
exactly like a broken RLS grant or a broken component. Anyone debugging an empty
FadeUp locally should check this first. `apps/web/.env.example` could usefully
say where the working values live.

---

## D-5 — `postal_code` on the live location holds a locality string, not a postal code

**Found during:** R5R.1A-R1, while choosing which address fields a shop result
should print.
**Severity:** LOW today, MEDIUM when addresses matter. Nothing currently renders
`postal_code`, so no customer sees it — but the column is wrong, and the next
surface that formats a full address (shop profile, booking confirmation, the
calendar event R5R.1E has to build) will print it.

`search_public_professionals` returns, for the one live location:

```
address_line1  '19 rue Danton'
postal_code    'LE KREMLIN'      <- a place name in a postal-code column
city           'Antony (92)'     <- a city with a département suffix
region         NULL
```

`'LE KREMLIN'` is presumably Le Kremlin-Bicêtre, which is a commune, not a
postal code — and it is not the same commune as Antony. So the row cannot be
formatted into a correct postal address by any code, however careful.

**What R5R.1A-R1 did about it:** avoided it. The shop result prints
`address_line1 · city` and never touches `postal_code`, which is why the defect
is invisible in the current screenshots rather than fixed.

**Suggested owner:** whoever owns location data entry. Two things worth
separating: whether the *validation* on the location form permits a non-postal
value in that column, and whether this particular row should be corrected. A
frontend lot should not silently repair operator data.

**Do not** work around this by hiding or reformatting the field in the UI —
CLAUDE.md's rule is that frontend hiding is not a fix, and a wrong address on a
booking confirmation is a customer who cannot find the shop.

---

## D-6 — The legacy barber profile emits two 405s on `rpc/get_public_service_state`

**Found during:** R5R.1A-R1 independent review, following this lot's own result
link out of Home.
**Severity:** LOW–MEDIUM. The page renders correctly (`h1: "Barber Test"`) and
nothing visibly fails, but two requests return **405 Method Not Allowed** on
every visit to `/s/:slug/barbers/:id`.

A 405 rather than a 404 or a 403 usually means the RPC is being called with the
wrong HTTP verb for how it is declared — a `GET` against a `VOLATILE` function,
or a function whose signature changed without the caller following. Worth one
look before R5R.1D rebuilds this surface, because the greenfield barber profile
will need whatever `get_public_service_state` was meant to return.

**Not caused by this lot.** Home itself makes zero failed requests at every
width and locale tested. This only appears after navigating out of the preview
into the R5 visual language, which is expected until R5R.1D replaces it — and is
itself worth knowing: **the first tap out of the greenfield Home currently lands
on a rejected R5 screen.** That is a sequencing consequence of shipping Home
first, not a defect, but the product owner should not be surprised by it when
clicking through the preview.

---

## D-7 — A committed test fixture organization can never be removed

**Found during:** R5R.1A supply-contract lot, writing
`db/tests/verify_marketplace_supply_type.sql`.
**Severity:** LOW in production (the behaviour there is correct and desirable),
MEDIUM for test hygiene.

`organizations` receives a `commercial_plan_changes` row on insert, and that
table is append-only. Its guard says why, in its own words:

```
-- No role exemption, on purpose. An audit trail that the most powerful role
-- can rewrite is a log, not an audit trail.
```

The foreign key from `commercial_plan_changes` to `organizations` cascades, so
removing an organization fires that trigger and fails. **Every organization ever
committed to a database is therefore permanent**, test fixtures included.

That is right for production and awkward for `db/tests/`. Several existing
`verify_*.sql` scripts create organizations, commit them, and end by trying to
remove them under a header claiming they "clean up their own fixtures" — the
statement cannot succeed, so each run leaves permanent residue in whatever
database it is pointed at.

**The pattern that works**, used here: run the whole verification as ONE
transaction ending in `rollback`. Nothing commits, no audit row is written, and
there is nothing to clean up. The script still proves everything, because
`set role anon` and the RPC calls all work inside an uncommitted transaction.

**Do not** fix this by disabling the trigger around a cleanup. That defeats a
guard whose own comment anticipates precisely that move.

**Existing residue:** this lot's own first run left seven organizations behind
before the rollback design was adopted. They were renamed to
`zz-dead-r5r1a-fixture-*` and pinned `marketplace_visible = false`, and their
locations are gone, so they return zero marketplace rows. They cannot be
removed.

**Suggested owner:** whoever next touches `db/tests/`. Auditing the other verify
scripts for the same false cleanup claim is a small, contained job.
