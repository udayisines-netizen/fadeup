# FadeUp — Product Constitution

Status: **frozen**. Version 1.0 (R0).

This document is product law, not architecture. Architecture serves it. Where
an implementation and this document disagree, the implementation is wrong.

Every rule below is binding on R1 and on every later lot. A lot may not weaken
a rule here because it is inconvenient; it may only propose an amendment
explicitly, in writing, and have it approved before implementation.

---

## 1. Identity of the product

> **FadeUp is the social network, marketplace and operating system for barber
> culture.**

Three things at once, and the order matters:

* a **social network** — durable public identities, a real follow graph, and
  social proof that people actually care about;
* a **marketplace** — customers discover and book professionals, not only
  shops;
* a **professional operating system** — the shop's real daily software:
  calendar, queue, clients, staff, services.

This has a direct architectural consequence, and it is the single most
important sentence in this document:

> **A barber is not "a staff row attached to a schedule".**

A professional has a durable public identity that exists independently of any
particular shift, shop, membership or employment arrangement. Employment is a
relationship a professional *has*; it is not what a professional *is*.

### 1.1 Terminology

The product is **FadeUp**. It is never called "Barber OS".

Domain vocabulary is English and consistent: **barber**, **professional**,
**barbershop**, **shop**, **location**, **customer**. The French *barbier* is
not FadeUp terminology. "Barber" and "barbershop" describe the industry, the
users and the domain — never the product itself.

---

## 2. The customer

### 2.1 Customers are private by default

A normal customer account is private. Email, phone, booking history, visit
history, payment data, preferences and internal operational metadata are
**never** public.

A customer may *opt in* to a public presence. Opting in must be a deliberate
act, and it must expose only what the customer chose to expose. The existence
of a public projection must never make a private field reachable.

### 2.2 Every customer has a Fade Passport

> **Every registered customer owns exactly one Fade Passport, and it exists
> automatically.**

It is not something a customer creates, opts into, or can be missing. Creation
must be automatic, unique and idempotent. Existing customers must be
backfilled.

The Passport is **customer-owned and portable**. A shop gains no ownership of
it because the customer once visited. It must never contain shop-internal or
staff-internal notes — not filtered out, but never modelled there in the first
place.

### 2.3 Passport identity is not a device wallet

A Fade Passport existing in FadeUp and a Passport installed into Apple Wallet
or Google Wallet are **two different things**. A customer may have a Passport
without ever installing it on a device. These must never be conflated.

---

## 3. The social layer

### 3.1 Book is the dominant call to action

> **Book is the primary CTA everywhere. Follow is secondary.**

FadeUp is a marketplace with a social layer, not a social network that happens
to take bookings. No screen may present Follow with equal or greater prominence
than Book. Social features exist to drive genuine bookings and to make real
professional reputation visible — not to maximise engagement.

### 3.2 Follower ≠ Verified Client

> **This is a hard invariant. It is never relaxed.**

* `verified_client` must **never** be derived from `follower`.
* `follower` must **never** be derived from `verified_client`.

They are different relationships with different meanings and **different
sources of truth**. A follow is an expression of *intent*. A verified client is
a statement of *fact* about a service that actually happened. Public counters
for the two must be computed from different data.

### 3.3 A confirmed booking is not a haircut

A confirmed booking may be sufficient to establish an automatic follow, if that
matches the product lifecycle.

A confirmed booking is **never** evidence that a service was delivered.
Verified-client status requires stronger evidence — a completed appointment, a
served queue visit, or another trusted completed-service state.

> If the platform cannot reliably establish that a service was completed, it
> must **not pretend that it can**. The limitation is documented, not papered
> over.

### 3.4 Explicit unfollow is permanent

The system must distinguish four states, not two:

| State | Meaning |
| --- | --- |
| never followed | no action has ever been taken |
| manual follow | the customer deliberately chose to follow |
| auto-follow | FadeUp followed automatically after a genuine interaction |
| **explicit unfollow** | the customer deliberately chose to stop |

> **An explicit unfollow must be respected.**

A later booking, however genuine, must **never** silently re-follow a
professional the customer deliberately removed. Only a deliberate manual follow
may reverse an explicit unfollow.

---

## 4. Social proof and public figures

### 4.1 Truth is not permission

> **A relationship being real, and even being verified, is NOT permission to
> publish it.**

Relationship *truth* and relationship *publishability* are separate concerns
and must be modelled separately. A professional may know that a verified
relationship exists without being allowed to advertise it.

### 4.2 "Already cutting X" requires explicit publishability

The public pattern — *Already cutting Lil Baby ✓* — is only permitted when all
of these hold:

1. the relationship is **genuine** (a real completed service);
2. the relationship is **verified**;
3. publication has been **explicitly approved**.

Approval is the customer's to give and the customer's to withdraw. It is never
implied by the relationship existing, by the customer being verified, or by the
customer having a public profile.

### 4.3 Public-figure operational data is never exposed

No public surface may reveal, for any customer:

* live location;
* current queue participation;
* future appointments;
* private visit timestamps;
* booking history;
* contact information.

Public social proof must expose the **smallest possible projection** — enough
to say the relationship exists, and nothing more.

### 4.4 Verification is auditable and never self-service

Verification must record what was verified, by whom, when, and whether it was
revoked. That audit metadata is internal and is never exposed publicly — not
even to its own subject.

