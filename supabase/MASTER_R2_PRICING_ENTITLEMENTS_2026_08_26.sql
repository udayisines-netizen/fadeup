-- ============================================================================
-- FadeUp — MASTER: R2, the pricing and entitlements foundation
-- Generated 2026-08-26. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-r2.sh
-- Verify in sync:   scripts/generate-master-r2.sh --check
--
-- WHAT THIS IS
--
--   R2 is the commercial model the product never had. Before it, plans, prices
--   and packaging existed only in TypeScript, one screen contradicted another,
--   and no trigger or policy could ask what an organization had paid for.
--
--   It adds five tables and the enforcement that makes them mean something:
--
--     commercial_plans                 the eight canonical plans and their caps
--     commercial_capabilities          the 30 real product capabilities
--     plan_capabilities                the one canonical plan/capability matrix
--     organization_commercial_state    one row per organization: what is in
--                                      force, and why
--     commercial_plan_changes          append-only commercial history
--
--   R2 REQUIRES R1A AND R1B. The first migration asserts it — professionals,
--   barbers.professional_id and appointments.completed_at must all be present —
--   and refuses to install otherwise.
--
-- THE PRICING, WHICH THIS FILE IS THE AUTHORITY FOR
--
--     free              EUR   0     1 establishment,  1 professional
--     solo              EUR  19     1 establishment,  1 professional
--     salon_essential   EUR  29     1 establishment,  team included
--     salon_pro         EUR  49     1 establishment,  team included  RECOMMENDED
--     salon_business    EUR  79     1 establishment,  team included
--     multi_growth      EUR  99     2 establishments, team included
--     multi_pro         EUR 149     5 establishments, team included  RECOMMENDED
--     multi_scale       EUR 249    10 establishments, team included
--
--   Every price is the TOTAL monthly price of the WHOLE plan. multi_pro is
--   EUR 149 for up to five establishments, not EUR 149 x 5. There is no
--   per-barber, per-seat, per-user or per-location amount anywhere, and
--   20260826110700 asserts the absence of any column a price could be
--   multiplied by.
--
-- THE DECISIONS AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A. NO CLIENT CAN GRANT ITSELF A PLAN.
--      anon and authenticated hold SELECT and nothing else on every commercial
--      table, and no INSERT/UPDATE/DELETE policy exists on any of them. A
--      PATCH setting plan_key = 'multi_scale' has no statement to make. The
--      only writer is public.assign_commercial_plan(), which requires platform
--      admin and appends an immutable audit row.
--
--   B. EXISTING ORGANIZATIONS ARE BACKFILLED WITHOUT INVENTING A PAYMENT.
--      Each gets the CHEAPEST plan whose capacity already covers the shape it
--      has, stamped entitlement_source = 'early_access' with provider NULL.
--      No tier is inferred from usage; nothing claims money changed hands.
--      A one-location, one-professional organization lands on `solo`, and the
--      next barber it hires will be refused until its plan is changed. That is
--      the intended commercial behaviour, and it is the single most visible
--      consequence of applying this file.
--
--   C. CAPS ARE ENFORCED BY TRIGGERS, NOT BY POLICIES.
--      Locations are created by a direct PostgREST insert, so before R2 a
--      single-salon shop could create its eleventh address from a browser
--      console. The cap is a BEFORE INSERT trigger, which fires for
--      service_role and postgres too — an RLS `with check` would have held for
--      the browser and evaporated everywhere else.
--
--   D. THE CAPS ARE RACE-FREE, AND THE MUTEX IS A REAL ROW.
--      Every capacity check takes SELECT ... FOR UPDATE on the organization's
--      single commercial-state row before counting, so two concurrent "add
--      location" or "add barber" requests cannot both pass on the same stale
--      count. Counting alone would not have been enough.
--
--   E. A DOWNGRADE FAILS; IT NEVER DELETES.
--      multi_scale with eight establishments cannot become multi_growth. The
--      change is refused with an explanation. Nothing is deactivated, archived
--      or hidden to make a plan fit — the organization deactivates what it no
--      longer operates first, deliberately, and then changes plan.
--
--   F. CANCELLING IS NOT A DOWNGRADE.
--      status = canceled resolves to free capacity while the assigned plan
--      stays visible. A five-location group that cancels keeps all five and can
--      create no sixth. If cancelling were treated as a downgrade, an
--      organization that stopped paying could never be cancelled.
--
--   G. FREE IS A LEGITIMATE STATE, NOT AN ERROR.
--      Not an expiry, not a failed trial, not a lapsed subscription. It is
--      network presence: be findable, show your services and hours, keep your
--      Fade Passport. No booking, no customers, no team, no queue.
--
--   H. R2 IS NOT BILLING. There is no Stripe, no checkout, no webhook, no price
--      id and no payment method in this file. Three opaque provider_* columns
--      exist so a later billing lot needs no schema change, and R2 leaves all
--      three NULL everywhere.
--
-- WHAT R2 DELIBERATELY DOES NOT DO
--
--   It does not gate booking, the queue, customer records or retention at the
--   database boundary. Those capabilities resolve through the same resolver and
--   the UI consumes it, but switching hard enforcement on would silently remove
--   working behaviour from organizations that have been using it throughout
--   early access. That is a product decision with its own migration, not a
--   side effect of installing a price list.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully rolls
--     back.
--   * Removes no table, removes no column, truncates nothing, deletes nothing.
--   * Writes data in one place: the commercial-state backfill, which is
--     INSERT-only and idempotent.
--   * Touches no R1A or R1B object, and re-asserts their column protections.
--   * Adds no anon RLS policy. The count stays at zero, and 20260826110700
--     asserts it globally.
--
-- HOW TO APPLY
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \\
--       -f supabase/MASTER_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--
--   Then run the companion verification and confirm zero FAIL rows:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--
--   R1A's and R1B's verifications must still pass unchanged:
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
--     psql -U postgres -d postgres \\
--       -f supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260826110000_commercial_plan_catalog.sql
-- ============================================================================

