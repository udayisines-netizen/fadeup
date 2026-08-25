# R0 — Entitlements Draft

Status: **draft for R2**. R1 implements none of this.
Its only job is to ensure R1 does not make it impossible.

Pricing is frozen in `PRODUCT_CONSTITUTION.md` §6 and is not restated here as
anything other than a constraint on the model.

---

## 1. What exists today

**Nothing.** Verified:

* **Zero** occurrences of `stripe` in `apps/web/src` or `db/migrations` — the one
  match is a CSS stripe pattern in `calendar-entry.tsx:84`.
* No subscription table, no plan table, no entitlement table, no feature flag.
* `apps/web/src/lib/commerce/plans.ts` + `pricing.ts` are a **display and
  packaging matrix only**. The file's own header says: *"There is no subscription
  table in the database today."*
* `?plan=` is **discarded at registration** — `submit_professional_application`
  takes no plan argument.
* **No feature anywhere in the app is gated on a plan.**

Two things in `plans.ts` are worth keeping when R2 arrives: the
`status: 'live' | 'planned'` discipline and the per-capability `evidence`
strings. That discipline already caught Chair Mode being sold but not built.

**Immediate honesty issue, independent of R2:** `/pricing` and `/features` still
list Chair Mode as a plan highlight and a ✓ in the comparison table, while
`plans.ts:205-212` marks it `planned`. Either build it or stop selling it.

---

## 2. The two rules that constrain the schema

From Constitution §6:

1. **Shop pricing is per LOCATION, not per barber seat.** Adding a barber to a
   location must never change that location's price. **The billing unit is the
   location.**
2. **INDEPENDENT is capped at exactly one professional.** That cap must be
   expressible and enforceable, not merely displayed.

Everything below follows from those two sentences.

---

## 3. Shape of the eventual model

Sketch, not a specification. R2 decides.

```
subscription           the commercial agreement
  subject              organization  (shop plans)   OR   professional (INDEPENDENT)
  plan                 free | independent | essential | pro | scale
  status               trialing | active | past_due | canceled
  provider refs        opaque; no provider is chosen in R0

subscription_seat      one row per BILLED LOCATION  (shop plans only)
                       -> location_id
                       this is what makes "per location" real rather than
                       a number in a marketing table

capability             a named thing a plan may unlock
entitlement            (subscription, capability) -> enabled/limit
```

**Why a seat row per location rather than a count column:** a count drifts. A row
per billed location can be reconciled against `locations` and is what an invoice
line refers to. It also makes the INDEPENDENT cap a constraint — exactly one
professional — rather than a check someone remembers to write.

**Entitlement resolution must be server-side.** Following the established
convention: a `SECURITY DEFINER` helper in `private` (the sibling of
`is_org_member` / `has_org_role`) that answers "does this org have this
capability", consulted by RLS and RPCs. A client-side gate is presentation, not
enforcement.

---

## 4. What R1 must preserve for this to remain possible

| Requirement | How R1 satisfies it |
| --- | --- |
| Billing unit is the location | R1 changes nothing about `organizations`/`locations` and adds no per-seat concept. |
| INDEPENDENT cap is expressible | The professional identity is org-independent, so "how many professionals does this subscription cover" is a countable relationship rather than a property of the shop. |
| **Claim state ≠ subscription state** | R1 contains **no** plan, price, tier, subscription or entitlement column. `claim_state` answers *who controls this identity*, never *what they paid for*. A claimed profile is Free. **This is a design constraint enforced by review, not by tooling** — an earlier revision of this document claimed a MASTER generator refuses files containing `stripe`/`subscription`/`entitlement`. **No such control exists** (`grep` over `scripts/` returns nothing), and as described it would be a poor control anyway, since it would reject a migration whose *comment* says "no subscription state here". |
| An unclaimed profile implies no subscription | An external profile has no `barbers` row and no commercial state of any kind. Constitution §5.5. |
| Entitlements can gate social features later | Follow, relationship and showcase tables carry no plan coupling, so gating can be added at the RPC/RLS layer without schema change. |

---

## 5. Open questions for R2

* Which subject does INDEPENDENT bill — the professional identity or a
  one-person organization? R1 makes both representable; R2 must pick one.
* Does a Free professional appear in marketplace search, and at what rank? Today
  `marketplace_visible` is an org flag with no plan awareness.
* What happens to an unclaimed external profile that is never claimed — does it
  persist, expire, or require periodic re-verification against its source?
* Which capabilities are *limits* (counts) rather than *switches*? Limits need a
  numeric entitlement; switches do not.
* Downgrade semantics: what becomes of data created under a higher plan?
* Provider choice, and whether the provider is ever the source of truth for
  entitlement (recommendation: no — mirror it into the database and treat the
  local row as authoritative for access decisions).
