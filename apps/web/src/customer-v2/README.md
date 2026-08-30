# `customer-v2` — the R5R greenfield customer frontend

This directory is the FadeUp customer experience rebuilt from a blank visual
starting point, per `docs/frontend/GREENFIELD_RULES.md`. It is **not** a
refactor of the R5 customer product in `src/pages/customer/` and
`src/routes/customer-shell.tsx`, which remain untouched and canonical until a
product owner approves this direction.

Lots delivered here: **R5R.1A — Customer Shell + Home**, then **R5R.1A-R1**, the
visual revision of Home after the first pass was technically accepted and
visually rejected. See `docs/frontend/R5R1A_R1_HOME_REVISION.md`; the
architecture below is unchanged by that revision.

## Where it lives

Mounted at `/_preview/r5r` (see `routes.ts` for why a preview prefix, and why it
is deliberately not behind `RequireAuth`). Four of the five destinations are
honest placeholders naming the lot that will build them; Home is functional.

```
customer-v2/
  customer-v2.css   tokens + the few primitives that need real CSS
  routes.ts         every preview path, declared once
  shell/            header, five-destination navigation, notification entry
  home/             the Home surface and the marketplace result grammar
  hooks/            location, discovery, timing
  pages/            the placeholder for the four unbuilt destinations
```

## What is new and what is reused

**New — every visible decision.** Tokens, type scale, radius scale, spacing,
the result composition, the navigation, the empty/error/loading states, the
motion. No R5 component is imported for its appearance and no R5 Tailwind
composition is copied. The only shared visual asset is `FadeUpMark`, which is
the brand charter rather than an R5 design decision.

**Reused — everything invisible.** `search_public_professionals` and
`get_public_currencies` through `lib/queries/marketplace`; `useNotifications`;
`usePendingClaimRedemption` for anonymous-booking claim tokens;
`useGeoSuggestion` / `effectiveCountry` / `countryName` for location;
`useMoney` for currency; `useDocumentMeta`; the router, the single Supabase
client, i18next and its ten locales. Nothing here creates a parallel auth,
query, realtime or localization system.

## The three rules this code is built on

**1. A null renders nothing.** `is_open_now`, `distance_km`,
`starting_price_cents` and the resolved currency are each independently
nullable, and each null means something specific. None of them ever falls back
to a default — see `professional-result.test.tsx`, which locks that down,
because `{open ? 'Open' : 'Closed'}` looks correct in review while telling a
customer a shop is shut when FadeUp has no idea.

**2. A heading is a claim, and entity type is not a customer concept.** Home has
ONE discovery section, headed "Near you". An earlier revision split it into
"Barbers" and "Barbershops" from the RPC's `p_entity_type`; that published a
backend row shape as a customer taxonomy and made a shop's own team members look
like businesses bookable independently of the shop.

What a customer sees is independently bookable supply, of which there are exactly
two kinds — **Independent** and **Barbershop** — and a location of a
multi-location organization is an ordinary Barbershop that never names its group.
`marketplace-supply.ts` holds the ELIGIBILITY rule — which rows are supply at
all — and `marketplace-supply.test.ts` enforces it. The LABEL is not decided
here: the RPC derives `marketplace_supply_type` and this product consumes it, so
the internal `organizations.business_type` never reaches a customer client. A
test scans this whole directory and fails if any file names an internal enum
value in code. There is no "Popular" grouping because nothing in this backend ranks anyone,
no "Fresh work" because the schema has no portfolio table, and no "Open now"
*section* because a client-side slice of one page would promise a completeness it
does not have — Open now is a facet that re-queries the server through
`p_open_now_only`.

**3. Filled green means booking.** One colour, one meaning. The Book control on a
result is the only filled green in the product; the Book *tab* is styled like
every other destination, in both the mobile bar and the desktop header, and the
location control is ink rather than green.

R5R.1A-R1 widened this by exactly one case: a barber's establishment name is
green TEXT, which is how a person reads as working somewhere rather than being
somewhere. It is not a control and carries no fill, so nothing competes with
Book. The one other hue in the system, `--color-v2-alert`, exists solely so a
failed load cannot be mistaken for an empty one.

## One grammar at every width

A result is a row — identity tile, name, relationship, operational line, Book —
on a phone and on a laptop. Desktop grows the tile and the padding; it does not
re-house the row in a card. An early pass did exactly that and it was wrong
twice over: it reintroduced the card idiom the R5 rejection was largely about,
at a breakpoint, and it meant the product was a list on a phone and a card wall
on a laptop, which is two design systems.

What desktop changes is the PAGE, not the row: the header becomes a band with
the search beside the title rather than under it, and the listing plate widens
into it. R5R.1A-R2 collapsed the two entity-type groups into one, so what desktop
composes is a single "Near you" list rather than a pair of columns.

## Imagery

The database exposes exactly one image column to discovery
(`staff_profiles.avatar_url`) and it is null for every current row; the RPC nulls
it outright for every shop. `IdentityTile` therefore reserves the frame at a
fixed size and, with no photograph, draws a still two-stop fade behind an outline
glyph — a person for a barber, a storefront for a shop. That is a designed
absence, not a placeholder photo and not a monogram, and it is visually distinct
from the skeleton, which sweeps.

R5R.1A-R1 shrank that frame from a 92px 4:5 well to a 56/72px tile. The first
pass's reasoning — reserve the frame before the photographs exist, so nothing
reflows when media arrives — still holds and is why the tile is fixed-size. What
was wrong was the scale: with zero photographs in the product, a 92×115 block of
grey texture was the loudest element on every row, and the human review read it
as an unfinished skeleton.

## Verification

`professional-result.test.tsx`, `discovery-section.test.tsx` and
`customer-v2-shell.test.tsx` cover the data, grouping and navigation contracts.
Browser QA artefacts — 390 / 430 / 1440, plus loading, empty, error, search,
focused search, no-match, French, Arabic RTL and reduced-motion — are in
`docs/frontend/artifacts/r5r1a-r1/`; the rejected first pass is preserved in
`docs/frontend/artifacts/r5r1a/` for comparison.

**This direction is not approved.** Technical verification passing does not
make it the visual source of truth; `GREENFIELD_RULES.md` §14 requires an
explicit product-owner decision on the rendered screenshots first. Do not
propagate these choices into another surface before that happens.