-- FadeUp — R2: the commercial plan catalogue, the capability catalogue, and
--               the one matrix that joins them
--
-- WHAT THIS FIXES
--
-- Before this migration FadeUp had NO commercial model in the database. Plans,
-- prices and packaging existed only in apps/web/src/lib/commerce/*.ts, whose
-- own header says it is "a DISPLAY and PACKAGING matrix ... not authorization".
-- Meanwhile a second, contradictory pricing truth was live at /pricing
-- (Starter / Growth / Multi-Location, "Unlimited locations", Chair Mode sold as
-- shipped). Two answers to "what does this cost" is one too many, and neither
-- of them could ever be asked by a policy or a trigger.
--
-- This file installs the answer that a trigger CAN ask.
--
-- THE COMMERCIAL MODEL, IN ONE PLACE
--
--   FOUR families                  free | independent | salon | multi_salon
--   EIGHT plans                    free, solo,
--                                  salon_essential, salon_pro, salon_business,
--                                  multi_growth, multi_pro, multi_scale
--
-- PLAN KEY IS THE IDENTITY. NOT THE LABEL, NOT THE PRICE.
--
--   The display name "Pro" belongs to TWO different plans — salon_pro (EUR 49,
--   one salon) and multi_pro (EUR 149, up to five). Any code that branches on
--   the word "Pro" is already wrong. Any code that branches on `price = 4900`
--   breaks the first time a region or a promotion exists. The primary key is
--   therefore the machine key, display_name carries no uniqueness constraint at
--   all (deliberately — two rows legitimately read "Pro"), and price is an
--   attribute rather than an identifier.
--
-- PRICE IS A TOTAL. THERE IS NO MULTIPLIER COLUMN, BY CONSTRUCTION.
--
--   multi_growth is EUR 99 for up to 2 establishments. Not EUR 99 x 2.
--   multi_pro is EUR 149 for up to 5. Not EUR 149 x 5.
--   salon_pro is EUR 49 for one salon with as many barbers as it employs.
--
--   The only defence against a future "price x count" that actually works is
--   for there to be no count to multiply by. So this table has:
--     * exactly one price column,
--     * capacity columns that are CAPS, named max_*, never quantity_* or
--       included_*, and
--     * no seat, no unit, no quantity, no per_* column of any kind.
--   20260826110700 asserts that absence rather than trusting it.
--
-- CAPACITY SEMANTICS
--
--   max_establishments             how many ACTIVE locations the organization
--                                  may operate. A cap, not an allowance that is
--                                  billed for.
--   max_operational_professionals  how many ACTIVE bookable professionals the
--                                  organization may roster. NULL means
--                                  unlimited, which is what "team is included"
--                                  means in a schema. It is NOT a large number:
--                                  a large number is a multiplier waiting to
--                                  happen, NULL is not.
--
--   free gets 1 establishment and 1 professional. That is PRESENCE, not a paid
--   operating salon: the free capability set below contains no booking, no
--   queue, no customer records and no team. A shop cannot quietly run itself on
--   Free, and a second chair or a second address is a commercial event.
--
--   solo gets exactly 1 professional, and that is the invariant Constitution
--   1.0 already demanded be "a real constraint the model must be able to
--   express and enforce" rather than a number on a marketing page.
--
-- CAPABILITY KEYS ARE COPIED VERBATIM FROM THE APPLICATION
--
--   commercial_capabilities.capability_key holds the EXACT strings used as
--   CapabilityId in apps/web/src/lib/commerce/plans.ts — camelCase and all.
--   That is not sloppiness; it is the anti-drift mechanism. If the two lists
--   are literally the same strings then "do the database and the UI agree" is a
--   set-equality test a machine can run (the R2 VERIFY suite and
--   apps/web/src/lib/commerce/catalog.test.ts both run it). Translating
--   camelCase to snake_case at this boundary would buy tidiness and pay for it
--   with a mapping table that can itself be wrong.
--
--   status/evidence are carried across for the same reason plans.ts carries
--   them: FadeUp does not advertise what it has not built, and the evidence
--   string is how the next person can check the claim instead of trusting it.
--
-- TENANCY
--
--   All three tables here are PLATFORM-SCOPED reference data with no
--   organization_id, which is an explicit exemption from the CLAUDE.md rule
--   rather than an omission. A plan catalogue that varied per tenant would mean
--   a tenant could hold a plan nobody else can see or price — the opposite of a
--   catalogue. Nothing tenant-private is stored here: these rows are the same
--   for every organization and are the published commercial offer.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. R1A/R1B preconditions, asserted rather than assumed
--
-- R2 must not install onto a database that has not been through R1B. The
-- entitlement model deliberately does NOT own professional identity, and the
-- capacity trigger in 20260826110500 counts professionals through the roster
-- R1B linked to it; installing here first would produce a commercial model
-- describing a domain that does not exist yet.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'professionals'
  ) then
    raise exception 'R2 precondition failed: public.professionals is missing — apply R1B first'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'barbers' and column_name = 'professional_id'
  ) then
    raise exception 'R2 precondition failed: barbers.professional_id is missing — apply R1B first'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'completed_at'
  ) then
    raise exception 'R2 precondition failed: appointments.completed_at is missing — apply R1A first'
      using errcode = '55000';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The commercial family
--
-- A genuinely closed set — FadeUp sells four kinds of commercial relationship
-- and adding a fifth is a product decision with its own migration — so an enum
-- rather than text + CHECK, matching membership_role and professional_source.
--
-- This is a THIRD axis and is not a duplicate of either of the two that exist:
--
--   organizations.business_type   what kind of business this is
--                                 (solo_professional | barbershop | hair_salon
--                                  | mixed_salon | multi_location).
--                                 Editable configuration. Drives onboarding
--                                 steps and starter templates. Says nothing
--                                 about money.
--   BusinessMode (frontend only)  which marketing narrative the /for-business
--                                 page is telling. Never persisted.
--   commercial_family (here)      what FadeUp is owed and what capacity is
--                                 granted. The only one an entitlement check
--                                 may consult.
--
-- A hair salon on multi_growth and a barbershop on multi_growth have the same
-- commercial family and different business types, and both facts are true.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commercial_family') then
    create type public.commercial_family as enum ('free', 'independent', 'salon', 'multi_salon');
  end if;
end $$;

comment on type public.commercial_family is
  'FadeUp commercial family: free | independent | salon | multi_salon. Distinct from organizations.business_type (what kind of business this is) and from the frontend BusinessMode (which marketing narrative is being told). Only this axis may be consulted by an entitlement decision.';

-- ---------------------------------------------------------------------------
-- 2. commercial_plans — the eight canonical plans
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_plans (
  -- The durable machine identity. Never a display name, never a price.
  plan_key text primary key,

  commercial_family public.commercial_family not null,

  -- Presentation only. Deliberately NOT unique: "Pro" is legitimately the label
  -- of both salon_pro and multi_pro, and a unique constraint here would force
  -- one of them to be renamed for a database's convenience.
  display_name text not null,

  -- Reference price, in MINOR units of price_currency, for ONE MONTH of the
  -- WHOLE PLAN. Integer so no float ever touches money. Regional prices are a
  -- presentation concern that lives in the application; this column is the
  -- commercial anchor every region is derived from and the value the R2 test
  -- matrix pins.
  price_minor integer not null,
  price_currency text not null default 'EUR',

  -- Cap on ACTIVE locations. Never billed per unit — see the header.
  max_establishments integer not null,

  -- Cap on ACTIVE bookable professionals. NULL = unlimited = "team included".
  max_operational_professionals integer,

  -- Exactly one recommended plan per family that has more than one plan.
  -- Asserted below rather than left to whoever edits the seed next.
  is_recommended boolean not null default false,

  -- Order within the family, cheapest first. Drives the plan rail and lets an
  -- upgrade/downgrade direction be computed without comparing prices.
  tier smallint not null,

  -- Whether FadeUp is currently selling this plan. A plan that is withdrawn
  -- must remain in the catalogue for the organizations still on it, so removal
  -- is never the answer and DELETE is not granted to anyone.
  is_available boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commercial_plans_key_shape
    check (plan_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint commercial_plans_display_name_not_blank
    check (btrim(display_name) <> ''),
  -- Zero is legal (free) and negative is not. Free is a real plan state, not
  -- an error state, so the constraint admits it explicitly.
  constraint commercial_plans_price_non_negative
    check (price_minor >= 0),
  constraint commercial_plans_currency_format
    check (price_currency ~ '^[A-Z]{3}$'),
  -- At least one establishment: every plan, including free, addresses one
  -- place. A zero here would make onboarding unsatisfiable rather than
  -- commercially restrictive.
  constraint commercial_plans_establishments_positive
    check (max_establishments >= 1),
  constraint commercial_plans_professionals_positive
    check (max_operational_professionals is null or max_operational_professionals >= 1),
  constraint commercial_plans_tier_positive
    check (tier >= 1),

  -- The free plan is free, and nothing else is. Encoded so a future edit that
  -- puts a price on free, or gives away a paid plan, fails at write time.
  constraint commercial_plans_free_family_is_free
    check ((commercial_family = 'free') = (price_minor = 0)),

  -- An independent plan covers exactly one professional. This is the schema
  -- refusing to let Solo become a cheap multi-barber salon by edit rather than
  -- by exploit.
  constraint commercial_plans_independent_is_single_professional
    check (commercial_family <> 'independent' or max_operational_professionals = 1),

  -- A single-salon plan covers exactly one salon; a multi-salon plan covers
  -- more than one. If those two were ever allowed to overlap, "you need a
  -- Multi plan for a second address" would stop being true.
  constraint commercial_plans_salon_is_single_establishment
    check (commercial_family <> 'salon' or max_establishments = 1),
  constraint commercial_plans_multi_is_several_establishments
    check (commercial_family <> 'multi_salon' or max_establishments >= 2),
  constraint commercial_plans_free_is_single_everything
    check (commercial_family <> 'free'
           or (max_establishments = 1 and max_operational_professionals = 1))
);

comment on table public.commercial_plans is
  'The eight canonical FadeUp commercial plans. plan_key is the ONLY durable identity — display_name is deliberately non-unique because "Pro" names both salon_pro and multi_pro, and price is an attribute, never an identifier. price_minor is the TOTAL monthly price of the whole plan: there is no quantity column anywhere in this schema for it to be multiplied by, and that absence is asserted by 20260826110700.';

comment on column public.commercial_plans.plan_key is
  'Durable machine identity. Business logic branches on this and never on display_name (two plans read "Pro") or on price (regions and promotions move it).';
comment on column public.commercial_plans.price_minor is
  'TOTAL monthly price of the entire plan, in minor units of price_currency. multi_growth is 9900 for up to two establishments — not 9900 per establishment. FadeUp charges no per-barber, per-seat, per-user or per-location amount.';
comment on column public.commercial_plans.max_establishments is
  'Cap on ACTIVE locations the organization may operate. A commercial capacity limit enforced by public.enforce_establishment_capacity(), never a billed quantity.';
comment on column public.commercial_plans.max_operational_professionals is
  'Cap on ACTIVE bookable professionals. NULL means unlimited, which is how "team is included" is spelled in a schema — deliberately NULL rather than a large number, because a large number is a multiplier waiting to be discovered.';
comment on column public.commercial_plans.is_available is
  'Whether FadeUp currently sells this plan. Withdrawing a plan must never delete it: organizations remain on it and their entitlements must keep resolving, so no role holds DELETE on this table.';

create index if not exists commercial_plans_family_tier_idx
  on public.commercial_plans (commercial_family, tier);

drop trigger if exists commercial_plans_set_updated_at on public.commercial_plans;
create trigger commercial_plans_set_updated_at
  before update on public.commercial_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. commercial_capabilities — what a plan may unlock
--
-- Every key below exists in apps/web/src/lib/commerce/plans.ts as a
-- CapabilityId, with the same status and the same evidence. Nothing here was
-- invented to make a tier look fuller: the set is exactly the product FadeUp
-- has audited, and the six-item retention suite is carried as `planned` for the
-- same reason it is carried that way in the application — it is packaged and
-- priced but not built, and a checkmark that means "we intend to" is a lie a
-- pricing table tells very efficiently.
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_capabilities (
  capability_key text primary key,

  -- foundation | floor | retention | scale. Text + CHECK rather than an enum:
  -- unlike commercial_family this set is expected to grow as the product does,
  -- and a grouping label carries no authorization weight.
  capability_group text not null,

  -- 'live'    — shipped in this repository, verified against routes/migrations
  -- 'planned' — packaged and priced, not built. Never presented as included.
  status text not null,

  -- Why that status. In the schema rather than a wiki, because the honesty rule
  -- only holds if the next person can see what was actually checked.
  evidence text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commercial_capabilities_key_shape
    check (capability_key ~ '^[a-zA-Z][a-zA-Z0-9]{1,39}$'),
  constraint commercial_capabilities_group_known
    check (capability_group in ('foundation', 'floor', 'retention', 'scale')),
  constraint commercial_capabilities_status_known
    check (status in ('live', 'planned')),
  constraint commercial_capabilities_evidence_not_blank
    check (btrim(evidence) <> '')
);

comment on table public.commercial_capabilities is
  'Named capabilities a plan may unlock. capability_key is copied VERBATIM (camelCase included) from CapabilityId in apps/web/src/lib/commerce/plans.ts, so "do the database and the UI agree" is a set-equality test rather than a mapping table that can itself be wrong. status=planned means packaged but not built and must never render as included.';

comment on column public.commercial_capabilities.status is
  'live = shipped and verified in this repository. planned = packaged and priced but not built; never counted as included and never enforced as a paid gate, because there is nothing to gate.';

drop trigger if exists commercial_capabilities_set_updated_at on public.commercial_capabilities;
create trigger commercial_capabilities_set_updated_at
  before update on public.commercial_capabilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. plan_capabilities — the matrix
--
-- FK deletion behaviour, chosen deliberately in both directions:
--
--   plan_key       ON DELETE RESTRICT, ON UPDATE CASCADE
--                  Deleting a plan that still packages capabilities is a
--                  mistake, not a cascade. Renaming one (which will not happen,
--                  but the catalogue should survive it) should carry.
--   capability_key ON DELETE RESTRICT, ON UPDATE CASCADE
--                  Same argument. Removing a capability from the product means
--                  removing its rows here first, explicitly, so that nobody
--                  discovers afterwards that four plans silently shrank.
--
-- Neither is CASCADE and neither is SET NULL: a matrix row with a NULL side is
-- not a weaker statement, it is a nonsensical one.
-- ---------------------------------------------------------------------------

create table if not exists public.plan_capabilities (
  plan_key text not null
    references public.commercial_plans (plan_key) on update cascade on delete restrict,
  capability_key text not null
    references public.commercial_capabilities (capability_key) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  primary key (plan_key, capability_key)
);

comment on table public.plan_capabilities is
  'The single canonical plan -> capability matrix. Both FKs are ON DELETE RESTRICT: removing a plan or a capability that is still packaged must be an explicit, visible act, never a cascade that silently shrinks four plans at once.';

create index if not exists plan_capabilities_capability_idx
  on public.plan_capabilities (capability_key);

-- ---------------------------------------------------------------------------
-- 5. Seed the catalogue
--
-- Written as full-row upserts so re-running the migration converges rather than
-- accumulating. Prices are literals, not arithmetic: a price computed from
-- another price is the first step towards a multiplier.
-- ---------------------------------------------------------------------------

insert into public.commercial_plans
  (plan_key, commercial_family, display_name, price_minor, price_currency,
   max_establishments, max_operational_professionals, is_recommended, tier)
values
  -- FREE NETWORK — presence, not a paid operating system. A legitimate state:
  -- not an expiry, not a failure, not a lapsed trial.
  ('free',            'free',        'Free',      0,     'EUR', 1,  1,    false, 1),

  -- INDEPENDENT — one professional working alone. Capped at one professional
  -- by the family CHECK above as well as by this row.
  ('solo',            'independent', 'Solo',      1900,  'EUR', 1,  1,    false, 1),

  -- SALON — exactly one operating salon, any number of barbers in it.
  ('salon_essential', 'salon',       'Essential', 2900,  'EUR', 1,  null, false, 1),
  ('salon_pro',       'salon',       'Pro',       4900,  'EUR', 1,  null, true,  2),
  ('salon_business',  'salon',       'Business',  7900,  'EUR', 1,  null, false, 3),

  -- MULTI-SALONS — TOTAL package prices. 9900 buys up to two establishments,
  -- not one establishment twice.
  ('multi_growth',    'multi_salon', 'Growth',    9900,  'EUR', 2,  null, false, 1),
  ('multi_pro',       'multi_salon', 'Pro',       14900, 'EUR', 5,  null, true,  2),
  ('multi_scale',     'multi_salon', 'Scale',     24900, 'EUR', 10, null, false, 3)
on conflict (plan_key) do update set
  commercial_family             = excluded.commercial_family,
  display_name                  = excluded.display_name,
  price_minor                   = excluded.price_minor,
  price_currency                = excluded.price_currency,
  max_establishments            = excluded.max_establishments,
  max_operational_professionals = excluded.max_operational_professionals,
  is_recommended                = excluded.is_recommended,
  tier                          = excluded.tier,
  is_available                  = true;

insert into public.commercial_capabilities (capability_key, capability_group, status, evidence)
values
  -- foundation -------------------------------------------------------------
  ('marketplace',          'foundation', 'live',    'search_public_organizations RPC + /search + marketplace_visible opt-in'),
  ('publicProfile',        'foundation', 'live',    '/s/:slug shop profile and /s/:slug/barbers/:id barber profile'),
  ('services',             'foundation', 'live',    'services, service_categories, service_locations, barber_services'),
  ('availability',         'foundation', 'live',    'location_hours, barber_working_hours, barber_availability_exceptions'),
  ('booking',              'foundation', 'live',    'appointments + get_public_available_slots + book_public_appointment'),
  ('customers',            'foundation', 'live',    'customers table + /app/customers'),
  ('customerHistory',      'foundation', 'live',    'appointments linked to customers; per-customer visit list'),
  ('passport',             'foundation', 'live',    'customer_passports + photos + shares (customer-owned, portable)'),
  ('manualRebook',         'foundation', 'live',    'booking a known customer again from the shop or the customer app'),
  ('notifications',        'foundation', 'live',    'transactional booking/queue confirmations via Supabase auth + queue state'),

  -- floor ------------------------------------------------------------------
  ('walkIns',              'floor',      'live',    '/s/:slug/walk-in public walk-in intake'),
  ('team',                 'floor',      'live',    'memberships (owner/manager/receptionist/barber) + invitations'),
  ('liveQueue',            'floor',      'live',    'queue_entries + realtime + /app/queue + get_my_queue_status'),
  ('queueDisplay',         'floor',      'live',    '/s/:slug/display in-shop queue screen'),
  ('chairs',               'floor',      'live',    'chairs table + /app/chairs'),
  ('chairMode',            'floor',      'planned', 'GAP: no dedicated at-the-chair surface. queue_status reaches in_service and chairs exist, but chairs are not joined to queue_entries and there is no barber-facing chair screen.'),
  ('waitlist',             'floor',      'live',    'waitlist + no-show rules migration + /app/waitlist'),

  -- retention --------------------------------------------------------------
  ('returnCycles',         'retention',  'planned', 'GAP: no return-cycle or days-since-last-cut computation anywhere in db/migrations.'),
  ('comebackReminders',    'retention',  'planned', 'GAP: no scheduled outbound messaging exists.'),
  ('inactiveCustomers',    'retention',  'planned', 'GAP: no inactivity detection.'),
  ('customerSegments',     'retention',  'planned', 'GAP: no segmentation model.'),
  ('retentionAutomation',  'retention',  'planned', 'GAP: no automation engine.'),
  ('retentionInsights',    'retention',  'planned', 'GAP: no retention analytics.'),

  -- scale ------------------------------------------------------------------
  ('multiLocation',        'scale',      'live',    'locations are 1:N under an organization; services/hours/queues are location-scoped'),
  ('locationSwitching',    'scale',      'live',    'active-location scope across /app + invitation_location_scope'),
  ('crossLocationView',    'scale',      'live',    'owner/manager read across every location of their own organization via RLS'),
  ('advancedPermissions',  'scale',      'planned', 'GAP: membership_role is a fixed four-value enum; no per-capability grants.'),
  ('advancedBookingRules', 'scale',      'planned', 'GAP: beyond hours/no-show rules there is no configurable booking policy engine.'),
  ('advancedReporting',    'scale',      'planned', 'GAP: no reporting or analytics surface exists.'),
  ('prioritySupport',      'scale',      'planned', 'GAP: no support tiering is in place operationally.')
on conflict (capability_key) do update set
  capability_group = excluded.capability_group,
  status           = excluded.status,
  evidence         = excluded.evidence;

-- The matrix. Built from named sets so the intent is readable and so a plan
-- cannot accidentally be given a capability that no set contains.
--
-- FREE is the one set that is NOT "foundation plus something". It is
-- deliberately a strict subset: be findable, show what you do, keep your
-- Passport. No booking, no customer records, no team, no queue. That is the
-- honest meaning of "Soyez visible" and it is what makes Solo at EUR 19 an
-- upgrade rather than a formality.
with foundation(capability_key) as (
  values ('marketplace'), ('publicProfile'), ('services'), ('availability'),
         ('booking'), ('customers'), ('customerHistory'), ('passport'),
         ('manualRebook'), ('notifications')
),
free_set(capability_key) as (
  -- Fade Passport is in EVERY plan including this one. It is a network feature:
  -- a customer owns their Passport and carries it between shops, so paywalling
  -- it would break the thing that makes it worth having.
  values ('marketplace'), ('publicProfile'), ('services'), ('availability'), ('passport')
),
floor_set(capability_key) as (
  values ('walkIns'), ('team'), ('liveQueue'), ('queueDisplay'), ('chairs'),
         ('chairMode'), ('waitlist')
),
retention_set(capability_key) as (
  values ('returnCycles'), ('comebackReminders'), ('inactiveCustomers'),
         ('customerSegments'), ('retentionAutomation'), ('retentionInsights')
),
multi_core(capability_key) as (
  values ('multiLocation'), ('locationSwitching'), ('crossLocationView')
),
advanced_control(capability_key) as (
  values ('advancedPermissions'), ('advancedBookingRules'),
         ('advancedReporting'), ('prioritySupport')
),
matrix(plan_key, capability_key) as (
  -- free: presence only
  select 'free', capability_key from free_set

  -- solo: the whole foundation, plus the two floor tools a barber working
  -- alone genuinely uses. None of the team/chair machinery, which would be
  -- noise for one person rather than a withheld feature.
  union all select 'solo', capability_key from foundation
  union all select 'solo', capability_key from (values ('walkIns'), ('liveQueue')) as s(capability_key)

  -- salon_essential: a real entry-level shop product, not a demo
  union all select 'salon_essential', capability_key from foundation
  union all select 'salon_essential', capability_key from (values ('walkIns'), ('team')) as s(capability_key)

  -- salon_pro: the floor runs live, and customers come back
  union all select 'salon_pro', capability_key from foundation
  union all select 'salon_pro', capability_key from floor_set
  union all select 'salon_pro', capability_key from retention_set

  -- salon_business: pilotage becomes optimisation
  union all select 'salon_business', capability_key from foundation
  union all select 'salon_business', capability_key from floor_set
  union all select 'salon_business', capability_key from retention_set
  union all select 'salon_business', capability_key from advanced_control

  -- multi_growth: several shops, run properly
  union all select 'multi_growth', capability_key from foundation
  union all select 'multi_growth', capability_key from floor_set
  union all select 'multi_growth', capability_key from multi_core

  -- multi_pro: one network, one view — retention across the whole group
  union all select 'multi_pro', capability_key from foundation
  union all select 'multi_pro', capability_key from floor_set
  union all select 'multi_pro', capability_key from multi_core
  union all select 'multi_pro', capability_key from retention_set

  -- multi_scale: centralised control of the network
  union all select 'multi_scale', capability_key from foundation
  union all select 'multi_scale', capability_key from floor_set
  union all select 'multi_scale', capability_key from multi_core
  union all select 'multi_scale', capability_key from retention_set
  union all select 'multi_scale', capability_key from advanced_control
)
insert into public.plan_capabilities (plan_key, capability_key)
select distinct plan_key, capability_key from matrix
on conflict (plan_key, capability_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Assert the catalogue is what R2 says it is
--
-- The seed above is data, and data is the thing that gets edited by whoever is
-- in a hurry. These blocks turn the commercial decisions into properties the
-- migration refuses to install without.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_bad text := '';
  r record;
begin
  select count(*) into v_count from public.commercial_plans;
  if v_count <> 8 then
    raise exception 'R2 catalogue check failed: expected exactly 8 plans, found %', v_count
      using errcode = 'P0001';
  end if;

  -- Every canonical key present, at exactly the canonical price and capacity.
  for r in
    select * from (values
      ('free',            'free'::public.commercial_family,        0,     1,  null::integer),
      ('solo',            'independent'::public.commercial_family, 1900,  1,  1),
      ('salon_essential', 'salon'::public.commercial_family,       2900,  1,  null),
      ('salon_pro',       'salon'::public.commercial_family,       4900,  1,  null),
      ('salon_business',  'salon'::public.commercial_family,       7900,  1,  null),
      ('multi_growth',    'multi_salon'::public.commercial_family, 9900,  2,  null),
      ('multi_pro',       'multi_salon'::public.commercial_family, 14900, 5,  null),
      ('multi_scale',     'multi_salon'::public.commercial_family, 24900, 10, null)
    ) as expected(plan_key, fam, price_minor, max_est, max_pro)
  loop
    if not exists (
      select 1 from public.commercial_plans p
      where p.plan_key = r.plan_key
        and p.commercial_family = r.fam
        and p.price_minor = r.price_minor
        and p.price_currency = 'EUR'
        and p.max_establishments = r.max_est
        and (r.plan_key <> 'free' or p.max_operational_professionals = 1)
        and (r.plan_key = 'free' or p.max_operational_professionals is not distinct from r.max_pro)
    ) then
      v_bad := v_bad || ' ' || r.plan_key;
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 catalogue check failed: wrong price/family/capacity for:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_bad text := '';
  r record;
begin
  -- Exactly one recommended plan in each family that offers a choice, and none
  -- in the two single-plan families (nothing to recommend against).
  for r in
    select commercial_family, count(*) as plans, count(*) filter (where is_recommended) as recommended
    from public.commercial_plans
    group by commercial_family
  loop
    if r.plans > 1 and r.recommended <> 1 then
      v_bad := v_bad || format(' %s(%s recommended of %s)', r.commercial_family, r.recommended, r.plans);
    end if;
    if r.plans = 1 and r.recommended <> 0 then
      v_bad := v_bad || format(' %s(single plan marked recommended)', r.commercial_family);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 recommended-plan check failed:%', v_bad using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_dupes integer;
begin
  -- salon_pro and multi_pro MUST remain distinct machine identities even though
  -- both read "Pro". This asserts the opposite of a unique constraint: that the
  -- catalogue really does contain two rows sharing a display name, so anybody
  -- who "fixes" it by renaming one trips this check and has to read why.
  select count(*) into v_dupes
  from public.commercial_plans
  where display_name = 'Pro';

  if v_dupes <> 2 then
    raise exception 'R2 identity check failed: expected two distinct plans displaying "Pro" (salon_pro, multi_pro), found %', v_dupes
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.commercial_plans where plan_key = 'salon_pro' and display_name = 'Pro')
     or not exists (select 1 from public.commercial_plans where plan_key = 'multi_pro' and display_name = 'Pro') then
    raise exception 'R2 identity check failed: salon_pro and multi_pro must both display "Pro" and remain separate keys'
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_count integer;
begin
  -- 30 = foundation 10 + floor 7 + retention 6 + scale 7, which is exactly the
  -- CapabilityId union in apps/web/src/lib/commerce/plans.ts. Pinned as a
  -- number so that adding a capability to one side and not the other fails
  -- here, before the two catalogues can disagree in production.
  select count(*) into v_count from public.commercial_capabilities;
  if v_count <> 30 then
    raise exception 'R2 capability check failed: expected 30 capabilities (the audited application set), found %', v_count
      using errcode = 'P0001';
  end if;

  -- Fade Passport is in EVERY plan, without exception. The application asserts
  -- this in its own test suite; the database asserts it here so the two cannot
  -- disagree about the one capability FadeUp has promised never to paywall.
  select count(*) into v_count
  from public.commercial_plans p
  where not exists (
    select 1 from public.plan_capabilities pc
    where pc.plan_key = p.plan_key and pc.capability_key = 'passport'
  );
  if v_count <> 0 then
    raise exception 'R2 capability check failed: % plan(s) do not include Fade Passport', v_count
      using errcode = 'P0001';
  end if;

  -- Every plan resolves to a non-empty capability set. A plan that grants
  -- nothing would resolve deterministically to "deny everything", which is a
  -- catalogue bug wearing a correct-looking answer.
  select count(*) into v_count
  from public.commercial_plans p
  where not exists (select 1 from public.plan_capabilities pc where pc.plan_key = p.plan_key);
  if v_count <> 0 then
    raise exception 'R2 capability check failed: % plan(s) package no capabilities at all', v_count
      using errcode = 'P0001';
  end if;

  -- Free must be strictly smaller than every paid plan. If free ever packaged
  -- as much as solo, the EUR 19 upgrade would be a formality and the free tier
  -- would quietly become the product.
  if (select count(*) from public.plan_capabilities where plan_key = 'free')
     >= (select count(*) from public.plan_capabilities where plan_key = 'solo') then
    raise exception 'R2 capability check failed: free packages as much as solo — free must be presence, not the operating system'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS and privileges
--
-- Supabase default privileges grant anon, authenticated and service_role
-- EVERYTHING on any new table in public (pg_default_acl -> arwdDxtm), so RLS
-- alone is not enough: every table revokes explicitly and 20260826110700
-- re-asserts the whole matrix and fails the migration if any of it is wrong.
--
-- These three tables are the PUBLISHED commercial offer, so authenticated may
-- read them — that is what lets the application prove at runtime that its own
-- catalogue has not drifted from the database's. Nobody may write them: the
-- catalogue changes through a migration, which is the only change that also
-- gets reviewed.
--
-- No policy is granted to anon. The database has had ZERO anon policies since
-- it shipped and R1B asserts that globally; the marketing pricing page reads
-- the application's compiled catalogue, not the database, so nothing here needs
-- an anonymous read.
-- ---------------------------------------------------------------------------

alter table public.commercial_plans enable row level security;
alter table public.commercial_plans force row level security;
alter table public.commercial_capabilities enable row level security;
alter table public.commercial_capabilities force row level security;
alter table public.plan_capabilities enable row level security;
alter table public.plan_capabilities force row level security;

revoke all on public.commercial_plans from anon, authenticated, prospect_worker;
revoke all on public.commercial_capabilities from anon, authenticated, prospect_worker;
revoke all on public.plan_capabilities from anon, authenticated, prospect_worker;

grant select on public.commercial_plans to authenticated;
grant select on public.commercial_capabilities to authenticated;
grant select on public.plan_capabilities to authenticated;

drop policy if exists commercial_plans_select on public.commercial_plans;
create policy commercial_plans_select
  on public.commercial_plans
  for select
  to authenticated
  using (true);

drop policy if exists commercial_capabilities_select on public.commercial_capabilities;
create policy commercial_capabilities_select
  on public.commercial_capabilities
  for select
  to authenticated
  using (true);

drop policy if exists plan_capabilities_select on public.plan_capabilities;
create policy plan_capabilities_select
  on public.plan_capabilities
  for select
  to authenticated
  using (true);

do $$
begin
  raise notice 'R2 commercial plan catalogue installed: 8 plans, 30 capabilities';
end $$;


-- ============================================================================
-- END db/migrations/20260826110000_commercial_plan_catalog.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110100_organization_commercial_state.sql
-- ============================================================================

-- FadeUp — R2: what commercial agreement an organization is actually under
--
-- ONE ROW PER ORGANIZATION, AND THE BROWSER CANNOT WRITE IT
--
-- The entire point of this table is that it is the ONLY place the answer to
-- "what may this organization do commercially" is stored, and that no client
-- holds a privilege that could change it. Concretely:
--
--   * anon and authenticated have every privilege REVOKED at table level;
--   * there is no INSERT, UPDATE or DELETE policy for any client role, so even
--     if a privilege were re-granted by a careless future migration, RLS would
--     still refuse;
--   * writes happen through exactly two paths — the AFTER INSERT trigger that
--     gives a new organization its default state, and
--     public.assign_commercial_plan() in 20260826110600, which requires
--     platform admin;
--   * every plan change is mirrored into an append-only audit table.
--
-- A member PATCHing `plan_key = 'multi_scale'` onto their own organization is
-- not "blocked by a policy that happens to be correct". There is no grant for
-- the statement to use.
--
-- PROVIDER-AGNOSTIC BY DESIGN. NO BILLING PROVIDER IS CHOSEN HERE.
--
-- R2 is not the billing lot. There is no Stripe, no checkout, no webhook, no
-- price id and no payment method anywhere in this schema. What exists is three
-- deliberately opaque text columns — provider, provider_customer_ref,
-- provider_subscription_ref — that a later billing layer can populate without
-- another schema migration, and which R2 leaves NULL everywhere.
--
-- The rule that outlives the provider choice: THIS ROW IS AUTHORITATIVE FOR
-- ACCESS DECISIONS, always. A provider is a source of billing events that
-- update this row; it is never consulted at request time and never overrides
-- it. That is what makes an entitlement check a local, fast, always-available
-- answer rather than a network call that can fail open.
--
-- WHY status IS SEPARATE FROM plan_key
--
--   plan_key   which package. free is a package.
--   status     whether that package is currently in force.
--
-- Collapsing them would make "free" mean both "the Free plan" and "the paid
-- plan that lapsed", and Constitution/R2 are explicit that FREE IS NOT AN
-- ERROR STATE. An organization on `free` is `active`. An organization whose
-- salon_pro payment failed is `salon_pro` + `past_due` and keeps its identity,
-- its social graph and its history while the commercial question is resolved.
--
-- WHY entitlement_source EXISTS, AND WHAT THE BACKFILL IS ALLOWED TO CLAIM
--
--   'billing'        a billing provider is the reason this plan is in force.
--                    R2 never writes this value. Nothing in this repository
--                    can, because no billing integration exists.
--   'platform_grant' FadeUp staff deliberately granted this plan. Auditable,
--                    attributable, and honest about being a decision rather
--                    than a payment.
--   'early_access'   the plan is in force because FadeUp is pre-billing and
--                    every organization has the product. This is a REAL and
--                    CURRENT commercial fact, already stated publicly on the
--                    pricing FAQ; recording it is not the same as fabricating a
--                    payment, and 20260826110200 uses only this value.
--
-- No column in this table asserts that money changed hands, and none ever
-- should until a provider actually says so.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Closed sets, so enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commercial_status') then
    -- Deliberately three values, not four. There is no 'trialing': FadeUp runs
    -- no trial today, and an enum value that nothing can produce is a branch
    -- every future reader has to reason about for nothing.
    create type public.commercial_status as enum ('active', 'past_due', 'canceled');
  end if;

  if not exists (select 1 from pg_type where typname = 'entitlement_source') then
    create type public.entitlement_source as enum ('early_access', 'platform_grant', 'billing');
  end if;
end $$;

comment on type public.commercial_status is
  'Whether the assigned plan is currently in force. free + active is the normal, healthy state of a network-tier organization — free is NEVER an error, an expiry or a failed trial.';
comment on type public.entitlement_source is
  'Why this plan is in force. billing = a provider said so (R2 never writes it; no provider exists). platform_grant = FadeUp staff decided. early_access = pre-billing, everyone has the product. Nothing here claims a payment occurred.';

-- ---------------------------------------------------------------------------
-- 2. organization_commercial_state
--
-- organization_id is both the PK and the FK, which is how "exactly one row per
-- organization" is spelled without a second unique index. That single-row
-- property is load-bearing beyond tidiness: the capacity triggers in
-- 20260826110400/500 take `SELECT ... FOR UPDATE` on this row and use it as the
-- per-organization mutex that serialises concurrent location and roster
-- creation. If an organization could have two commercial rows, two concurrent
-- transactions could lock different ones and both pass the same cap check.
--
-- FK behaviour:
--   organization_id  ON DELETE CASCADE. Commercial state describes an
--                    organization and is meaningless without it; leaving an
--                    orphan row would let a recreated slug inherit a stranger's
--                    plan. Note this is a cascade INTO the commercial model,
--                    never out of it — deleting a plan or a professional
--                    identity never deletes anything here, and nothing here
--                    ever deletes an establishment, a customer or a
--                    professional. Commercial deletion does not cascade into
--                    social identity, which is R1B's guarantee and R2 must not
--                    weaken it.
--   plan_key         ON DELETE RESTRICT. A plan an organization is on cannot be
--                    deleted out from under it. ON UPDATE CASCADE so a rename
--                    (which should never happen) would carry rather than break.
--   assigned_by      ON DELETE SET NULL. Erasing a staff account must not
--                    dead-end on a foreign key, and must not destroy the
--                    organization's commercial state. The audit table keeps the
--                    history either way.
-- ---------------------------------------------------------------------------

create table if not exists public.organization_commercial_state (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  plan_key text not null default 'free'
    references public.commercial_plans (plan_key) on update cascade on delete restrict,

  status public.commercial_status not null default 'active',

  entitlement_source public.entitlement_source not null default 'early_access',

  -- When the CURRENT plan took effect. Not a billing period boundary — R2 has
  -- no billing periods.
  assigned_at timestamptz not null default now(),

  -- Who decided. NULL for the automatic default a new organization receives and
  -- for the backfill, both of which are the system rather than a person.
  assigned_by uuid references auth.users (id) on delete set null,

  assignment_note text,

  -- Opaque, provider-agnostic. R2 leaves all three NULL and writes none of
  -- them. A later billing lot fills them in without a schema change.
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A provider reference without a named provider is an orphan string nobody
  -- can interpret. Either the provider is known or there are no refs.
  constraint organization_commercial_state_provider_refs_need_provider
    check (provider is not null
           or (provider_customer_ref is null and provider_subscription_ref is null)),

  -- Free is never past_due and never canceled: there is nothing to owe and
  -- nothing to cancel. Without this, "free + past_due" becomes representable
  -- and every consumer has to decide what it means.
  constraint organization_commercial_state_free_is_active
    check (plan_key <> 'free' or status = 'active'),

  -- R2 writes no billing evidence. This constraint is deliberately narrow: it
  -- says a 'billing' source must name its provider, so the value cannot be set
  -- as a bare boast. It does not, and must not, try to prove a payment.
  constraint organization_commercial_state_billing_needs_provider
    check (entitlement_source <> 'billing' or provider is not null)
);

comment on table public.organization_commercial_state is
  'Exactly one row per organization: which commercial plan is in force, whether it is in force, and why. THE authoritative input to every entitlement decision. anon and authenticated hold no privilege on this table and there is no client-facing write policy of any kind — the only writers are the new-organization default trigger and public.assign_commercial_plan(), which requires platform admin. organization_id is the primary key so the row can also serve as the per-organization mutex the capacity triggers lock.';

comment on column public.organization_commercial_state.plan_key is
  'Which package. Machine identity only — never a display name, never a price. Defaults to free, which is a legitimate network state and not a failure.';
comment on column public.organization_commercial_state.status is
  'Whether the package is in force. Separate from plan_key on purpose: collapsing them would make "free" mean both the Free plan and a plan that lapsed.';
comment on column public.organization_commercial_state.entitlement_source is
  'Why the plan is in force. R2 never writes billing: no billing provider is integrated, and marking an organization paid because someone clicked a plan in a browser is exactly the fabrication this column exists to make visible.';
comment on column public.organization_commercial_state.provider is
  'Opaque billing-provider name. NULL throughout R2. Present so a later billing lot needs no schema migration, and so it is obvious that no provider is the source of truth for access — this row is.';

create index if not exists organization_commercial_state_plan_key_idx
  on public.organization_commercial_state (plan_key);
create index if not exists organization_commercial_state_status_idx
  on public.organization_commercial_state (status);

drop trigger if exists organization_commercial_state_set_updated_at on public.organization_commercial_state;
create trigger organization_commercial_state_set_updated_at
  before update on public.organization_commercial_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. commercial_plan_changes — the append-only record
--
-- Plan assignment is the single most abusable operation R2 adds, so it leaves
-- a trail that cannot be edited afterwards. Append-only is enforced twice: no
-- role is granted UPDATE or DELETE, and a trigger refuses both regardless of
-- privilege, which also covers postgres and service_role.
--
-- Kept separate from public.audit_logs deliberately. audit_logs is a generic
-- tenant activity feed readable by owners/managers; this is commercial history
-- with a fixed shape that a billing reconciliation will need to join on, and
-- burying it in a jsonb payload would make that join guesswork.
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_plan_changes (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- NULL for the very first assignment (an organization coming into existence
  -- has no previous plan). ON DELETE RESTRICT: history must keep naming a real
  -- plan.
  previous_plan_key text
    references public.commercial_plans (plan_key) on update cascade on delete restrict,
  new_plan_key text not null
    references public.commercial_plans (plan_key) on update cascade on delete restrict,

  previous_status public.commercial_status,
  new_status public.commercial_status not null,

  entitlement_source public.entitlement_source not null,

  -- NULL when the system did it (default assignment, backfill). Never NULL for
  -- a platform-admin assignment — assign_commercial_plan() always has a caller.
  changed_by uuid references auth.users (id) on delete set null,

  change_reason text,

  created_at timestamptz not null default now(),

  constraint commercial_plan_changes_not_a_noop
    check (previous_plan_key is distinct from new_plan_key
           or previous_status is distinct from new_status)
);

comment on table public.commercial_plan_changes is
  'Append-only commercial history: every plan or status transition, who caused it and why. Enforced append-only by trigger as well as by privilege, so it holds for postgres and service_role too. Deliberately not folded into audit_logs: a billing reconciliation needs a fixed shape to join on, not a jsonb payload.';

create index if not exists commercial_plan_changes_organization_idx
  on public.commercial_plan_changes (organization_id, created_at desc);

create or replace function public.reject_commercial_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- No role exemption, on purpose. An audit trail that the most powerful role
  -- can rewrite is a log, not an audit trail.
  raise exception 'commercial_plan_changes is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.reject_commercial_history_mutation() is
  'Refuses UPDATE and DELETE on commercial_plan_changes for every role including postgres and service_role. Privilege revocation alone would leave the trail rewritable by the roles that matter most.';

drop trigger if exists commercial_plan_changes_append_only on public.commercial_plan_changes;
create trigger commercial_plan_changes_append_only
  before update or delete on public.commercial_plan_changes
  for each row execute function public.reject_commercial_history_mutation();

-- ---------------------------------------------------------------------------
-- 4. Every organization gets commercial state, automatically
--
-- Modelled on the existing handle_new_organization() convention: the
-- organization row drives its own dependent row through an AFTER INSERT
-- trigger, rather than trusting a caller to make a second write that RLS could
-- not authorize anyway.
--
-- The default is `free`. That is the honest answer for an organization that has
-- just come into existence and has paid nothing, and it is also the SAFE
-- answer: free is the most restrictive plan in the catalogue, so a state row
-- that appears by accident grants the least.
--
-- ensure_organization_commercial_state() is separately callable because the
-- capacity triggers need a guaranteed row to lock. If a row is somehow missing
-- — a restore from a pre-R2 dump, a future code path that inserts an
-- organization in an unexpected way — the alternative to creating a free row on
-- demand is a hard failure on an operation the organization may well be
-- entitled to perform. Creating the most restrictive row is the fail-safe
-- direction: it can only ever deny more than the truth, never less.
-- ---------------------------------------------------------------------------

create or replace function private.ensure_organization_commercial_state(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_commercial_state (organization_id, plan_key, status, entitlement_source)
  values (p_organization_id, 'free', 'active', 'early_access')
  on conflict (organization_id) do nothing;
end;
$$;

comment on function private.ensure_organization_commercial_state(uuid) is
  'Idempotently gives an organization its default commercial state (free/active/early_access). Free is both the honest default for an organization that has paid nothing and the SAFE default, because it is the most restrictive plan in the catalogue — a row that appears by accident can only deny more than the truth, never less. Not reachable by any client: private schema, EXECUTE granted to no client role.';

revoke all on function private.ensure_organization_commercial_state(uuid) from public, anon, authenticated;

create or replace function public.handle_new_organization_commercial_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_organization_commercial_state(new.id);

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (new.id, null, 'free', null, 'active', 'early_access', null,
     'Automatic default state for a newly created organization.');

  return new;
end;
$$;

comment on function public.handle_new_organization_commercial_state() is
  'AFTER INSERT on organizations: gives the new organization its default free/active commercial state and opens its audit trail. A separate trigger from handle_new_organization() so the two concerns — who owns this shop, what has this shop paid for — stay independently reviewable and independently revertible.';

drop trigger if exists organizations_ensure_commercial_state on public.organizations;
create trigger organizations_ensure_commercial_state
  after insert on public.organizations
  for each row execute function public.handle_new_organization_commercial_state();

-- ---------------------------------------------------------------------------
-- 5. RLS and privileges
--
-- READ: members of the organization, and platform admins. An organization's own
-- staff seeing which plan they are on is the whole point of a pricing surface
-- that knows who is looking at it. A customer, or a member of a DIFFERENT
-- organization, sees nothing — commercial state is tenant-private.
--
-- WRITE: nobody. Not a narrow policy, not a role exemption — no INSERT, UPDATE
-- or DELETE policy exists on either table, and the table-level privileges are
-- revoked as well. The only writers are SECURITY DEFINER functions.
--
-- The audit table is narrower still: owner/manager rather than any member. A
-- receptionist or barber has no business reading the commercial decision
-- history of the shop they work in.
-- ---------------------------------------------------------------------------

alter table public.organization_commercial_state enable row level security;
alter table public.organization_commercial_state force row level security;
alter table public.commercial_plan_changes enable row level security;
alter table public.commercial_plan_changes force row level security;

revoke all on public.organization_commercial_state from anon, authenticated, prospect_worker;
revoke all on public.commercial_plan_changes from anon, authenticated, prospect_worker;

grant select on public.organization_commercial_state to authenticated;
grant select on public.commercial_plan_changes to authenticated;

drop policy if exists organization_commercial_state_select on public.organization_commercial_state;
create policy organization_commercial_state_select
  on public.organization_commercial_state
  for select
  to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.is_platform_admin())
  );

drop policy if exists commercial_plan_changes_select on public.commercial_plan_changes;
create policy commercial_plan_changes_select
  on public.commercial_plan_changes
  for select
  to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

do $$
begin
  raise notice 'R2 organization commercial state installed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110100_organization_commercial_state.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110200_commercial_state_backfill.sql
-- ============================================================================

-- FadeUp — R2: give every EXISTING organization commercial state, without
--               inventing a payment
--
-- THE PROBLEM
--
-- 20260826110100 gives every organization created FROM NOW ON a default
-- commercial state through an AFTER INSERT trigger. Organizations that already
-- exist have none, and an organization with no commercial state is an
-- organization every entitlement check must fail closed on — which would lock
-- the existing product out of itself.
--
-- WHAT THIS BACKFILL IS ALLOWED TO CLAIM, AND WHAT IT IS NOT
--
-- It is NOT allowed to claim that anyone paid. There is no billing integration
-- in this repository, so there is no evidence to record, so entitlement_source
-- is 'early_access' for every row this file writes, provider stays NULL, and
-- status is 'active' because the assigned plan genuinely is in force — not
-- because a charge succeeded.
--
-- 'early_access' is a true statement about the world, not a euphemism. FadeUp
-- has been telling visitors exactly this on /pricing: "Every organization gets
-- the same product today while FadeUp is in early access." Writing that down is
-- honest. Writing 'billing' would not be, and the CHECK constraint on
-- organization_commercial_state would refuse it anyway for lack of a provider.
--
-- THE DERIVATION, AND WHY IT IS THE CHEAPEST COVERING PLAN
--
-- The temptation is to look at a shop using the Pro workspace and record
-- salon_pro. That fabricates a TIER — it decides that this shop chose the EUR
-- 49 product when nobody ever asked them. So the rule is minimal instead:
--
--   assign the CHEAPEST plan whose capacity already covers the shape the
--   organization has today.
--
-- Nothing is granted that the organization is not already using. Nothing is
-- taken away that it is already using. No premium tier is invented. Concretely,
-- with L = active locations and P = active operational professionals:
--
--   L = 0 and P = 0   ->  free
--                         An organization that never finished onboarding starts
--                         exactly where a new one starts. Recording anything
--                         else would be granting a product to a shop that has
--                         not yet opened.
--   L <= 1 and P <= 1 ->  solo
--                         One professional, one place: that IS the Independent
--                         product, and it is cheaper than any salon plan.
--   L <= 1            ->  salon_essential
--                         One salon with a team. The CHEAPEST single-salon
--                         plan, deliberately — not salon_pro, however much the
--                         shop currently uses the live queue.
--   L <= 2            ->  multi_growth
--   L <= 5            ->  multi_pro
--   L <= 10           ->  multi_scale
--   L > 10            ->  multi_scale, with the overage recorded in
--                         assignment_note.
--
-- THE OVER-CAPACITY CASE IS NOT RESOLVED BY DELETING ANYTHING
--
-- An organization with eleven active locations exceeds every plan FadeUp sells.
-- The response is NOT to deactivate the eleventh, and NOT to invent an
-- unlimited plan. It is assigned multi_scale, the discrepancy is written into
-- assignment_note so it is discoverable rather than silent, and the capacity
-- trigger in 20260826110400 will refuse a TWELFTH. Existing data is preserved;
-- growth is what stops. That is the same non-destructive rule downgrades follow
-- in 20260826110600, applied to a state that predates the rule.
--
-- CONSEQUENCE AN OPERATOR SHOULD UNDERSTAND BEFORE APPLYING
--
--   A one-location, one-professional organization is backfilled to `solo`, and
--   solo covers exactly one professional. The next barber that organization
--   hires will be refused by the roster capacity trigger until the plan is
--   changed. That is the intended commercial behaviour, not a defect — and
--   public.assign_commercial_plan() is the supported, audited way to change it.
--
-- Idempotent: only writes where no row exists, so re-running is a no-op rather
-- than a second audit entry.

set lock_timeout = '5s';

do $$
declare
  v_backfilled integer := 0;
  v_free integer := 0;
  v_over_capacity integer := 0;
begin
  -- One statement, one pass. A cursor per organization would be easier to read
  -- and would also hold the transaction open across thousands of round trips
  -- for no benefit: the derivation is pure arithmetic over two counts.
  with shape as (
    select
      o.id as organization_id,
      (
        select count(*)
        from public.locations l
        where l.organization_id = o.id and l.is_active
      ) as active_locations,
      (
        select count(*)
        from public.barbers b
        join public.staff_profiles sp on sp.id = b.staff_profile_id
        where b.organization_id = o.id and sp.is_active
      ) as active_professionals
    from public.organizations o
    where not exists (
      select 1 from public.organization_commercial_state s
      where s.organization_id = o.id
    )
  ),
  derived as (
    select
      shape.*,
      case
        when active_locations = 0 and active_professionals = 0 then 'free'
        when active_locations <= 1 and active_professionals <= 1 then 'solo'
        when active_locations <= 1 then 'salon_essential'
        when active_locations <= 2 then 'multi_growth'
        when active_locations <= 5 then 'multi_pro'
        else 'multi_scale'
      end as plan_key
    from shape
  ),
  inserted as (
    insert into public.organization_commercial_state
      (organization_id, plan_key, status, entitlement_source,
       assigned_at, assigned_by, assignment_note)
    select
      d.organization_id,
      d.plan_key,
      'active',
      -- No payment is claimed anywhere in this file. See the header.
      'early_access',
      now(),
      null,
      case
        when d.active_locations > 10 then
          format(
            'R2 backfill: cheapest covering plan for %s active location(s) and %s active professional(s). '
            || 'OVER CAPACITY — this organization exceeds every plan FadeUp sells; existing locations are '
            || 'preserved untouched and further establishment creation will be refused until the plan is '
            || 'reviewed. No payment is asserted: entitlement_source is early_access.',
            d.active_locations, d.active_professionals)
        else
          format(
            'R2 backfill: cheapest plan whose capacity already covers %s active location(s) and %s active '
            || 'professional(s). No tier was inferred from usage and no payment is asserted: '
            || 'entitlement_source is early_access.',
            d.active_locations, d.active_professionals)
      end
    from derived d
    returning organization_id, plan_key
  ),
  logged as (
    insert into public.commercial_plan_changes
      (organization_id, previous_plan_key, new_plan_key,
       previous_status, new_status, entitlement_source, changed_by, change_reason)
    select
      i.organization_id, null, i.plan_key, null, 'active', 'early_access', null,
      'R2 backfill: organization predates the commercial model. Cheapest covering plan assigned; no payment asserted.'
    from inserted i
    returning 1
  )
  select
    (select count(*) from logged),
    (select count(*) from derived where plan_key = 'free'),
    (select count(*) from derived where active_locations > 10)
  into v_backfilled, v_free, v_over_capacity;

  raise notice 'R2 backfill: % organization(s) given commercial state (% on free, % over capacity)',
    v_backfilled, v_free, v_over_capacity;
end $$;

-- ---------------------------------------------------------------------------
-- Assert the backfill actually covered everything
--
-- A backfill that silently missed rows is worse than one that failed, because
-- the missed organizations only surface later as entitlement checks failing
-- closed on real traffic.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing integer;
  v_fabricated integer;
begin
  select count(*) into v_missing
  from public.organizations o
  where not exists (
    select 1 from public.organization_commercial_state s where s.organization_id = o.id
  );

  if v_missing > 0 then
    raise exception 'R2 backfill check failed: % organization(s) still have no commercial state', v_missing
      using errcode = 'P0001';
  end if;

  -- Nothing in this repository may claim a payment. If a row exists with
  -- entitlement_source = billing after R2 installs, something fabricated it.
  select count(*) into v_fabricated
  from public.organization_commercial_state
  where entitlement_source = 'billing';

  if v_fabricated > 0 then
    raise exception 'R2 backfill check failed: % organization(s) claim billing as their entitlement source, but no billing provider exists in this repository', v_fabricated
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_bad integer;
begin
  -- Every backfilled organization's plan must actually cover the shape it has.
  -- If the derivation above is ever edited into something that under-grants,
  -- this catches it here rather than at the first refused location insert.
  select count(*) into v_bad
  from public.organization_commercial_state s
  join public.commercial_plans p on p.plan_key = s.plan_key
  join public.organizations o on o.id = s.organization_id
  where (
    select count(*) from public.locations l
    where l.organization_id = o.id and l.is_active
  ) > p.max_establishments
  -- The documented, deliberate exception: an organization that already exceeded
  -- every plan FadeUp sells. It keeps every location it has; only growth stops.
  and p.plan_key <> 'multi_scale';

  if v_bad > 0 then
    raise exception 'R2 backfill check failed: % organization(s) were assigned a plan that does not cover their existing locations', v_bad
      using errcode = 'P0001';
  end if;
end $$;


-- ============================================================================
-- END db/migrations/20260826110200_commercial_state_backfill.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110300_entitlement_resolution.sql
-- ============================================================================

-- FadeUp — R2: resolving what an organization may actually do
--
-- ONE RESOLVER, CONSULTED BY EVERYTHING
--
-- The failure mode R2 exists to prevent is `plan === 'pro'` appearing in a
-- dozen places, each subtly different, none of them authoritative. So every
-- entitlement question in FadeUp goes through the functions in this file, and
-- the chain they implement is:
--
--     authenticated actor
--          v   private.is_org_member / has_org_role / is_platform_admin
--     membership or ownership
--          v
--     organization
--          v   organization_commercial_state (exactly one row)
--     commercial plan + status
--          v   effective plan (status is applied here, once)
--     plan_capabilities
--          v
--     allow / deny, with a reason
--
-- The actor is resolved from auth.uid() and NEVER from an argument. The
-- organization id IS an argument — it has to be, the caller is asking about
-- something — but it is treated as a QUESTION, not as a credential: every
-- entry point re-derives the caller's relationship to it before answering.
-- Passing someone else's organization id gets the same 42501 whether that
-- organization exists or not, so these functions cannot be used to enumerate
-- tenants.
--
-- WHY `planned` CAPABILITIES RESOLVE TO FALSE FOR EVERYONE
--
-- org_has_capability() answers "may this organization USE this", and the honest
-- answer for a capability FadeUp has not built is no — for every plan, at every
-- price. Packaging is recorded (plan_capabilities still contains the row, and
-- the pricing surface still says "on the roadmap"), but a gate that opened for
-- salon_business on `retentionAutomation` would be opening onto nothing. This
-- is the same discipline apps/web/src/lib/commerce/plans.ts already enforces
-- with liveCapabilities(), moved to where it can be trusted.
--
-- STATUS IS APPLIED ONCE, IN effective_plan_key()
--
--   active    -> the assigned plan
--   past_due  -> the assigned plan. A failed payment is a conversation, not a
--                shutdown; access is preserved while it is resolved, and no
--                data is touched either way.
--   canceled  -> free. The organization keeps its identity, its establishments,
--                its customers, its professionals and its history — it drops to
--                network presence. Capacity CAPS then apply going forward, so a
--                cancelled five-location group keeps all five and can create no
--                sixth. Nothing is deleted, ever, by anything in R2.
--
-- Doing this in one function rather than in each caller is the difference
-- between one rule and five drifting interpretations of it.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.effective_plan_key — the plan actually in force
--
-- SECURITY DEFINER because it reads organization_commercial_state, which every
-- client role has had its privileges revoked on. It performs NO authorization
-- of its own and must not be treated as an entry point: it lives in `private`
-- (not exposed through PostgREST, per 20260809100800), EXECUTE is granted to no
-- client role, and every public caller in this file checks membership first.
-- ---------------------------------------------------------------------------

create or replace function private.effective_plan_key(p_organization_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when s.status = 'canceled' then 'free'
    else s.plan_key
  end
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id;
$$;

comment on function private.effective_plan_key(uuid) is
  'The plan actually in force for an organization, with commercial status applied exactly once: canceled degrades to free (network presence, nothing deleted), past_due keeps the assigned plan because a failed payment is a conversation rather than a shutdown. Returns NULL when the organization has no commercial state, which every caller treats as deny. Performs no authorization: private schema, no client EXECUTE, and every public caller checks membership first.';

revoke all on function private.effective_plan_key(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.org_has_capability — the one question everything else asks
--
-- Fails closed on every unknown: no organization, no commercial state, an
-- unrecognised plan, an unrecognised capability, a NULL argument. `not exists`
-- would be the natural way to write half of these and would fail OPEN on a
-- typo'd capability name, which is precisely the mistake that makes a gate
-- decorative. Written as an explicit positive match instead.
-- ---------------------------------------------------------------------------

create or replace function private.org_has_capability(p_organization_id uuid, p_capability text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_commercial_state s
    join public.plan_capabilities pc
      on pc.plan_key = private.effective_plan_key(s.organization_id)
    join public.commercial_capabilities c
      on c.capability_key = pc.capability_key
    where s.organization_id = p_organization_id
      and p_organization_id is not null
      and pc.capability_key = p_capability
      -- A capability FadeUp has not built cannot be granted by any plan at any
      -- price. Packaging is still recorded; access is not.
      and c.status = 'live'
  );
$$;

comment on function private.org_has_capability(uuid, text) is
  'THE entitlement question. True only when the organization has commercial state, its effective plan packages the capability, and the capability is actually built (status = live). Fails closed on every unknown — missing state, unknown plan, unknown capability, NULL argument — because a gate that fails open on a typo is decorative. Performs no authorization of its own: callers must already have established the actor''s relationship to the organization.';

revoke all on function private.org_has_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.assert_org_capability — the same question, as a guard
--
-- Raises 42501 with a message naming the capability and the plan in force, so a
-- refused request tells the professional WHY rather than dying as a generic
-- permission error. The organization id is deliberately absent from the
-- message: callers of this function have already established the actor's
-- relationship to it, but an error string tends to end up in a log a wider
-- audience reads.
-- ---------------------------------------------------------------------------

create or replace function private.assert_org_capability(p_organization_id uuid, p_capability text)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_plan text;
begin
  if private.org_has_capability(p_organization_id, p_capability) then
    return;
  end if;

  v_plan := private.effective_plan_key(p_organization_id);

  raise exception 'the % capability is not available on the % plan',
    p_capability, coalesce(v_plan, 'unknown')
    using errcode = '42501',
          hint = 'Change the organization plan through public.assign_commercial_plan(); a client cannot grant itself a capability.';
end;
$$;

comment on function private.assert_org_capability(uuid, text) is
  'org_has_capability() as a guard: returns quietly or raises 42501 naming the capability and the plan in force, so a refusal explains itself instead of surfacing as a generic permission error. Deliberately omits the organization id from the message — error strings travel further than the caller does.';

revoke all on function private.assert_org_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.org_* usage counts — what capacity is measured against
--
-- Defined ONCE so the capacity triggers, the plan-change guard and the read
-- RPC cannot disagree about what "an establishment" or "a professional" means.
-- Three surfaces counting the same thing three ways is how a limit becomes
-- enforceable in one place and bypassable in another.
--
--   establishment   an ACTIVE location. An organization that has deactivated a
--                   location is not operating it, so it does not consume
--                   capacity — and R1A's rule that removal is deactivation
--                   rather than deletion means this is the only count that
--                   reflects reality.
--   operational     a barbers row whose staff_profiles row is active.
--   professional    offboard_barber() sets is_active = false and never deletes,
--                   so a shop that has had thirty barbers over five years
--                   counts the ones working there now. Deliberately NOT
--                   count(barbers): that would make a long-lived shop
--                   permanently over capacity for people who left, and would
--                   turn R1A's durable history into a liability.
-- ---------------------------------------------------------------------------

create or replace function private.org_active_establishments(p_organization_id uuid)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.locations l
  where l.organization_id = p_organization_id
    and l.is_active;
$$;

comment on function private.org_active_establishments(uuid) is
  'Establishments an organization is currently OPERATING: active locations. A deactivated location consumes no capacity, which is the only reading consistent with R1A making removal a deactivation rather than a deletion.';

create or replace function private.org_active_professionals(p_organization_id uuid)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.organization_id = p_organization_id
    and sp.is_active;
$$;

comment on function private.org_active_professionals(uuid) is
  'Operational professionals an organization currently rosters: barbers rows whose staff_profile is active. Deliberately NOT count(barbers) — offboard_barber() deactivates and never deletes, so counting every row ever created would make a long-lived shop permanently over capacity for people who left.';

revoke all on function private.org_active_establishments(uuid) from public, anon, authenticated;
revoke all on function private.org_active_professionals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.get_organization_entitlements — the read surface
--
-- The single thing the application calls to know what to show, hide, disable
-- and explain. It returns the SAME truth the triggers enforce, which is the
-- point: a UI built on a second, parallel idea of the plan is a UI that will
-- eventually offer a button the database refuses.
--
-- AUTHORIZATION. The caller must be a member of the organization, or a platform
-- admin. Anything else raises 42501 — and it raises the IDENTICAL error whether
-- the organization exists, belongs to someone else, or was never created, so
-- the function cannot be used to test whether a tenant exists.
--
-- Returns exactly one row. Capabilities come back as two arrays rather than as
-- rows because the caller always wants the whole set:
--
--   live_capabilities      what this organization may actually use today. This
--                          is what a gate should consult.
--   packaged_capabilities  everything the plan includes, built or not. This is
--                          what a plan comparison should render, with the
--                          unbuilt ones marked — never counted as included.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_entitlements(p_organization_id uuid)
returns table (
  organization_id uuid,
  plan_key text,
  commercial_family public.commercial_family,
  display_name text,
  price_minor integer,
  price_currency text,
  status public.commercial_status,
  entitlement_source public.entitlement_source,
  -- May differ from plan_key: a canceled subscription resolves to free without
  -- rewriting what the organization is on, so the history stays legible.
  effective_plan_key text,
  max_establishments integer,
  used_establishments integer,
  max_operational_professionals integer,
  used_operational_professionals integer,
  live_capabilities text[],
  packaged_capabilities text[]
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_effective text;
begin
  if (select auth.uid()) is null then
    raise exception 'resolving entitlements requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Identical refusal for "not yours", "not a member" and "does not exist".
  -- Splitting them would be friendlier and would also answer "does this
  -- organization exist" for anyone willing to guess uuids.
  if p_organization_id is null
     or not (
       (select private.is_org_member(p_organization_id))
       or (select private.is_platform_admin())
     ) then
    raise exception 'not authorized to read the commercial state of this organization'
      using errcode = '42501';
  end if;

  v_effective := private.effective_plan_key(p_organization_id);

  if v_effective is null then
    -- An organization the caller genuinely belongs to but which has no
    -- commercial state is a data defect, not an authorization question. Say so
    -- plainly rather than returning zero rows the UI would render as "loading
    -- forever".
    raise exception 'organization has no commercial state — R2 backfill did not cover it'
      using errcode = 'P0001';
  end if;

  return query
  select
    s.organization_id,
    s.plan_key,
    p.commercial_family,
    p.display_name,
    p.price_minor,
    p.price_currency,
    s.status,
    s.entitlement_source,
    v_effective,
    -- Capacity always comes from the EFFECTIVE plan, never the assigned one.
    ep.max_establishments,
    private.org_active_establishments(s.organization_id),
    ep.max_operational_professionals,
    private.org_active_professionals(s.organization_id),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      join public.commercial_capabilities c on c.capability_key = pc.capability_key
      where pc.plan_key = v_effective and c.status = 'live'
    ), array[]::text[]),
    coalesce((
      select array_agg(pc.capability_key order by pc.capability_key)
      from public.plan_capabilities pc
      where pc.plan_key = v_effective
    ), array[]::text[])
  from public.organization_commercial_state s
  join public.commercial_plans p on p.plan_key = s.plan_key
  join public.commercial_plans ep on ep.plan_key = v_effective
  where s.organization_id = p_organization_id;
end;
$$;

comment on function public.get_organization_entitlements(uuid) is
  'The authoritative entitlement snapshot for ONE organization the caller belongs to (or any organization, for a platform admin). The organization id is a question, never a credential: membership is re-derived from auth.uid() before anything is returned, and a caller who is not a member gets the IDENTICAL 42501 whether the organization exists or not, so this cannot enumerate tenants. Capacity is reported from the EFFECTIVE plan, so a canceled subscription shows free capacity while the assigned plan remains visible in plan_key.';

revoke execute on function public.get_organization_entitlements(uuid) from public, anon;
grant execute on function public.get_organization_entitlements(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.my_organization_has_capability — the narrow question, safely asked
--
-- A convenience for the application, and deliberately narrower than the
-- resolver: it answers one boolean about one organization the caller belongs
-- to. It returns FALSE rather than raising for an organization the caller has
-- no relationship with — a boolean gate that throws makes every call site write
-- error handling for a case that means "no", and false IS the correct answer to
-- "may I use this here" when the answer to "am I here at all" is no.
--
-- That is not an oracle: false is also the answer for an organization that does
-- not exist, for one the caller does belong to but whose plan lacks the
-- capability, and for a capability nobody has. All four cases are
-- indistinguishable.
-- ---------------------------------------------------------------------------

create or replace function public.my_organization_has_capability(
  p_organization_id uuid,
  p_capability text
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_organization_id is not null
    and (
      (select private.is_org_member(p_organization_id))
      or (select private.is_platform_admin())
    )
    and private.org_has_capability(p_organization_id, p_capability);
$$;

comment on function public.my_organization_has_capability(uuid, text) is
  'One boolean about one organization the caller belongs to. Returns false — never raises — for a non-member, a non-existent organization, a plan without the capability, and a capability that does not exist, so all four are indistinguishable and it leaks nothing. Frontend gating is UX: this exists so the UI can show, hide, disable and EXPLAIN consistently with what the database will actually allow, not so it can be the thing that allows it.';

revoke execute on function public.my_organization_has_capability(uuid, text) from public, anon;
grant execute on function public.my_organization_has_capability(uuid, text) to authenticated;

do $$
begin
  raise notice 'R2 entitlement resolution installed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110300_entitlement_resolution.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110400_establishment_capacity_enforcement.sql
-- ============================================================================

-- FadeUp — R2: the establishment cap, enforced where a browser cannot reach
--
-- WHAT WAS ACTUALLY POSSIBLE BEFORE THIS FILE
--
-- public.locations has an INSERT policy granting any owner or manager the right
-- to create a location (20260809100900_tenant_rls_policies.sql). Locations are
-- created by a DIRECT PostgREST insert — there is no RPC in the path. So a
-- single-salon shop could open a browser console and create its eleventh
-- address, and the only thing that would have stopped it was a number rendered
-- on a pricing page.
--
-- A commercial limit that lives in the UI is not a limit. This trigger is.
--
-- WHY A TRIGGER RATHER THAN AN RLS `with check`
--
--   * RLS is bypassed by service_role and by postgres, both of which hold
--     BYPASSRLS in this stack. A cap expressed as a policy would hold for the
--     browser and evaporate for every server-side path, which is the wrong way
--     round for a COMMERCIAL rule.
--   * A `with check` cannot take a lock, so it cannot be made race-free.
--   * A trigger fires for every writer — PostgREST, an RPC, a background job,
--     psql — which is what "the database enforces it" has to mean.
--
-- THE RACE, AND HOW IT IS CLOSED
--
-- Two managers of a multi_growth organization (cap 2, one location existing)
-- both press "add location" at the same instant. Both transactions count 1,
-- both conclude 1 + 1 <= 2, both insert, and the organization has three
-- locations on a two-location plan. Counting is not enough; the count has to be
-- serialised.
--
-- The mutex is the organization's commercial-state row, which 20260826110100
-- made exactly-one-per-organization by using organization_id as the primary
-- key. Each transaction takes `SELECT ... FOR UPDATE` on it BEFORE counting.
-- The second blocks until the first commits or rolls back, and only then takes
-- its count — under READ COMMITTED that is a fresh statement, so it sees a
-- committed sibling insert. There is no window in which two writers hold the
-- same stale count.
--
-- Locking a row the organization already owns, rather than an advisory lock
-- keyed on a hashed uuid, means the lock is visible in pg_locks as what it is
-- and is released by ordinary transaction end. Advisory locks would also work
-- and are harder to reason about when something goes wrong at 2am.
--
-- WHAT COUNTS, AND WHAT DELIBERATELY DOES NOT
--
--   counts      an ACTIVE location
--   ignores     an inactive location. A shop that closed an address is not
--               operating it. This also means DEACTIVATING a location frees
--               capacity, which is the correct and non-destructive way for an
--               over-capacity organization to come back into compliance —
--               nothing is deleted to satisfy a plan.
--
-- Reactivating an inactive location is therefore also a capacity event, and is
-- checked here too. Without that, "deactivate, downgrade, reactivate" would be
-- a three-step bypass.
--
-- OPERATOR NOTE
--
-- This trigger fires for postgres and service_role as well; there is no session
-- override GUC and no role exemption, deliberately. A restore that must exceed
-- current capacity is a `pg_restore --disable-triggers` (explicit and loud) or a
-- plan change through public.assign_commercial_plan() (audited). Both are better
-- than a magic setting that a future RPC might learn to set.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function public.enforce_establishment_capacity()
returns trigger
language plpgsql
-- SECURITY DEFINER because organization_commercial_state has every client
-- privilege revoked and FORCE RLS enabled; the definer (postgres, BYPASSRLS)
-- can read and lock it while the calling manager cannot read it directly at
-- all. search_path is pinned and every name is schema-qualified, so a caller
-- cannot substitute their own commercial_plans table.
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  -- An inactive location consumes no capacity, so creating one is always
  -- allowed. It also cannot be a bypass: switching it on later comes back
  -- through this same trigger on UPDATE.
  if not new.is_active then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only two kinds of UPDATE are capacity events: switching a location back
    -- on, and moving it to a different organization (which no code path does,
    -- but an unchecked one would be a way to smuggle capacity between tenants).
    if old.is_active and new.organization_id = old.organization_id then
      return new;
    end if;
  end if;

  -- Guarantee the row that is about to be locked exists. In every normal path
  -- it already does — organizations get commercial state on insert and the R2
  -- backfill covered the rest — so this is the safety net for a restore or a
  -- future code path, and it creates the most restrictive plan, never a
  -- permissive one.
  perform private.ensure_organization_commercial_state(new.organization_id);

  -- THE MUTEX. Everything after this line is serialised per organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = new.organization_id
  for update;

  v_plan := private.effective_plan_key(new.organization_id);

  select p.max_establishments into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  if v_max is null then
    -- No commercial state, or a plan that is not in the catalogue. Fail closed:
    -- an unresolvable plan must never be read as "unlimited".
    raise exception 'cannot create an establishment: the organization has no resolvable commercial plan'
      using errcode = 'P0001',
            hint = 'Every organization must have a row in organization_commercial_state naming a plan that exists in commercial_plans.';
  end if;

  -- The row being inserted (or reactivated) is not yet part of this count: on
  -- INSERT it does not exist, and on the reactivation path it is still
  -- is_active = false in the table. So the question is always "does one more
  -- fit".
  v_used := private.org_active_establishments(new.organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % active establishment(s); this organization already operates %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Multi-salons plan to operate more establishments. Existing establishments are never removed to satisfy a plan.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_establishment_capacity() is
  'Enforces the plan establishment cap on public.locations for EVERY writer — PostgREST, RPCs, service_role and postgres alike — because a commercial limit that only holds for the browser is not a limit. Race-free: it takes SELECT ... FOR UPDATE on the organization''s single commercial-state row before counting, so two concurrent "add location" requests cannot both pass on the same stale count. Only ACTIVE locations count, so deactivating one frees capacity — that is the non-destructive route back into compliance, and it is why reactivation is checked here too.';

drop trigger if exists locations_enforce_establishment_capacity on public.locations;
create trigger locations_enforce_establishment_capacity
  before insert or update of is_active, organization_id on public.locations
  for each row execute function public.enforce_establishment_capacity();

-- ---------------------------------------------------------------------------
-- Prove the trigger is actually attached
--
-- A migration that creates a function and fails to attach it produces a
-- database that looks enforced and is not. Cheap to check, and the failure mode
-- it prevents is silent.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'locations_enforce_establishment_capacity'
      and tgrelid = 'public.locations'::regclass
      and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the establishment capacity trigger is not attached to public.locations'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_establishment_capacity'
      and p.prosecdef
      and exists (
        -- Postgres stores `set search_path = ''` as the literal
        -- search_path="" — quotes included — so the match is a prefix, not an
        -- equality. Checked against pg_proc on the live stack rather than
        -- assumed.
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception 'R2 capacity check failed: enforce_establishment_capacity must be SECURITY DEFINER with a pinned search_path'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 establishment capacity enforcement installed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110400_establishment_capacity_enforcement.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110500_operational_professional_capacity.sql
-- ============================================================================

-- FadeUp — R2: Solo covers ONE professional, and the database says so
--
-- THE INVARIANT
--
--   Solo (EUR 19) is one independent professional operating alone. It is not a
--   cheap salon plan, and Constitution 1.0 already required that the cap be
--   "a real constraint the model must be able to express and enforce" rather
--   than a sentence on a pricing page. This file is that enforcement.
--
--   Free (EUR 0) carries the same cap for the same reason: if a free
--   organization could roster five barbers, the free tier would quietly be the
--   product and every paid plan would be optional.
--
--   Every salon and multi-salon plan carries max_operational_professionals =
--   NULL, which this trigger reads as UNLIMITED. That is what "team is
--   included" means operationally: adding a barber to a salon_essential shop is
--   free, adding the tenth is free, and there is no quantity anywhere in this
--   schema for a price to be multiplied by.
--
-- WHAT AN "OPERATIONAL PROFESSIONAL" IS, AND WHY IT IS NOT A `professionals` ROW
--
-- This is the distinction R1B spent an entire lot establishing, and R2 must not
-- collapse it:
--
--   public.professionals            DURABLE IDENTITY. Shop-independent, outlives
--                                   employment, carries the follow graph and the
--                                   public profile. NEVER counted here, never
--                                   deleted here, never touched by a commercial
--                                   state change.
--   public.barbers                  A ROSTER PLACEMENT: this identity works at
--                                   this organization. THIS is what a plan
--                                   covers, and this is what is counted.
--
-- So a professional who leaves a Solo business keeps their identity, their
-- followers, their verified-client relationships and their appointment history;
-- the business simply no longer rosters them. A downgrade removes no identity,
-- and this trigger deletes nothing under any circumstances.
--
-- ACTIVE, NOT EVER-EXISTED
--
-- R1A made offboarding a deactivation rather than a deletion: offboard_barber()
-- sets staff_profiles.is_active = false and leaves the row. Counting every
-- barbers row would therefore make a shop permanently over capacity for people
-- who left years ago, and would turn R1A's durable history into a punishment.
-- The count is barbers joined to an ACTIVE staff_profile.
--
-- That has a deliberate consequence: reactivating a staff profile that backs a
-- roster row IS a capacity event, and is checked here. Otherwise "offboard,
-- downgrade to Solo, re-onboard" would be a three-step bypass.
--
-- THE RACE
--
-- Two managers invite the second barber into a Solo organization at the same
-- instant. Both count 1, both conclude one more fits, and one of them must
-- lose. Identical shape to the establishment race, and closed identically: take
-- `SELECT ... FOR UPDATE` on the organization's single commercial-state row
-- before counting, so the second transaction blocks and then re-counts against
-- committed data.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The shared check
--
-- One function, two triggers. The alternative — duplicating the count and the
-- lock into a barbers trigger and a staff_profiles trigger — is how two
-- enforcement points end up disagreeing after someone fixes a bug in one.
-- ---------------------------------------------------------------------------

create or replace function private.assert_professional_capacity(p_organization_id uuid)
returns void
language plpgsql
-- SECURITY DEFINER for the same reason as the establishment trigger:
-- organization_commercial_state has every client privilege revoked and FORCE
-- RLS enabled, so only the definer can read and lock it.
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_max integer;
  v_used integer;
begin
  perform private.ensure_organization_commercial_state(p_organization_id);

  -- THE MUTEX — the same row the establishment cap locks, so the two caps can
  -- never interleave into an inconsistent view of the same organization.
  perform 1
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  v_plan := private.effective_plan_key(p_organization_id);

  if v_plan is null then
    raise exception 'cannot roster a professional: the organization has no resolvable commercial plan'
      using errcode = 'P0001';
  end if;

  select p.max_operational_professionals into v_max
  from public.commercial_plans p
  where p.plan_key = v_plan;

  -- NULL is UNLIMITED, and it is reached only through a plan that genuinely
  -- exists — v_plan was resolved above and an unknown plan already raised. So
  -- this NULL means "team is included", never "we could not work it out".
  if v_max is null then
    return;
  end if;

  v_used := private.org_active_professionals(p_organization_id);

  if v_used + 1 > v_max then
    raise exception
      'the % plan covers % operational professional(s); this organization already rosters %',
      v_plan, v_max, v_used
      using errcode = 'P0001',
            hint = 'Move to a Salon or Multi-salons plan to roster a team. No professional identity, appointment history or relationship is removed by this refusal.';
  end if;
end;
$$;

comment on function private.assert_professional_capacity(uuid) is
  'Refuses to let an organization roster one more ACTIVE operational professional than its plan covers. NULL max means unlimited, which is how "team is included" is spelled — every salon and multi-salon plan reaches that branch. Race-free through SELECT ... FOR UPDATE on the same commercial-state row the establishment cap locks. Counts roster placements (barbers with an active staff_profile), never public.professionals: a durable professional identity is not a commercial object and is never counted, restricted or deleted by anything in R2.';

revoke all on function private.assert_professional_capacity(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Adding someone to a roster
--
-- BEFORE INSERT on barbers. The row does not exist yet, so the count is the
-- current one and the question is "does one more fit".
--
-- An UPDATE that moves a roster placement between organizations is also a
-- capacity event. No code path does this today; leaving it unchecked would
-- create one.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_barber_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if tg_op = 'UPDATE' and new.organization_id = old.organization_id then
    return new;
  end if;

  -- A roster placement whose staff profile is inactive is not operational and
  -- consumes nothing. Reactivating that profile comes back through the
  -- staff_profiles trigger below.
  select sp.is_active into v_active
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id;

  if coalesce(v_active, false) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;

comment on function public.enforce_barber_capacity() is
  'Applies the plan professional cap when a professional is added to a roster, or moved between organizations. Fires for every writer including service_role and postgres — an invitation flow, an onboarding RPC and a raw INSERT are all the same commercial event.';

drop trigger if exists barbers_enforce_professional_capacity on public.barbers;
create trigger barbers_enforce_professional_capacity
  before insert or update of organization_id, staff_profile_id on public.barbers
  for each row execute function public.enforce_barber_capacity();

-- ---------------------------------------------------------------------------
-- 3. Bringing someone back
--
-- BEFORE UPDATE on staff_profiles, on the false -> true transition only, and
-- only when the profile actually backs a roster placement. Without this,
-- offboard -> downgrade -> re-onboard walks straight past the cap.
--
-- The profile is still is_active = false in the table at BEFORE UPDATE time, so
-- it is excluded from the count and the "+1" in assert_professional_capacity is
-- correct rather than off by one.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_staff_reactivation_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active or not new.is_active then
    return new;
  end if;

  if exists (select 1 from public.barbers b where b.staff_profile_id = new.id) then
    perform private.assert_professional_capacity(new.organization_id);
  end if;

  return new;
end;
$$;

comment on function public.enforce_staff_reactivation_capacity() is
  'Closes the offboard -> downgrade -> re-onboard bypass. Reactivating a staff profile that backs a roster placement is the same commercial event as adding a professional, so it takes the same lock and the same cap. Only the false -> true transition is a capacity event; every other staff_profiles update passes through untouched.';

drop trigger if exists staff_profiles_enforce_professional_capacity on public.staff_profiles;
create trigger staff_profiles_enforce_professional_capacity
  before update of is_active on public.staff_profiles
  for each row execute function public.enforce_staff_reactivation_capacity();

-- ---------------------------------------------------------------------------
-- 4. Prove both triggers are attached, and that R1B is untouched
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'barbers_enforce_professional_capacity'
      and tgrelid = 'public.barbers'::regclass and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the professional capacity trigger is not attached to public.barbers'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'staff_profiles_enforce_professional_capacity'
      and tgrelid = 'public.staff_profiles'::regclass and not tgisinternal
  ) then
    raise exception 'R2 capacity check failed: the reactivation capacity trigger is not attached to public.staff_profiles'
      using errcode = 'P0001';
  end if;

  -- R1B's identity trigger must still be the thing that mints a professional
  -- when a roster row appears. R2 adds a cap in front of it and must not have
  -- replaced it: if this is missing, R2 has broken durable identity while
  -- enforcing a price.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.barbers'::regclass and not tgisinternal
      and tgname = 'barbers_assign_professional'
  ) then
    raise exception 'R2 capacity check failed: R1B''s barbers_assign_professional trigger is missing — R2 must add a cap in front of identity, never replace it'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 operational professional capacity enforcement installed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110500_operational_professional_capacity.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110600_plan_assignment_controls.sql
-- ============================================================================

-- FadeUp — R2: who may change a plan, and what a downgrade is allowed to do
--
-- THE TWO THINGS THIS FILE GUARANTEES
--
--   1. A CLIENT CANNOT GRANT ITSELF A PLAN.
--      Not a customer, not a barber, not a receptionist, not a manager, not an
--      owner. The only caller who can is a platform admin, through one audited
--      RPC. Everything else has no privilege on the table to begin with, so
--      "PATCH plan_key = multi_scale" is not a request that gets refused — it
--      is a request that has no statement to make.
--
--   2. A DOWNGRADE NEVER DELETES ANYTHING.
--      Moving from multi_scale (10) to multi_growth (2) with eight
--      establishments does not deactivate six of them, does not archive them,
--      does not hide them. It FAILS, and it says why. Data an organization
--      created is theirs; a plan is a statement about capacity going forward,
--      not a licence to destroy history retroactively.
--
--      The organization's own route down is to deactivate what it no longer
--      operates FIRST, deliberately, and then change plan. That keeps the
--      decision with the people whose business it is.
--
-- ENFORCED TWICE, ON PURPOSE
--
-- The RPC checks capacity and produces a good error message. A BEFORE UPDATE
-- trigger checks it again for every writer, including postgres and
-- service_role, so a well-meaning operator running raw SQL at 2am cannot
-- silently put an organization on a plan that does not cover it. The RPC is the
-- ergonomics; the trigger is the guarantee.
--
-- WHY CANCELLING IS NOT A DOWNGRADE
--
-- status = canceled resolves to free capacity, which a five-location group
-- obviously exceeds — so if cancellation were treated as a downgrade, an
-- organization that stopped paying could never be cancelled. That is backwards.
-- Cancellation is always permitted, changes no data, and simply stops growth:
-- the five locations remain, and a sixth is refused. The capacity rule applies
-- to a change of PLAN, which is a commercial choice, and not to a change of
-- STATUS, which is usually a consequence.
--
-- WHAT entitlement_source RECORDS HERE
--
-- 'platform_grant', always. A human at FadeUp decided this. That is an honest
-- description of what actually happened and is deliberately NOT 'billing':
-- there is no billing provider in this repository, and a plan that appeared
-- because staff granted it must never be mistaken later for a plan somebody
-- paid for. When billing exists, it gets its own writer and its own source
-- value, and this RPC keeps meaning exactly what it means today.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The integrity trigger — the guarantee
--
-- Fires on UPDATE only. INSERT is deliberately exempt: the R2 backfill assigns
-- multi_scale to an organization that already exceeded every plan FadeUp sells,
-- and that documented over-capacity state must be recordable. What must never
-- happen afterwards is someone REDUCING capacity below what is in use.
--
-- The rule, stated precisely:
--
--   a change of plan_key is refused when the new plan's capacity is below
--   current usage AND the new capacity is lower than the old one.
--
-- The second clause is what lets an already-over-capacity organization move
-- sideways or upward. Without it, the backfilled eleven-location organization
-- would be frozen on multi_scale forever, unable even to be moved to a plan
-- that helps it, which would be a rule punishing the wrong party.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_commercial_state_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_max_est integer;
  v_old_max_est integer;
  v_new_max_pro integer;
  v_old_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
begin
  -- A status change, a note, a provider reference: none of these are capacity
  -- events. Only a change of plan is.
  if new.plan_key = old.plan_key then
    return new;
  end if;

  select p.max_establishments, p.max_operational_professionals
    into v_new_max_est, v_new_max_pro
  from public.commercial_plans p where p.plan_key = new.plan_key;

  select p.max_establishments, p.max_operational_professionals
    into v_old_max_est, v_old_max_pro
  from public.commercial_plans p where p.plan_key = old.plan_key;

  if v_new_max_est is null then
    raise exception 'unknown plan %', new.plan_key using errcode = 'P0001';
  end if;

  v_used_est := private.org_active_establishments(new.organization_id);
  v_used_pro := private.org_active_professionals(new.organization_id);

  -- Establishments. `v_new_max_est < v_old_max_est` is the "this is a
  -- downgrade" test; an upgrade or a sideways move is never blocked, even for
  -- an organization that is already over capacity.
  if v_used_est > v_new_max_est and v_new_max_est < v_old_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %',
      new.plan_key, v_new_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp never deletes or deactivates an establishment to satisfy a plan change.';
  end if;

  -- Professionals. NULL on either side means unlimited, so a move TO unlimited
  -- is never a downgrade and a move FROM unlimited to a number is always one.
  if v_new_max_pro is not null
     and v_used_pro > v_new_max_pro
     and (v_old_max_pro is null or v_new_max_pro < v_old_max_pro) then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %',
      new.plan_key, v_new_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Offboarding preserves their identity, their followers and their appointment history — FadeUp never deletes a professional to satisfy a plan change.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_commercial_state_integrity() is
  'Refuses a plan change that would leave an organization over capacity, for EVERY writer including postgres and service_role — so a downgrade can never quietly imply that data should be removed to fit. Only a change of plan_key is a capacity event: a status change (including cancellation) is always permitted, because an organization that stopped paying must remain cancellable and cancelling deletes nothing. INSERT is exempt so the documented over-capacity backfill state stays recordable, and an already-over-capacity organization can still be moved to a better plan.';

drop trigger if exists organization_commercial_state_integrity on public.organization_commercial_state;
create trigger organization_commercial_state_integrity
  before update on public.organization_commercial_state
  for each row execute function public.enforce_commercial_state_integrity();

-- ---------------------------------------------------------------------------
-- 2. public.assign_commercial_plan — the one legitimate way in
--
-- PLATFORM ADMIN ONLY. Until billing exists, somebody has to be able to put an
-- organization on the plan it agreed to, and development and testing need the
-- same door. Making that door explicit, narrow and audited is strictly better
-- than the alternative everyone reaches for otherwise, which is loosening the
-- table privileges "just for now".
--
-- Note what is NOT a parameter: entitlement_source, provider, or anything else
-- that could be used to dress a staff decision up as a payment. The source is
-- hard-coded to platform_grant.
-- ---------------------------------------------------------------------------

create or replace function public.assign_commercial_plan(
  p_organization_id uuid,
  p_plan_key text,
  p_status public.commercial_status default 'active',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old_plan text;
  v_old_status public.commercial_status;
  v_max_est integer;
  v_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
  v_change_id uuid;
begin
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'changing a commercial plan requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The whole authorization decision, in one line, resolved from the session
  -- and never from an argument. An owner of the organization is NOT sufficient:
  -- the organization is the party being charged, and a party cannot decide what
  -- it owes.
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff may change an organization commercial plan'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- Unknown plan fails closed and says so, rather than being coerced into
  -- something plausible. is_available is checked too: a withdrawn plan may be
  -- kept for the organizations already on it, and must not be newly assignable.
  select p.max_establishments, p.max_operational_professionals
    into v_max_est, v_max_pro
  from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available;

  if v_max_est is null then
    raise exception 'unknown or unavailable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023',
            hint = 'Plan keys are free, solo, salon_essential, salon_pro, salon_business, multi_growth, multi_pro, multi_scale.';
  end if;

  perform private.ensure_organization_commercial_state(p_organization_id);

  -- Serialise against concurrent assignment AND against concurrent location or
  -- roster creation: this is the same row those triggers lock, so "downgrade
  -- while another location is being created" cannot interleave into a state
  -- where both succeeded.
  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan is null then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    raise exception 'organization is already on % with status %', p_plan_key, p_status
      using errcode = 'P0001';
  end if;

  -- Counted AFTER the lock, so the numbers in the error message are the
  -- numbers the decision was made on.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  -- The same rule the trigger enforces, checked here so the caller gets an
  -- explanation rather than a constraint violation. Defence in depth, not a
  -- substitute: the trigger still runs on the UPDATE below.
  if v_used_est > v_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %. Nothing has been changed.',
      p_plan_key, v_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp does not remove establishments to satisfy a plan change.';
  end if;

  if v_max_pro is not null and v_used_pro > v_max_pro then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %. Nothing has been changed.',
      p_plan_key, v_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Their identity, followers and appointment history are preserved either way.';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      -- Hard-coded. A staff decision is a staff decision, and no argument to
      -- this function can make it look like a payment.
      entitlement_source = 'platform_grant',
      assigned_at = now(),
      assigned_by = v_actor,
      assignment_note = p_note
  where organization_id = p_organization_id;

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'platform_grant', v_actor, p_note)
  returning id into v_change_id;

  return v_change_id;
end;
$$;

comment on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) is
  'The ONLY way a commercial plan changes. Platform admin only, resolved from auth.uid() and never from an argument — an owner of the organization is deliberately not sufficient, because the party being charged cannot decide what it owes. Refuses unknown and withdrawn plans, refuses a downgrade that the organization''s current establishments or roster would not fit (nothing is ever deleted to make one fit), takes the same row lock the capacity triggers take so a downgrade cannot interleave with a location being created, and appends an immutable audit row. entitlement_source is hard-coded to platform_grant: no argument to this function can dress a staff decision up as a payment.';

revoke execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) from public, anon;
-- Granted to authenticated because that is the only role a JWT can present;
-- the function itself is what refuses everyone who is not platform staff. The
-- alternative — a dedicated database role — would need a second authenticator
-- path that does not exist in this stack.
grant execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert that no client can write commercial state directly
--
-- 20260826110100 revoked these at creation. Re-asserting is free and turns
-- "clients cannot write commercial state" into a property THIS migration
-- verifies, rather than one inherited from a file above it that a later edit
-- might weaken.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.organization_commercial_state from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_plan_changes from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_plans from anon, authenticated;
revoke insert, update, delete, truncate on public.commercial_capabilities from anon, authenticated;
revoke insert, update, delete, truncate on public.plan_capabilities from anon, authenticated;

do $$
declare
  v_bad text := '';
  r record;
begin
  for r in
    select g.table_name, g.grantee, g.privilege_type
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('organization_commercial_state', 'commercial_plan_changes',
                           'commercial_plans', 'commercial_capabilities', 'plan_capabilities')
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and g.privilege_type <> 'SELECT'
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R2 plan-assignment check failed — a client role holds a write privilege on commercial state:%', v_bad
      using errcode = 'P0001';
  end if;

  -- And no write POLICY either. Privileges and policies are two independent
  -- locks and this lot depends on both being shut.
  select coalesce(string_agg(format(' %s/%s', tablename, policyname), ''), '')
    into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('organization_commercial_state', 'commercial_plan_changes',
                      'commercial_plans', 'commercial_capabilities', 'plan_capabilities')
    and cmd <> 'SELECT';

  if v_bad <> '' then
    raise exception 'R2 plan-assignment check failed — a non-SELECT policy exists on commercial state:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 plan assignment controls installed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110600_plan_assignment_controls.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260826110700_r2_privilege_hardening.sql
-- ============================================================================

-- FadeUp — R2: the privilege sweep, and its self-assertion
--
-- WHY THIS FILE EXISTS AT ALL
--
-- Supabase installs DEFAULT PRIVILEGES that grant anon, authenticated and
-- service_role EVERYTHING on every new table in `public`:
--
--   pg_default_acl -> postgres/public/r -> anon=arwdDxtm, authenticated=arwdDxtm
--
-- So a `create table` with perfect RLS still ships with `authenticated` holding
-- INSERT, UPDATE, DELETE and TRUNCATE, and RLS is the only thing standing
-- between a caller and the data. On the commercial tables that is not a
-- survivable posture: an UPDATE privilege on organization_commercial_state,
-- combined with a single future permissive policy, is a self-service upgrade to
-- multi_scale.
--
-- Every R2 migration revokes at creation. This file re-asserts the entire
-- matrix in one place and FAILS THE MIGRATION if any of it is wrong, so the
-- guarantee is tested at deploy time rather than trusted. It is the direct
-- sibling of 20260826101000 (R1B) and deliberately not a modification of it:
-- R1B is already validated and its assertions must keep meaning what they meant.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Re-assert the revokes
-- ---------------------------------------------------------------------------

revoke all on public.commercial_plans from anon, authenticated;
revoke all on public.commercial_capabilities from anon, authenticated;
revoke all on public.plan_capabilities from anon, authenticated;
revoke all on public.organization_commercial_state from anon, authenticated;
revoke all on public.commercial_plan_changes from anon, authenticated;

grant select on public.commercial_plans to authenticated;
grant select on public.commercial_capabilities to authenticated;
grant select on public.plan_capabilities to authenticated;
grant select on public.organization_commercial_state to authenticated;
grant select on public.commercial_plan_changes to authenticated;

-- The acquisition worker gets NOTHING commercial. R1A tightened its privileges
-- precisely because its job is parsing third-party scraped content, which is a
-- materially higher-risk surface than the customer API. It discovers prospects;
-- it has no business knowing, still less writing, what any tenant pays. R1B
-- withheld the social graph from it for the same reason and R2 withholds the
-- commercial model.
revoke all on public.commercial_plans from prospect_worker;
revoke all on public.commercial_capabilities from prospect_worker;
revoke all on public.plan_capabilities from prospect_worker;
revoke all on public.organization_commercial_state from prospect_worker;
revoke all on public.commercial_plan_changes from prospect_worker;

revoke execute on function public.assign_commercial_plan(uuid, text, public.commercial_status, text) from prospect_worker;
revoke execute on function public.get_organization_entitlements(uuid) from prospect_worker;
revoke execute on function public.my_organization_has_capability(uuid, text) from prospect_worker;

-- The TRIGGER functions. Postgres grants EXECUTE to PUBLIC by default on every
-- new function, and a trigger function that lands in `public` is no exception.
-- Firing a trigger does not re-check EXECUTE (the privilege is checked when the
-- trigger is CREATED), so revoking here costs nothing and closes a small but
-- real surface: enforce_commercial_state_integrity() and
-- handle_new_organization_commercial_state() are both callable by name today,
-- and a definer function reachable by anon is exactly the shape of mistake the
-- rest of this file exists to catch.
revoke execute on function public.handle_new_organization_commercial_state() from public, anon, authenticated;
revoke execute on function public.reject_commercial_history_mutation() from public, anon, authenticated;
revoke execute on function public.enforce_establishment_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_barber_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_staff_reactivation_capacity() from public, anon, authenticated;
revoke execute on function public.enforce_commercial_state_integrity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assert the result, table by table
--
-- The migration fails rather than logging a warning. A privilege matrix that is
-- "probably right" is the thing this file exists to eliminate.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2a. authenticated may hold SELECT and nothing else. anon, PUBLIC and
  --     prospect_worker may hold nothing at all.
  for r in
    select t.table_name, g.grantee, g.privilege_type
    from (values
      ('commercial_plans'), ('commercial_capabilities'), ('plan_capabilities'),
      ('organization_commercial_state'), ('commercial_plan_changes')
    ) as t(table_name)
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = t.table_name
    where g.grantee in ('anon', 'authenticated', 'PUBLIC', 'prospect_worker')
      and (g.grantee <> 'authenticated' or g.privilege_type <> 'SELECT')
  loop
    v_bad := v_bad || format(' %s/%s/%s', r.table_name, r.grantee, r.privilege_type);
  end loop;

  if v_bad <> '' then
    raise exception 'R2 privilege check failed — unexpected grants:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2b. RLS enabled AND forced. Enabled alone exempts the table owner, and
  --     several definer functions run as postgres — which holds BYPASSRLS in
  --     this stack, so the forcing is what makes the posture legible rather
  --     than accidental.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('commercial_plans', 'commercial_capabilities', 'plan_capabilities',
                        'organization_commercial_state', 'commercial_plan_changes')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    v_bad := v_bad || ' ' || r.relname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 RLS check failed — not enabled+forced on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2c. EVERY R2 function pins search_path — deliberately not filtered to
  --     SECURITY DEFINER. An unqualified name resolves through the CALLER's
  --     search_path in either case, which is a privilege-escalation primitive:
  --     a caller creates their own `commercial_plans` in a schema they control
  --     and the function reads capacity from there instead. Definer functions
  --     make it worse, not different.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'ensure_organization_commercial_state', 'handle_new_organization_commercial_state',
        'reject_commercial_history_mutation',
        'effective_plan_key', 'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'get_organization_entitlements', 'my_organization_has_capability',
        'enforce_establishment_capacity', 'assert_professional_capacity',
        'enforce_barber_capacity', 'enforce_staff_reactivation_capacity',
        'enforce_commercial_state_integrity', 'assign_commercial_plan'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 search_path check failed — not pinned on:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2d. anon may execute NOTHING R2 added. R2 has no anonymous surface at all:
  --     the marketing pricing page renders the application's compiled
  --     catalogue, so there is no anonymous read to serve and certainly no
  --     anonymous mutation. An assignment RPC reachable without a session would
  --     make every check in 20260826110600 decorative.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'assign_commercial_plan', 'get_organization_entitlements',
        'my_organization_has_capability', 'ensure_organization_commercial_state',
        'effective_plan_key', 'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'assert_professional_capacity',
        -- The trigger functions too. They are ordinary functions that happen to
        -- be wired to a trigger, and PUBLIC holds EXECUTE on them by default.
        'handle_new_organization_commercial_state', 'reject_commercial_history_mutation',
        'enforce_establishment_capacity', 'enforce_barber_capacity',
        'enforce_staff_reactivation_capacity', 'enforce_commercial_state_integrity'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 EXECUTE check failed — anon can execute:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  r record;
  v_bad text := '';
begin
  -- 2e. The `private` helpers are not an API. authenticated must reach the
  --     commercial model only through the two public RPCs, which check
  --     membership; a directly callable private.org_has_capability(uuid, text)
  --     would answer questions about any organization in the database.
  for r in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'ensure_organization_commercial_state', 'effective_plan_key',
        'org_has_capability', 'assert_org_capability',
        'org_active_establishments', 'org_active_professionals',
        'assert_professional_capacity'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    v_bad := v_bad || ' ' || r.proname;
  end loop;

  if v_bad <> '' then
    raise exception 'R2 EXECUTE check failed — authenticated can call a private commercial helper directly:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_anon_policies integer;
begin
  -- 2f. The database has had ZERO anon RLS policies since it shipped. R1B
  --     asserted it; R2 adds none either. Asserted globally rather than for R2
  --     tables, because the number that matters is the total.
  select count(*) into v_anon_policies
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles);

  if v_anon_policies > 0 then
    raise exception 'R2 anon-policy check failed — % anon policies exist; R2 must add none', v_anon_policies
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The pricing-model assertions
--
-- These are not privilege checks. They are the structural guarantees that make
-- "FadeUp does not charge per barber, per seat or per location" true by
-- construction rather than by policy — asserted here because this is the file
-- that runs last and fails loudest.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
  r record;
begin
  -- 3a. NO QUANTITY TO MULTIPLY BY. If a column named like a seat, a unit or a
  --     per-something count ever appears on a commercial table, "price x count"
  --     becomes one line of arithmetic away. The defence is that the number
  --     does not exist. max_* columns are CAPS and are named accordingly.
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('commercial_plans', 'organization_commercial_state', 'plan_capabilities')
      and (
        c.column_name like '%seat%'
        or c.column_name like '%quantity%'
        or c.column_name like 'per\_%'
        or c.column_name like '%\_per\_%'
        or c.column_name like '%unit_price%'
        or c.column_name like '%included\_%'
      )
  loop
    v_bad := v_bad || format(' %s.%s', r.table_name, r.column_name);
  end loop;

  if v_bad <> '' then
    raise exception
      'R2 pricing-model check failed — a per-unit/quantity column exists on a commercial table, which is how per-seat billing gets introduced:%',
      v_bad using errcode = 'P0001';
  end if;

  -- 3b. Exactly two price columns on commercial_plans: price_minor and
  --     price_currency. A third is the shape of "base + per unit".
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'commercial_plans'
      and column_name like '%price%'
  ) <> 2 then
    raise exception 'R2 pricing-model check failed — commercial_plans must have exactly price_minor and price_currency'
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare
  v_bad text := '';
begin
  -- 3c. Team size is not a billing input. The commercial state row must carry
  --     no count of members, barbers, staff or users — if it did, the number
  --     would eventually be multiplied by something.
  select coalesce(string_agg(' ' || column_name, ''), '')
    into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'organization_commercial_state'
    and (column_name like '%count%' or column_name like '%barber%'
         or column_name like '%staff%' or column_name like '%member%');

  if v_bad <> '' then
    raise exception
      'R2 pricing-model check failed — organization_commercial_state carries a headcount column; team is included and must never be a billing input:%',
      v_bad using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. R1A and R1B guarantees, re-asserted
--
-- R2 touched none of these, which is exactly why they are worth checking: a lot
-- that believes it changed nothing is the one most likely to have. These are
-- the specific column protections R1A and R1B recorded as load-bearing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text := '';
begin
  if has_column_privilege('authenticated', 'public.appointments', 'completed_at', 'UPDATE') then
    v_bad := v_bad || ' appointments.completed_at';
  end if;

  if has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.appointments', 'booked_by_user_id', 'UPDATE') then
    v_bad := v_bad || ' appointments.booked_by_user_id';
  end if;

  if has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.barbers', 'professional_id', 'UPDATE') then
    v_bad := v_bad || ' barbers.professional_id';
  end if;

  if has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'INSERT')
     or has_column_privilege('authenticated', 'public.customer_passports', 'passport_number', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.passport_number';
  end if;

  -- R1A recorded this one as load-bearing in the OTHER direction: the live
  -- Passport save is an upsert on user_id, and ON CONFLICT DO UPDATE needs
  -- UPDATE on every column in its SET list.
  if not has_column_privilege('authenticated', 'public.customer_passports', 'user_id', 'UPDATE') then
    v_bad := v_bad || ' customer_passports.user_id-MISSING-UPDATE';
  end if;

  if v_bad <> '' then
    raise exception 'R2 regression check failed — an R1A/R1B column protection changed:%', v_bad
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  -- The durable identity model must be intact. R2 enforces caps on ROSTER
  -- PLACEMENTS and must never have reached into identity to do it.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'professionals'
  ) then
    raise exception 'R2 regression check failed: public.professionals is gone' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'professional_follows'
  ) then
    raise exception 'R2 regression check failed: the follow graph is gone' using errcode = 'P0001';
  end if;

  -- No commercial column may appear on the identity table. Claim state is not
  -- subscription state (Constitution 5.6), and the moment a plan column lands
  -- on professionals the two axes are one field again.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professionals'
      and (column_name like '%plan%' or column_name like '%subscription%'
           or column_name like '%entitlement%' or column_name like '%price%'
           or column_name like '%paid%')
  ) then
    raise exception 'R2 regression check failed: a commercial column was added to public.professionals — claim state is not subscription state'
      using errcode = 'P0001';
  end if;
end $$;

do $$
begin
  raise notice 'R2 privilege hardening: all checks passed';
end $$;


-- ============================================================================
-- END db/migrations/20260826110700_r2_privilege_hardening.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next steps: run
--   supabase/VERIFY_R2_PRICING_ENTITLEMENTS_2026_08_26.sql
--   supabase/VERIFY_R1B_SOCIAL_FOUNDATION_2026_08_26.sql
--   supabase/VERIFY_R1A_INTEGRITY_FOUNDATION_2026_08_25.sql
-- and confirm 0 FAIL rows in all three.
-- ============================================================================
