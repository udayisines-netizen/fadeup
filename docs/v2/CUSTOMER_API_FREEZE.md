# FadeUp Customer API Freeze — Mobile V1

**Status:** CLOSED  
**Date:** 2026-08-27

This document freezes the customer-facing backend contract used by the
FadeUp web customer experience and Customer Mobile V1.

It freezes API and identity semantics, not visual UI implementation.

---

## 1. Identity model

FadeUp intentionally separates three identities.

### organization_id

Durable commercial/barbershop entity identity.

Used for:

- public barbershop profile;
- organization Follow;
- shop Favorite;
- locations;
- team/roster ownership.

### professional_id

Durable human/professional social identity.

Used for:

- Follow of a barber/professional;
- professional social graph;
- durable identity when the person changes shop.

### barber_id

Operational placement identity.

Used for:

- booking;
- queue;
- Service Mode;
- roster placement;
- location-specific operation.

These identifiers MUST NOT be conflated.

`organization_id != professional_id != barber_id`

---

## 2. Marketplace

The Marketplace is a discovery/navigation surface.

It MUST NOT expose a barbershop Follow control on marketplace cards.

Following a barbershop occurs from its public profile.

The Marketplace may expose existing navigation and Favorite behavior without
changing the Follow contract.

Ordinary team-member barbers are not promoted into standalone marketplace
shop entities merely because they have a barber placement.

---

## 3. Public barbershop profile

A public barbershop has two independent customer relationships.

### Follow

Social relationship with the barbershop.

Canonical contracts:

- `list_my_followed_organizations()`
- `follow_organization(uuid)`
- `unfollow_organization(uuid)`

Identity:

- `organization_id`

### Favorite

Saved/bookmarked shop relationship.

Canonical contracts:

- `get_my_favorites()`
- `favorite_shop(uuid)`
- `remove_favorite(uuid)`

Identity:

- `organization_id`

Follow and Favorite represent different user intent.

A customer may:

- Follow only;
- Favorite only;
- both;
- neither.

Favorite MUST NOT be silently converted into Follow.

Follow MUST NOT reuse `customer_favorites`.

---

## 4. Public barber profile

The social identity of a barber is the durable Professional identity.

Canonical contracts:

- `list_my_followed_professionals()`
- `follow_professional(uuid)`
- `unfollow_professional(uuid)`

Identity:

- `professional_id`

The public barber placement may additionally expose:

- `barber_id`

for operational actions such as booking and queue.

A barber moving between shops keeps their durable `professional_id`.

---

## 5. Organization Follow graph

The organization Follow graph is stored separately from professional Follow
and shop Favorites.

Canonical relation:

- `organization_follows`

Rules:

- actor identity comes from `auth.uid()`;
- clients do not supply a customer user ID;
- anonymous users cannot mutate the graph;
- authenticated clients cannot directly INSERT/UPDATE/DELETE the backing table;
- writes occur through canonical RPCs;
- RLS is enabled and forced;
- SECURITY DEFINER functions pin `search_path`;
- explicit unfollow is retained as relationship state rather than silently
  losing user intent;
- explicit manual re-follow is allowed;
- no automatic organization Follow is installed in this freeze.

Automatic shop Follow after booking, queue, Passport or another interaction is
NOT part of this contract.

---

## 6. Professional Follow graph

R1B remains authoritative for Professional Follow.

Canonical relation:

- `professional_follows`

Canonical RPCs:

- `list_my_followed_professionals()`
- `follow_professional(uuid)`
- `unfollow_professional(uuid)`

Existing automatic Follow behavior remains unchanged.

A genuine qualifying interaction may auto-follow a Professional according to
the R1B contract.

An explicit professional unfollow remains stronger than a later automatic
follow attempt.

Organization Follow does not alter this behavior.

---

## 7. Marketplace / public professional identity

Customer-facing barber contracts may expose both:

- `barber_id`
- nullable `professional_id`

Semantics:

- `barber_id` = operational placement;
- `professional_id` = durable social identity.

Clients MUST use `professional_id` for Follow.

Clients MUST use `barber_id` for operational booking/queue behavior.

---

## 8. Shop Favorites

New Favorite writes are shop-only.

Legacy barber Favorite rows remain compatibility data only:

- they may remain readable where existing compatibility contracts require it;
- owners may remove them;
- they cannot be recreated as new barber Favorite relationships.

Barber social relationships use Professional Follow instead.

---

## 9. Service Mode

Canonical customer contract:

- `get_public_service_state(...)`

Modes:

- `hybrid`
- `reservation_only`
- `queue_only`
- `unavailable`

Precedence:

1. barber temporary override;
2. location temporary override;
3. barber persistent override;
4. location default.

Service Mode remains independent from:

- commercial entitlement;
- queue_open;
- slot availability;
- opening hours;
- active state.

The backend remains authoritative for final admission.

---

## 10. Booking

Canonical customer booking contracts include:

- `get_public_available_slots(...)`
- `book_public_appointment(...)`
- `reschedule_appointment(...)`
- `get_my_appointments()`
- `cancel_my_appointment(uuid)`

The server remains authoritative.

Customer clients MUST NOT expose raw PostgreSQL errors or internal constraint
details to end users.

---

## 11. Live Queue

Canonical customer queue contracts include:

- `get_public_queue_status(...)`
- `join_public_queue(...)`
- `get_my_queue_status()`

Final admission remains server-authoritative.

Client-side state must not bypass:

- entitlement;
- Service Mode;
- queue_open;
- runtime queue constraints.