A customer can never verify themselves.

---

## 5. Acquisition (Worker)

Worker is not a side project. It feeds marketplace supply, external profiles,
claims, sales and paid conversion, so its identity model is part of the core
domain.

### 5.1 A source observation is not an identity

> **Never: one scraper result = one professional.**

A source result is an *observation*. The pipeline is:

```
SOURCE → SOURCE OBSERVATION → NORMALIZED CANDIDATE → CANONICAL PROSPECT
       → PUBLIC ELIGIBILITY → EXTERNAL UNCLAIMED PROFILE → CLAIM
       → CLAIMED PROFESSIONAL / BUSINESS
```

Each arrow is a real transition that may fail, be deferred, or require review.

### 5.2 Worker is multi-source

One real business may be discovered through Google, Instagram, TikTok, its own
website, a directory, a manual entry, or a future source. Many observations
must be able to converge on **one** canonical entity when confidence is
sufficient, while the raw observations are preserved with their provenance.

### 5.3 Uncertain identity is never resolved destructively

> **A false merge of two real shops is worse than a temporarily unresolved
> duplicate.**

When confidence is insufficient, the correct outcome is an unresolved
candidate, not a merge. Any merge that does happen must be auditable — source,
destination, reason, confidence, timestamp, responsible actor — and must never
destroy provenance.

### 5.4 Claimed data outranks scraped data

Once a professional claims a profile, their own data is authoritative. Worker
observations may *suggest* updates; they must **never silently overwrite**
user-managed fields.

### 5.5 An unclaimed profile may never invent operational truth

An external profile may present legitimate public information. It must
**never** imply FadeUp state that does not exist:

* no booking availability;
* no live queue;
* no wait time;
* no active schedule;
* no realtime state;
* no verified-client count;
* no appointment status;
* no active subscription.

Defaults must be safe. This must be structurally difficult to violate, not
merely discouraged.

### 5.6 Claim state is not subscription state

> **`claimed` never means `paid`.**

*Claim state* answers **who controls this identity**.
*Subscription state* answers **what capabilities they have paid for**.

An account can be claimed and Free. These are separate axes and must never be
encoded in one field.

---

## 6. Pricing

Canonical, frozen:

| Plan | Price | Unit |
| --- | --- | --- |
| **FREE NETWORK** | €0 | — |
| **INDEPENDENT** | €20 / month | exactly **one** professional |
| **SHOP ESSENTIAL** | €35 / month | **per location** |
| **SHOP PRO** | €49 / month | **per location** — *primary / recommended plan* |
| **SHOP SCALE** | €69 / month | **per location** |

Two rules that constrain the data model:

* **Shop pricing is per LOCATION, not per barber seat.** Adding a barber to a
  location must never change the price of that location. The billing unit is
  the location.
* **INDEPENDENT is capped at exactly one professional.** That cap is a real
  constraint the model must be able to express and enforce.

**PRO is the primary, recommended plan.** Presentation should reflect that.

No architecture may make these rules impossible or expensive to implement
later.

---

## 7. Communication

> **FadeUp does not do SMS.**

No SMS. No SMS provider. No SMS concept anywhere in the schema, the
application, or the infrastructure.

Permitted channels:

* Fade Passport / device Wallet;
* push notifications;
* email.

---

## 8. Tenancy and safety

* **organizations** is the primary tenant entity.
* Every business resource carries `organization_id` or has an immutable
  ownership chain to one. Where a resource is deliberately platform-scoped
  rather than tenant-scoped, that must be stated and defended explicitly, not
  left as an omission.
* A user belonging to one organization must never read, modify, delete or
  **infer** private data belonging to another.
* `organization_id` submitted by a client is never trusted.
* Authorization is enforced server-side and by RLS. Frontend checks are never
  the authority.
* Tenant data is inaccessible by default.
* One business must never be assumed to be forever one physical location.

---

## 9. Interface principles

Barber-facing interfaces prioritise speed, touch usability, large actionable
controls, the fewest interactions, and realtime feedback.

Customer-facing interfaces prioritise minimal friction, clarity, fast booking,
fast queue interaction, and mobile-first usability.

Every important screen supports mobile, tablet and desktop, and has real
loading, empty, error and success states.

FadeUp must feel deliberately designed and consistent throughout. It must not
look like a generic AI-generated SaaS dashboard.

---

## 10. Engineering rules that are product rules

Some engineering constraints exist to protect product promises, and so belong
here:

* **A feature is not complete because it compiles.** Actual behaviour must be
  verified.
* **Schema changes are reproducible migrations.** Applied migration history is
  immutable; corrections go forward.
* **Existing data is valuable.** Additive-first; deprecate deliberately, later,
  and in writing.
* **Booking must not break.** A successful scheduled booking is confirmed
  immediately; no lot may reintroduce unnecessary manual acceptance.
* **The queue must not break.**
* **Reputation history must never be orphaned.**
* **Public URLs must not break.** If identity mapping changes, compatibility
  mapping is provided.
* **Never expose `service_role` or server secrets to frontend code.**
* **Never expose PostgreSQL directly to the public internet.**

---

## Amendment record

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-25 (R0 reconstruction) | Initial constitution. Rules consolidated from the product direction frozen for the Social-First V2 rebuild. |
