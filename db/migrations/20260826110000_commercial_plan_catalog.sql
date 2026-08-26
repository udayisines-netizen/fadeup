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