---

## 12. Fade Passport

Fade Passport remains customer-owned and portable.

It is not owned by a shop and is not paywalled by a professional plan.

Existing Passport read/share/revoke contracts remain authoritative.

---

## 13. Customer profile

Customer profile data remains protected by the existing RLS-backed customer
profile contract.

Clients MUST NOT rely on private/internal columns.

---

## 14. Authentication

Customer authentication remains based on Supabase Auth.

The customer applications may use Supabase Auth for:

- session restoration;
- registration;
- sign-in;
- OAuth;
- callback/deep-link handling;
- sign-out.

Authorization decisions remain server-side.

---

## 15. Realtime

Realtime is an update mechanism, not an authorization mechanism.

Customer applications may use Realtime to refresh relevant:

- appointment state;
- queue state;
- Service Mode state;
- customer-facing operational state.

After reconnect or uncertain delivery, clients should refetch from the
authoritative API contract.

---

## 16. Error contract

Customer-facing interfaces MUST NOT expose:

- raw PostgreSQL errors;
- SQLSTATE implementation details;
- constraint names;
- stack traces;
- internal authorization implementation details.

Backend errors must be mapped to stable customer-facing product states.

---

## 17. Frozen UX semantics

| Surface | Relationship |
|---|---|
| Marketplace shop card | No organization Follow control |
| Public barbershop profile | Follow organization + Favorite shop |
| Public barber profile | Follow professional |
| Booking / queue | Operational barber identity |

Canonical mapping:

| Action | Identity | Backend |
|---|---|---|
| Follow barbershop | `organization_id` | `follow_organization()` |
| Unfollow barbershop | `organization_id` | `unfollow_organization()` |
| Read followed barbershops | customer session | `list_my_followed_organizations()` |
| Favorite shop | `organization_id` | `favorite_shop()` |
| Remove Favorite | favorite relation | `remove_favorite()` |
| Follow barber | `professional_id` | `follow_professional()` |
| Unfollow barber | `professional_id` | `unfollow_professional()` |
| Book/queue with barber | `barber_id` | operational contracts |

---

## 18. Compatibility rules

Allowed:

- additive nullable response fields;
- additive RPCs;
- additive metadata;
- performance improvements;
- internal refactors preserving frozen semantics.

Breaking changes require an explicit migration/version decision.

Do NOT silently:

- remove required fields;
- rename frozen fields;
- rename enum values;
- change identifier semantics;
- conflate `organization_id`, `professional_id` or `barber_id`;
- convert Favorite into Follow;
- convert Follow into Favorite;
- move authorization decisions client-side;
- expose private data through public contracts.

---

## 19. Validation baseline

At freeze closure:

- Organization Follow VERIFY: PASS;
- Customer API contract VERIFY: PASS;
- R1B regression: PASS;
- R2 pricing/entitlements regression: PASS;
- Service Mode regression: PASS;
- web TypeScript typecheck: PASS;
- targeted customer UI tests: PASS;
- complete web test suite: PASS;
- production web build: PASS.

Customer API Freeze is therefore considered stable enough to begin
Customer Mobile V1 against this boundary.

---

**Customer API Freeze: CLOSED — 2026-08-27**

---

## 20. Amendment — R5, 2026-08-28

The freeze remains CLOSED. One amendment, recorded here because a closed-lot
artifact must never change silently.

### What changed

`search_public_professionals` was rewritten by
`db/migrations/20260828120000_marketplace_map_and_sort.sql`:

* **Three columns added to the projection** — `latitude`, `longitude`,
  `timezone`. The function already accepted a latitude and longitude and
  computed `distance_km` from them; it returned neither, so a map had nothing
  to plot. `timezone` was already carried internally by the open-now and
  queue-window subqueries and dropped at the final SELECT.
* **One trailing parameter added** — `p_sort text default 'recommended'`.
  `recommended` is the pre-R5 ordering, byte for byte, and is also the fallback
  for any unrecognised value.

### Why this does not break the freeze

§1 of this document freezes "API and identity semantics, not visual UI
implementation".

* No identity semantic moved. `professional_id` is still exposed, still NULL
  for a shop and for a barber with no currently claimed identity, and still
  distinct from `barber_id` and `organization_id`.
* No row became visible that was not visible before. Every WHERE clause is
  unchanged, and `VERIFY_R5 §R5.9` proves it by flipping `marketplace_visible`
  off and asserting the shop disappears from the results.
* Nothing was removed. The frozen columns are now asserted individually by
  §19's VERIFY rather than implied.
* Coordinates disclose nothing new: these are active locations of
  `marketplace_visible` organizations whose street address, city and postcode
  the same rows already returned.
* Every parameter is trailing and defaulted, so an existing 13-argument call
  keeps working and keeps its ordering.

### What this amendment corrected in the VERIFY itself

`VERIFY_CUSTOMER_API_FREEZE` addressed the function by a pinned 13-argument
signature and therefore failed with **"function does not exist"** — reporting a
purely additive change as a broken contract. That framing is worse than
useless: it trains whoever hits it to edit the VERIFY rather than to think
about the contract.

The block now resolves the function by name, asserts there is **exactly one
overload** (two would make every existing 13-argument call ambiguous at
runtime — which is what the arity pin was really buying), and asserts each
frozen column individually.

### Not amended

Nothing else. In particular §2's marketplace rules stand and R5 honours them:
no barbershop Follow control appears on a marketplace card, and ordinary team
members are not promoted into standalone marketplace entities.
