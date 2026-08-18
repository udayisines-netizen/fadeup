-- ============================================================================
-- FadeUp — MASTER: LOT A + LOT A.5 + LOT B
-- Generated 2026-08-18. DO NOT EDIT BY HAND.
--
-- Regenerate with:  scripts/generate-master-lots-a-a5-b.sh
-- Verify in sync:   scripts/generate-master-lots-a-a5-b.sh --check
--
-- WHAT THIS IS
--   The ordered, effective SQL required to upgrade the CURRENT FadeUp
--   database with ONLY this run's changes:
--
--     LOT A    Close the organization-creation authorization bypass
--              (SEC-01): revoke the client INSERT grant, remove the
--              permissive INSERT policy, and add a BEFORE INSERT guard so
--              organizations can only be created through
--              create_organization() or review_professional_application().
--
--     LOT A.5  Universal identity. Google and Apple become authentication
--              methods for every FadeUp user type. Almost all of that is
--              GoTrue configuration and frontend wiring; the database part
--              is (a) making profile creation survive OAuth metadata,
--              including a Sign in with Apple that supplies no name at all,
--              and (b) get_my_access(), the ONE authoritative post-auth
--              access resolver. No table mirrors auth.identities: a second
--              identity store would be a second, weaker source of truth.
--
--     LOT B    Business identity columns (business_type, currency,
--              country_code), one authoritative onboarding-readiness
--              evaluator, idempotent onboarding RPCs, a server-side
--              publication gate, and an approval flow that finally stops
--              discarding the address the applicant already gave us.
--
--   It is a byte-for-byte concatenation of these version-controlled
--   migrations, which remain the source of truth:
--     db/migrations/20260818200000_organization_creation_hardening.sql
--     db/migrations/20260818210000_identity_and_access_resolution.sql
--     db/migrations/20260818220000_business_profile_and_onboarding.sql
--
--   No fix exists only here. If something must change, change the
--   migration and regenerate.
--
-- WHAT THIS IS NOT
--   It does not create the base FadeUp schema, and it contains no Worker V2
--   / acquisition schema whatsoever. It assumes the existing database
--   already has: the `private` and `extensions` schemas, public.organizations
--   / memberships / locations / services / barbers / staff_profiles and
--   their RLS, public.professional_applications and
--   review_professional_application(), public.platform_members and the
--   private.is_platform_admin() / has_org_role() / is_org_member() helpers,
--   and public.set_organization_marketplace_visible().
--
-- BEHAVIOUR CHANGES AN OPERATOR SHOULD EXPECT
--   1. A direct client INSERT into public.organizations now fails. Nothing
--      in the application does this (verified: the frontend only reads
--      organizations and updates marketplace_visible), and both legitimate
--      creation RPCs are updated in the same transaction.
--   2. Setting organizations.marketplace_visible = true now requires
--      get_organization_readiness().ready_to_publish. ALREADY-published
--      organizations are unaffected — the gate only fires on the false ->
--      true transition, and unpublishing is never blocked. An existing
--      published-but-incomplete organization keeps its visibility until
--      someone unpublishes it, at which point it must be completed to
--      publish again.
--   3. Approving a professional application now also creates the first
--      location from the application's address and seeds business_type,
--      country_code and currency. Previously approved organizations are not
--      retroactively changed.
--
-- SAFETY
--   * Runs inside a single transaction: it either fully applies or fully
--     rolls back. There is no partially-upgraded state.
--   * Contains no DROP TABLE, no TRUNCATE, no DROP FUNCTION ... CASCADE,
--     no DROP TYPE ... CASCADE, no mass DELETE, and never disables row
--     level security.
--   * Idempotent: every object is created IF NOT EXISTS, via CREATE OR
--     REPLACE, or inside a guarded DO block, so re-running is safe.
--   * The one policy removal (organizations_insert) is the entire point of
--     LOT A and REMOVES access rather than granting it.
--
-- HOW TO APPLY
--   Review first, then run against the target database as a role that can
--   create objects in `public` and `private` (postgres in the self-hosted
--   Supabase stack):
--
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f supabase/MASTER_LOTS_A_A5_B_2026_08_18.sql
--
--   Then run the companion verification script and confirm zero
--   unexpected FAIL rows:
--
--     psql -U postgres -d postgres \
--       -f supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- BEGIN db/migrations/20260818200000_organization_creation_hardening.sql
-- ============================================================================

-- FadeUp — LOT A: organization-creation authorization hardening (SEC-01)
--
-- Closes the professional-application review bypass found in the Customer +
-- Professional audit.
--
-- THE DEFECT
--
--   20260813170000_professional_applications.sql section 6 added a real
--   server-side guard: create_organization() refuses a caller whose most
--   recent professional_application is pending_review or rejected. That is
--   correct, and it stays.
--
--   But the guard lived ONLY inside that function. The table itself still
--   carried, from 20260809100900_tenant_rls_policies.sql:
--
--       create policy organizations_insert ... to authenticated
--         with check (true);
--
--   and `authenticated` still held the INSERT privilege that Supabase grants
--   by default on public tables. So the whole workflow was routed around by
--   one PostgREST call:
--
--       supabase.from('organizations').insert({ name, slug })
--
--   The AFTER INSERT trigger on_organization_created then wrote an owner
--   membership for auth.uid(), and the caller held a tenant. A pending
--   applicant, a rejected applicant, or an ordinary customer account could
--   all self-activate. No frontend guard could see it, and RequireProAccess
--   already documents that it is UX rather than the security boundary.
--
-- THE FIX — three independent layers, so no single future mistake reopens it
--
--   1. GRANT. Revoke INSERT on public.organizations from anon and
--      authenticated. Every legitimate creation path is already a SECURITY
--      DEFINER function owned by the migration role, and a DEFINER function
--      executes with the owner's privileges — so removing the client grant
--      costs those paths nothing. Verified: the only three `insert into
--      public.organizations` statements in this repository are inside
--      create_organization() (20260809101000, redefined 20260813170000) and
--      review_professional_application() (20260813170000); no frontend code
--      writes the table (only reads and marketplace_visible updates).
--
--   2. POLICY. Drop organizations_insert entirely rather than weakening it
--      to `with check (false)`. Absence of a policy is this schema's
--      established way of saying "no client write path at all" — the same
--      posture invitations, platform_members, platform_audit_log and
--      appointment_claim_tokens already take. A policy that exists but can
--      never pass invites someone to "fix" it later.
--
--   3. TRIGGER. A BEFORE INSERT guard that requires a transaction-local flag
--      which only the sanctioned RPCs set. This is the layer that survives a
--      future migration accidentally re-granting INSERT or re-adding a
--      permissive policy, and it also covers any role that bypasses RLS
--      (BYPASSRLS holders skip policies; they do not skip triggers).
--
--      The flag is set with set_config(..., is_local => true), so it is
--      scoped to the current transaction and cannot leak into a later
--      statement on a pooled connection. Same mechanism, and same reasoning,
--      as the pre-existing fadeup.skip_org_owner_membership flag.
--
--      Deliberate escape hatch: when there is no JWT identity at all
--      ((select auth.uid()) is null) the trigger stands down. That is an
--      operator psql session, a service_role job, or a restore — never a
--      client request, because anon and authenticated both carry a JWT and
--      neither can reach this table any more anyway. This mirrors the
--      identical, already-shipped decision in
--      guard_professional_application_update().
--
-- WHAT DOES NOT CHANGE
--
--   * The application-status check inside create_organization() (pending and
--     rejected still refused) — untouched, and now unroutable-around.
--   * on_organization_created / handle_new_organization — untouched. A
--     legitimate creation still makes the caller the owner, and
--     review_professional_application still suppresses that so the APPLICANT
--     becomes owner rather than the reviewer.
--   * organizations_select / _update / _delete — untouched. Shop A still
--     cannot read or write Shop B, and owner/manager can still edit and
--     publish their own organization.
--   * complete_organization_onboarding() — untouched. It delegates to
--     create_organization(), so it inherits the flag automatically.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Remove the client-facing INSERT surface.
-- ---------------------------------------------------------------------------

revoke insert on public.organizations from anon, authenticated;

drop policy if exists organizations_insert on public.organizations;

comment on table public.organizations is
  'Tenant root. Every business resource must have a provable ownership path to a row here. NO client-facing INSERT path exists: the INSERT grant is revoked from anon/authenticated and there is deliberately no INSERT policy. Organizations are created exclusively by create_organization() (self-serve, refuses pending/rejected applicants) and review_professional_application() (platform approval), both SECURITY DEFINER, both of which set fadeup.org_creation_authorized for the guard trigger below.';

-- ---------------------------------------------------------------------------
-- 2. The guard trigger — the layer that does not depend on grants or policies.
-- ---------------------------------------------------------------------------

create or replace function private.assert_organization_creation_authorized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Set by the sanctioned SECURITY DEFINER creation RPCs, transaction-local.
  -- current_setting(..., true) returns null instead of raising when the GUC
  -- was never set in this session, so an unflagged insert falls through to
  -- the checks below rather than erroring for the wrong reason.
  if coalesce(current_setting('fadeup.org_creation_authorized', true), '') = 'on' then
    return new;
  end if;

  -- review_professional_application() already raises
  -- fadeup.skip_org_owner_membership for exactly one statement — the
  -- approval insert — so it is, today, the approval path's own marker.
  -- Accepting it here keeps THIS migration independently correct: platform
  -- approval keeps working the moment this migration lands, with no edit to
  -- that function. The LOT B migration, which has to touch the approval
  -- function anyway to create the first location, additionally raises the
  -- dedicated flag above, at which point this branch is belt-and-braces.
  if coalesce(current_setting('fadeup.skip_org_owner_membership', true), '') = 'on' then
    return new;
  end if;

  -- No JWT identity: an operator psql session, a service_role job, or a
  -- restore. Not a client request — anon and authenticated no longer hold
  -- the INSERT privilege at all. Same escape hatch, same reasoning, as
  -- public.guard_professional_application_update().
  if (select auth.uid()) is null then
    return new;
  end if;

  raise exception 'organizations may only be created through create_organization() or review_professional_application()'
    using errcode = '42501';
end;
$$;

comment on function private.assert_organization_creation_authorized() is
  'BEFORE INSERT guard on public.organizations. Rejects any creation that did not come through a sanctioned SECURITY DEFINER RPC (which sets the transaction-local fadeup.org_creation_authorized flag). Independent of grants and RLS policies, so it still holds if either is loosened later, and it also covers BYPASSRLS roles, which skip policies but not triggers.';

revoke execute on function private.assert_organization_creation_authorized() from public, anon, authenticated;

drop trigger if exists organizations_assert_creation_authorized on public.organizations;
create trigger organizations_assert_creation_authorized
  before insert on public.organizations
  for each row execute function private.assert_organization_creation_authorized();

-- ---------------------------------------------------------------------------
-- 3. Teach the two legitimate creation paths to raise the flag.
--
--    create_organization(): body preserved verbatim from
--    20260813170000_professional_applications.sql section 6 — the pending/
--    rejected application check is unchanged — with only the flag added
--    around the insert.
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_status public.professional_application_status;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required to create an organization';
  end if;

  select a.status into v_status
    from public.professional_applications a
    where a.user_id = (select auth.uid())
    order by a.submitted_at desc
    limit 1;

  if v_status = 'pending_review' then
    raise exception 'your professional application is still being reviewed';
  elsif v_status = 'rejected' then
    raise exception 'your professional application was not approved';
  end if;

  -- Transaction-local, and cleared immediately after the insert so a later
  -- statement in the same transaction cannot ride on it.
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);

  -- on_organization_created (AFTER INSERT trigger on public.organizations)
  -- has already run by this point, making the caller the org's owner.
  return v_org;
end;
$$;

comment on function public.create_organization(text, text) is
  'The only self-serve path that creates an organization. Owned by the calling user via on_organization_created. Refuses callers whose most recent professional application is pending or rejected — otherwise an applicant could self-activate and bypass platform review. Raises fadeup.org_creation_authorized for the BEFORE INSERT guard trigger; the table itself grants no client INSERT.';

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;


-- ============================================================================
-- END db/migrations/20260818200000_organization_creation_hardening.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260818210000_identity_and_access_resolution.sql
-- ============================================================================

-- FadeUp — LOT A.5: universal identity + one authoritative access resolver
--
-- Google and Apple become authentication methods for EVERY FadeUp user type
-- (Customer, Professional, Business Owner, Staff, Platform Owner/Admin/
-- Support). Almost all of that work is GoTrue configuration and frontend
-- wiring, deliberately — there is no new "oauth" table here, because an
-- application table that mirrors auth.identities would immediately become a
-- second, weaker source of identity truth.
--
-- THE ONE RULE THIS MIGRATION EXISTS TO MAKE STRUCTURAL
--
--   The provider authenticates. The database authorizes. Nothing a provider
--   says about a user may ever become a FadeUp permission.
--
--   Concretely: an attacker who fully controls what Google or Apple returns
--   — including raw_user_meta_data claiming {"role":"platform_admin"} or an
--   email that looks like a FadeUp staff address — still gets exactly the
--   authorization of a brand-new account, because:
--
--     * platform access resolves ONLY through public.platform_members, which
--       has no client-facing INSERT/UPDATE/DELETE path at all (grants
--       revoked in 20260810130000; the only writers are
--       claim_platform_owner_bootstrap() and accept_platform_invitation(),
--       both requiring an unguessable single-use token, plus operator SQL);
--     * professional access resolves ONLY through public.memberships, whose
--       INSERT policy demands an existing owner/manager membership in that
--       organization, and whose only self-service writer is
--       accept_invitation() (token + matching auth email);
--     * organization creation is now unreachable from any client at all
--       (see 20260818200000_organization_creation_hardening.sql);
--     * nothing anywhere in this schema reads raw_user_meta_data or
--       raw_app_meta_data for an authorization decision. Verified across
--       db/migrations: the ONLY two reads are the display fields in
--       handle_new_user() below.
--
--   get_my_access() added here is a READ. It reports what the database has
--   already decided. It cannot grant anything, takes no user-id parameter,
--   and resolves exclusively from auth.uid().
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. handle_new_user — survive OAuth identity metadata, including Apple's.
--
--    The original read raw_user_meta_data->>'full_name' and ->>'avatar_url'.
--    That is correct for the email/password signup form, which sets exactly
--    those keys. OAuth providers do not:
--
--      Google  full_name, name, avatar_url, picture   (all usually present)
--      Apple   name ONLY on the very first authorization, and only if the
--              user consents — and NEVER on any subsequent sign-in. With
--              Hide My Email, even the address is a private relay alias.
--
--    So an Apple user could land with no name at all. That is a normal,
--    successful authentication, NOT a failure: the profile simply has no
--    display name yet and onboarding asks for it later.
--
--    Two behaviours matter here and both are preserved rather than assumed:
--
--      * `on conflict (id) do nothing` stays. This trigger is AFTER INSERT
--        on auth.users, so it fires once per ACCOUNT, never per sign-in —
--        which is precisely why a later Apple sign-in returning no name can
--        never blank out a name the user has since set. The "never overwrite
--        a real name with null" requirement is satisfied structurally, by
--        this function only ever inserting.
--      * nullif(btrim(...), '') everywhere, so a provider sending "" stores
--        NULL rather than a blank-looking name that reads as "set".
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    -- Email/password signup sends full_name; Google sends both full_name and
    -- name; Apple sends name at most once. Any of them may be absent.
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '')
    ),
    -- Google uses picture; the signup form and some providers use avatar_url.
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'picture', '')), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger on auth.users: creates the matching public.profiles row. Reads raw_user_meta_data for DISPLAY FIELDS ONLY (name, avatar) — never for authorization. Tolerates providers that supply neither, which is normal for Sign in with Apple. INSERT-only, so a later sign-in carrying no name can never overwrite a name the user has set.';

-- ---------------------------------------------------------------------------
-- 2. get_my_access — the single post-auth identity resolution mechanism.
--
--    One round trip, one source of truth, used by every entry point
--    (/login, /register, /pro/login, /pro/register, /platform/login and the
--    shared OAuth callback) so there is not one resolver per surface that
--    can drift apart.
--
--    Deliberately returns CAPABILITIES, not a single "account type". A
--    FadeUp identity is not one of {customer, professional, platform} — it
--    holds any combination simultaneously, and gaining one must never
--    remove another. The shape below can represent every combination
--    including Platform Owner + Business Owner + Customer at once.
--
--    signup_intent is included and is explicitly a ROUTING HINT ONLY. It is
--    already used that way by WorkspaceSelectorPage. It is surfaced here so
--    the frontend never has to reach into user_metadata itself, which keeps
--    "metadata is not authorization" easy to see and easy to test.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_access()
returns table (
  user_id uuid,
  -- Authoritative: public.platform_members. Null means no platform access,
  -- whatever the provider, the email domain, or the metadata claims.
  platform_role public.platform_role,
  platform_available boolean,
  -- Authoritative: public.memberships.
  professional_available boolean,
  organization_count integer,
  owned_organization_count integer,
  -- Every authenticated identity may use the customer experience. This is a
  -- product fact, not a permission lookup: the customer app only ever
  -- exposes the caller's OWN data, through owner-scoped RLS and RPCs.
  customer_available boolean,
  customer_profile_exists boolean,
  customer_onboarding_completed boolean,
  -- Authoritative: public.professional_applications (latest submission).
  application_status public.professional_application_status,
  -- Routing hint only. NEVER authorization. See comment above.
  signup_intent text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select auth.uid()),
    (select pm.role from public.platform_members pm where pm.user_id = (select auth.uid())),
    exists (select 1 from public.platform_members pm where pm.user_id = (select auth.uid())),
    exists (select 1 from public.memberships m where m.user_id = (select auth.uid())),
    (select count(*)::integer from public.memberships m where m.user_id = (select auth.uid())),
    (select count(*)::integer from public.memberships m where m.user_id = (select auth.uid()) and m.role = 'owner'),
    (select auth.uid()) is not null,
    exists (select 1 from public.customer_profiles cp where cp.user_id = (select auth.uid())),
    exists (
      select 1 from public.customer_profiles cp
      where cp.user_id = (select auth.uid()) and cp.onboarding_completed_at is not null
    ),
    (
      select a.status from public.professional_applications a
      where a.user_id = (select auth.uid())
      order by a.submitted_at desc
      limit 1
    ),
    (
      select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'signup_intent', '')), '')
      from auth.users u where u.id = (select auth.uid())
    )
  where (select auth.uid()) is not null;
$$;

comment on function public.get_my_access() is
  'The authoritative post-authentication access snapshot for the CALLING user. Takes no parameters and resolves exclusively from auth.uid(), so it cannot be asked about anyone else. platform_available comes from platform_members and professional_available from memberships — never from the authentication provider, the email domain, or user metadata. signup_intent is a routing hint with no authorization meaning. Returns zero rows for an unauthenticated caller.';

revoke execute on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert the no-client-write-path posture the platform roster depends on.
--
--    20260810130000 already revoked these. Re-asserting is free, is
--    idempotent, and turns "platform_members is unwritable by clients" into
--    a property this run's VERIFY can check directly rather than a property
--    inherited from a migration three months earlier. It is the single most
--    important invariant behind "Google login is not Platform Admin".
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.platform_members from anon, authenticated;
revoke insert, update, delete on public.memberships from anon;

comment on table public.platform_members is
  'FadeUp platform staff roster — the ONLY authority for platform access. Grants only via claim_platform_owner_bootstrap()/accept_platform_invitation() or direct operator SQL; anon and authenticated hold no INSERT/UPDATE/DELETE privilege. Authentication provider (password, Google, Apple) is irrelevant here: signing in proves who you are, this table decides whether you are platform staff.';


-- ============================================================================
-- END db/migrations/20260818210000_identity_and_access_resolution.sql
-- ============================================================================

-- ============================================================================
-- BEGIN db/migrations/20260818220000_business_profile_and_onboarding.sql
-- ============================================================================

-- FadeUp — LOT B: business profile + a professional onboarding that actually
--                  produces a bookable business
--
-- THE PROBLEM THIS SOLVES
--
--   Audited live state before this migration: 4 organizations, 0 services,
--   0 location_hours, 0 barber_working_hours, 0 appointments. Not a seeding
--   accident — the structural consequence of two things:
--
--     1. complete_organization_onboarding() collects four fields (name,
--        slug, location name, timezone) and stops. Everything a booking
--        actually needs — a service, a bookable professional, opening hours,
--        working hours — had to be assembled by hand afterwards across four
--        separate admin pages, with nothing telling the owner what was
--        still missing.
--     2. review_professional_application() creates the organization and the
--        owner membership but NO location, and discards the address the
--        applicant already typed into their application. An approved shop
--        therefore starts with zero locations, and the self-serve
--        onboarding form is never shown to them because they already hold a
--        membership.
--
--   Nothing here rebuilds services, availability, booking or memberships.
--   Those foundations were audited as sound. This migration adds the
--   business-identity columns they were missing, one authoritative readiness
--   evaluator over the state they already store, idempotent RPCs the wizard
--   drives, and a server-side publication gate.
--
-- WHAT "BOOKABLE" MEANS, EXACTLY
--
--   get_public_available_slots() returns rows only when ALL of these hold.
--   The readiness evaluator below is derived from that function's real
--   requirements rather than from a wish list, which is why it can honestly
--   promise that ready_to_book = true implies slots exist:
--
--     active location  ->  location_hours row for the day, not closed
--     active service   ->  offered at that location (service_locations)
--     bookable barber  ->  is_bookable + staff_profiles.is_active/is_public
--                          + staff_profiles.location_id = that location
--                          + barber_services link to that service
--                          + barber_working_hours row for the day, not off
--
-- NAMING
--
--   barbers / barber_id / barber_services / barber_working_hours keep their
--   names. They are internal identifiers for "a professional who takes
--   appointments", the audit found them to be a cosmetic rather than
--   structural constraint, and renaming them would touch every RLS policy
--   in the schema for zero product value. business_type below is what
--   actually carries the hair-salon / mixed-salon / multi-location domain.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Business identity columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_type') then
    create type public.business_type as enum (
      'solo_professional',
      'barbershop',
      'hair_salon',
      'mixed_salon',
      'multi_location'
    );
  end if;
end $$;

comment on type public.business_type is
  'What kind of business this organization runs. Distinct from public.professional_type, which describes an APPLICANT at application time and cannot be changed afterwards; this is the live, editable business configuration that drives onboarding and product behaviour.';

alter table public.organizations
  add column if not exists business_type public.business_type,
  -- ISO 4217. Nullable rather than defaulted: "no currency chosen yet" is a
  -- real onboarding state that readiness must be able to see, and silently
  -- defaulting would reintroduce exactly the hardcoded-USD problem the audit
  -- found in six frontend formatters.
  add column if not exists currency text,
  -- ISO 3166-1 alpha-2. Drives currency/timezone SUGGESTIONS only.
  add column if not exists country_code text,
  add column if not exists onboarding_completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_currency_format') then
    alter table public.organizations
      add constraint organizations_currency_format
      check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_country_code_format') then
    alter table public.organizations
      add constraint organizations_country_code_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

comment on column public.organizations.business_type is
  'solo_professional | barbershop | hair_salon | mixed_salon | multi_location. Set during onboarding, editable afterwards. Drives which onboarding steps apply and which starter-service template is offered.';
comment on column public.organizations.currency is
  'ISO 4217 code for every price this organization quotes. NULL means not chosen yet — readiness treats that as incomplete rather than assuming a currency.';
comment on column public.organizations.country_code is
  'ISO 3166-1 alpha-2. Used only to SUGGEST a currency and timezone; an explicit choice always wins.';
comment on column public.organizations.onboarding_completed_at is
  'When the owner finished the onboarding wizard. Advisory/analytics only — routing and publication both use get_organization_readiness(), which reads real persisted state, so a stamped-but-incomplete organization still cannot publish.';

-- ---------------------------------------------------------------------------
-- 2. Country -> currency / timezone suggestions
--
--    Deliberately narrow. Only unambiguous single-timezone countries get a
--    timezone, and unlisted countries return NULL rather than a guess — the
--    wizard then asks instead of silently configuring a shop into the wrong
--    timezone, which would corrupt every slot it ever computes.
-- ---------------------------------------------------------------------------

create or replace function public.suggested_currency_for_country(p_country_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'EUR' when 'BE' then 'EUR' when 'DE' then 'EUR' when 'ES' then 'EUR'
    when 'IT' then 'EUR' when 'NL' then 'EUR' when 'PT' then 'EUR' when 'LU' then 'EUR'
    when 'IE' then 'EUR' when 'AT' then 'EUR' when 'FI' then 'EUR' when 'GR' then 'EUR'
    when 'MC' then 'EUR'
    when 'GB' then 'GBP'
    when 'CH' then 'CHF'
    when 'US' then 'USD'
    when 'CA' then 'CAD'
    when 'MA' then 'MAD'
    when 'AE' then 'AED'
    else null
  end;
$$;

comment on function public.suggested_currency_for_country(text) is
  'Suggested ISO 4217 currency for a country, or NULL when there is no confident single answer. A SUGGESTION only — an explicit choice made in onboarding always overrides it. France resolves to EUR; nothing here ever falls back to USD.';

create or replace function public.suggested_timezone_for_country(p_country_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_country_code, '')))
    when 'FR' then 'Europe/Paris'   when 'BE' then 'Europe/Brussels'
    when 'DE' then 'Europe/Berlin'  when 'ES' then 'Europe/Madrid'
    when 'IT' then 'Europe/Rome'    when 'NL' then 'Europe/Amsterdam'
    when 'PT' then 'Europe/Lisbon'  when 'LU' then 'Europe/Luxembourg'
    when 'IE' then 'Europe/Dublin'  when 'AT' then 'Europe/Vienna'
    when 'CH' then 'Europe/Zurich'  when 'GB' then 'Europe/London'
    when 'MC' then 'Europe/Monaco'  when 'MA' then 'Africa/Casablanca'
    when 'AE' then 'Asia/Dubai'
    -- US and CA span several zones; guessing one would silently mis-schedule
    -- every appointment, so they deliberately return NULL and are asked.
    else null
  end;
$$;

comment on function public.suggested_timezone_for_country(text) is
  'Suggested IANA timezone for single-timezone countries, NULL otherwise (US/CA deliberately return NULL rather than a guess — a wrong timezone corrupts every computed slot).';

grant execute on function public.suggested_currency_for_country(text) to authenticated;
grant execute on function public.suggested_timezone_for_country(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_organization_readiness — THE authoritative evaluator
--
--    One implementation, used by: the onboarding wizard's progress and
--    review step, the professional routing decision (onboarding vs
--    workspace), and the publication gate below. Evaluating persisted state
--    rather than wizard progress is the whole point — a half-finished wizard
--    whose data did persist is ready, and a completed wizard whose data did
--    not is not.
-- ---------------------------------------------------------------------------

-- Return shape includes business_type/currency, so this is DROP + CREATE
-- rather than CREATE OR REPLACE — Postgres refuses to replace a function
-- whose OUT parameters changed. Same precedent as get_public_barber
-- (20260813110000) and get_my_appointments (20260813160000).
drop function if exists public.get_organization_readiness(uuid);

create function public.get_organization_readiness(p_organization_id uuid)
returns table (
  organization_id uuid,
  -- Returned as well as flagged: the onboarding wizard needs to know WHICH
  -- type in order to pick a starter-service template, and making it fetch
  -- the organization separately would mean two sources for one answer.
  business_type public.business_type,
  currency text,
  has_business_type boolean,
  has_currency boolean,
  has_location boolean,
  has_location_address boolean,
  has_timezone boolean,
  has_professional boolean,
  has_service boolean,
  has_service_at_location boolean,
  has_service_for_professional boolean,
  has_location_hours boolean,
  has_professional_hours boolean,
  has_public_profile boolean,
  ready_to_book boolean,
  ready_to_publish boolean,
  is_published boolean,
  missing_requirements text[]
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  r record;
  v_missing text[] := array[]::text[];
  v_ready_to_book boolean;
  v_ready_to_publish boolean;
begin
  -- Same visibility rule as every other org-scoped read in this schema.
  -- SECURITY DEFINER bypasses RLS, so the check has to be explicit.
  if not (
    (select private.is_org_member(p_organization_id))
    or (select private.is_platform_admin())
  ) then
    raise exception 'not authorized to read readiness for this organization'
      using errcode = '42501';
  end if;

  select
    o.business_type,
    o.currency,
    o.business_type is not null as has_business_type,
    o.currency is not null as has_currency,
    o.marketplace_visible as is_published,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
    ) as has_location,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and nullif(btrim(coalesce(l.address_line1, '')), '') is not null
        and nullif(btrim(coalesce(l.city, '')), '') is not null
        and nullif(btrim(coalesce(l.country, '')), '') is not null
    ) as has_location_address,

    exists (
      select 1 from public.locations l
      where l.organization_id = o.id and l.is_active
        and nullif(btrim(coalesce(l.timezone, '')), '') is not null
    ) as has_timezone,

    -- "Professional" here means what get_public_available_slots requires:
    -- bookable, active, publicly listed, AND attached to a location.
    exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.locations l on l.id = sp.location_id and l.is_active
      where b.organization_id = o.id
        and b.is_bookable and sp.is_active and sp.is_public
    ) as has_professional,

    exists (
      select 1 from public.services s
      where s.organization_id = o.id and s.is_active
    ) as has_service,

    exists (
      select 1
      from public.services s
      join public.service_locations sl on sl.service_id = s.id
      join public.locations l on l.id = sl.location_id and l.is_active
      where s.organization_id = o.id and s.is_active
    ) as has_service_at_location,

    exists (
      select 1
      from public.services s
      join public.barber_services bs on bs.service_id = s.id
      join public.barbers b on b.id = bs.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where s.organization_id = o.id and s.is_active
    ) as has_service_for_professional,

    exists (
      select 1
      from public.location_hours lh
      join public.locations l on l.id = lh.location_id and l.is_active
      where l.organization_id = o.id and not lh.is_closed
    ) as has_location_hours,

    exists (
      select 1
      from public.barber_working_hours bwh
      join public.barbers b on b.id = bwh.barber_id and b.is_bookable
      join public.staff_profiles sp on sp.id = b.staff_profile_id and sp.is_active and sp.is_public
      where b.organization_id = o.id and not bwh.is_off
    ) as has_professional_hours,

    -- Minimum public profile: a real business name (guaranteed by the
    -- not-blank constraint), plus at least one publicly listed professional
    -- carrying a display name. Photos and bios are genuinely optional today
    -- — there is no photo storage for them yet — so requiring them here
    -- would block publication on a capability the product does not have.
    exists (
      select 1
      from public.staff_profiles sp
      where sp.organization_id = o.id and sp.is_public and sp.is_active
        and nullif(btrim(coalesce(sp.display_name, '')), '') is not null
    ) as has_public_profile

  into r
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'organization not found';
  end if;

  -- ready_to_book: every condition get_public_available_slots depends on.
  v_ready_to_book :=
    r.has_location and r.has_timezone and r.has_professional and r.has_service
    and r.has_service_at_location and r.has_service_for_professional
    and r.has_location_hours and r.has_professional_hours;

  -- ready_to_publish additionally needs the marketplace-facing facts: what
  -- kind of business this is, what currency its prices are in, where it
  -- physically is (search filters on city/country), and a public profile.
  v_ready_to_publish :=
    v_ready_to_book and r.has_business_type and r.has_currency
    and r.has_location_address and r.has_public_profile;

  if not r.has_business_type then v_missing := array_append(v_missing, 'business_type'); end if;
  if not r.has_currency then v_missing := array_append(v_missing, 'currency'); end if;
  if not r.has_location then v_missing := array_append(v_missing, 'location'); end if;
  if not r.has_location_address then v_missing := array_append(v_missing, 'location_address'); end if;
  if not r.has_timezone then v_missing := array_append(v_missing, 'timezone'); end if;
  if not r.has_professional then v_missing := array_append(v_missing, 'professional'); end if;
  if not r.has_service then v_missing := array_append(v_missing, 'service'); end if;
  if not r.has_service_at_location then v_missing := array_append(v_missing, 'service_at_location'); end if;
  if not r.has_service_for_professional then v_missing := array_append(v_missing, 'service_for_professional'); end if;
  if not r.has_location_hours then v_missing := array_append(v_missing, 'location_hours'); end if;
  if not r.has_professional_hours then v_missing := array_append(v_missing, 'professional_hours'); end if;
  if not r.has_public_profile then v_missing := array_append(v_missing, 'public_profile'); end if;

  return query select
    p_organization_id,
    r.business_type, r.currency,
    r.has_business_type, r.has_currency, r.has_location, r.has_location_address,
    r.has_timezone, r.has_professional, r.has_service, r.has_service_at_location,
    r.has_service_for_professional, r.has_location_hours, r.has_professional_hours,
    r.has_public_profile,
    v_ready_to_book, v_ready_to_publish, r.is_published, v_missing;
end;
$$;

comment on function public.get_organization_readiness(uuid) is
  'THE authoritative onboarding-readiness evaluator. Reads persisted state only — never wizard progress — so a resumed onboarding always reflects the truth. ready_to_book mirrors exactly what get_public_available_slots requires, so a true value means real slots are computable. ready_to_publish additionally requires business_type, currency, a full address and a public profile. Callable by org members and platform admins only.';

revoke execute on function public.get_organization_readiness(uuid) from public, anon;
grant execute on function public.get_organization_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Publication gate
--
--    The audit found the frontend flipping organizations.marketplace_visible
--    with a plain PATCH (lib/queries/organization-marketplace.ts), bypassing
--    the validated set_organization_marketplace_visible() RPC entirely. Both
--    paths are now gated by the same trigger, because a trigger fires on
--    every write — the RPC's, the PATCH's, and any future one — whereas a
--    check placed only inside the RPC is exactly the mistake SEC-01 was.
--
--    Turning visibility OFF is never blocked: an incomplete shop must always
--    be able to withdraw itself.
-- ---------------------------------------------------------------------------

create or replace function public.guard_marketplace_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready boolean;
  v_missing text[];
begin
  if new.marketplace_visible is not true or old.marketplace_visible is true then
    return new;
  end if;

  -- No JWT identity: operator SQL or a restore. Same documented escape hatch
  -- as guard_professional_application_update() and the organization-creation
  -- guard — never a client request.
  if (select auth.uid()) is null then
    return new;
  end if;

  select r.ready_to_publish, r.missing_requirements
    into v_ready, v_missing
    from public.get_organization_readiness(new.id) r;

  if not coalesce(v_ready, false) then
    raise exception 'this business is not ready to publish yet: missing %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.guard_marketplace_publication() is
  'BEFORE UPDATE gate on organizations.marketplace_visible. Publishing requires get_organization_readiness().ready_to_publish; unpublishing is always allowed. Sits on the TABLE, so it covers the validated RPC and any direct client PATCH identically.';

drop trigger if exists organizations_guard_marketplace_publication on public.organizations;
create trigger organizations_guard_marketplace_publication
  before update on public.organizations
  for each row execute function public.guard_marketplace_publication();

-- ---------------------------------------------------------------------------
-- 5. Onboarding RPCs — every one idempotent, because onboarding is resumable
-- ---------------------------------------------------------------------------

create or replace function public.save_business_profile(
  p_organization_id uuid,
  p_business_type public.business_type default null,
  p_currency text default null,
  p_country_code text default null,
  p_name text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may change the business profile'
      using errcode = '42501';
  end if;

  -- coalesce on every column: this is a step in a wizard, so a call that
  -- saves only the business type must not blank out the currency saved by a
  -- later step the user then went back from.
  update public.organizations o set
    business_type = coalesce(p_business_type, o.business_type),
    currency = coalesce(nullif(btrim(upper(coalesce(p_currency, ''))), ''), o.currency),
    country_code = coalesce(nullif(btrim(upper(coalesce(p_country_code, ''))), ''), o.country_code),
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), o.name)
  where o.id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$$;

comment on function public.save_business_profile(uuid, public.business_type, text, text, text) is
  'Owner/manager-only partial update of the business identity fields. Every argument is optional and NULL means "leave unchanged", so a resumable wizard can save one step without clearing another.';

revoke execute on function public.save_business_profile(uuid, public.business_type, text, text, text) from public, anon;
grant execute on function public.save_business_profile(uuid, public.business_type, text, text, text) to authenticated;

-- ensure_owner_professional ---------------------------------------------------
-- A solo professional IS the business, and a shop owner very often takes
-- clients too. handle_new_membership already created their staff_profiles
-- row, but with location_id null and no `barbers` row — so they are not
-- bookable and do not satisfy readiness. This makes that one call,
-- idempotently, without inventing a second way to create staff.
create or replace function public.ensure_owner_professional(
  p_organization_id uuid,
  p_location_id uuid,
  p_display_name text default null,
  p_title text default null,
  p_bio text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_staff_profile_id uuid;
  v_barber_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set themselves up as a professional'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, title, bio)
  values (
    p_organization_id, v_user_id, p_location_id,
    coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), 'Professional'),
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_bio, '')), '')
  )
  on conflict (organization_id, user_id) do update set
    location_id = coalesce(excluded.location_id, public.staff_profiles.location_id),
    display_name = coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), public.staff_profiles.display_name),
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), public.staff_profiles.title),
    bio = coalesce(nullif(btrim(coalesce(p_bio, '')), ''), public.staff_profiles.bio),
    is_active = true,
    is_public = true
  returning id into v_staff_profile_id;

  select b.id into v_barber_id
    from public.barbers b where b.staff_profile_id = v_staff_profile_id;

  if v_barber_id is null then
    insert into public.barbers (organization_id, staff_profile_id, is_bookable)
    values (p_organization_id, v_staff_profile_id, true)
    returning id into v_barber_id;
  else
    update public.barbers set is_bookable = true where id = v_barber_id;
  end if;

  return v_barber_id;
end;
$$;

comment on function public.ensure_owner_professional(uuid, uuid, text, text, text) is
  'Idempotently makes the calling owner/manager a bookable professional at a location: upserts their staff_profiles row (never blanking a field the caller omitted) and ensures a bookable barbers row. Returns the barber id. Running it twice produces one professional, not two.';

revoke execute on function public.ensure_owner_professional(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.ensure_owner_professional(uuid, uuid, text, text, text) to authenticated;

-- apply_starter_services -------------------------------------------------------
-- Templates are INITIALIZERS, never a locked catalog. Matching on
-- lower(btrim(name)) per organization is what makes a resumed or re-run
-- onboarding produce one "Haircut" rather than three — the audit's explicit
-- requirement. A service the owner renamed afterwards simply stops matching
-- and is left alone, which is the correct behaviour: their edit wins.
create or replace function public.apply_starter_services(
  p_organization_id uuid,
  p_location_id uuid,
  p_services jsonb,
  p_barber_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_duration integer;
  v_price integer;
  v_service_id uuid;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may create services'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  if jsonb_typeof(p_services) <> 'array' then
    raise exception 'p_services must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_services)
  loop
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_duration := nullif(v_item ->> 'duration_minutes', '')::integer;
    v_price := nullif(v_item ->> 'price_cents', '')::integer;

    if v_name is null then
      raise exception 'every starter service needs a name';
    end if;
    if v_duration is null or v_duration <= 0 then
      raise exception 'service "%" needs a positive duration', v_name;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'service "%" needs a price of zero or more', v_name;
    end if;

    select s.id into v_service_id
      from public.services s
      where s.organization_id = p_organization_id
        and lower(btrim(s.name)) = lower(v_name)
      limit 1;

    if v_service_id is null then
      insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
      values (p_organization_id, v_name, v_duration, v_price, true)
      returning id into v_service_id;
    else
      update public.services
        set duration_minutes = v_duration, price_cents = v_price, is_active = true
        where id = v_service_id;
    end if;

    insert into public.service_locations (organization_id, service_id, location_id)
    values (p_organization_id, v_service_id, p_location_id)
    on conflict do nothing;

    if p_barber_id is not null then
      insert into public.barber_services (organization_id, barber_id, service_id)
      values (p_organization_id, p_barber_id, v_service_id)
      on conflict do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.apply_starter_services(uuid, uuid, jsonb, uuid) is
  'Idempotently creates or updates a set of services from the onboarding template and links them to a location (and optionally a professional). Matches existing services on lower(trimmed name) per organization, so resuming or re-running onboarding never duplicates a service. Templates are initializers — everything stays editable through the normal services screen afterwards.';

revoke execute on function public.apply_starter_services(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.apply_starter_services(uuid, uuid, jsonb, uuid) to authenticated;

-- apply_weekly_hours -----------------------------------------------------------
-- One call sets a whole week for a location and/or a professional, upserting
-- on the existing (location_id, day_of_week) / (barber_id, day_of_week)
-- unique constraints so a resumed step overwrites rather than conflicts.
create or replace function public.apply_weekly_hours(
  p_organization_id uuid,
  p_location_id uuid default null,
  p_barber_id uuid default null,
  p_days jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_dow smallint;
  v_closed boolean;
  v_open time;
  v_close time;
  v_count integer := 0;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may set hours'
      using errcode = '42501';
  end if;

  if p_location_id is null and p_barber_id is null then
    raise exception 'pass a location, a professional, or both';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations l where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization';
  end if;

  if p_barber_id is not null and not exists (
    select 1 from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception 'professional does not belong to this organization';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    v_dow := (v_item ->> 'day_of_week')::smallint;
    v_closed := coalesce((v_item ->> 'is_closed')::boolean, (v_item ->> 'is_off')::boolean, false);
    v_open := nullif(v_item ->> 'open_time', '')::time;
    v_close := nullif(v_item ->> 'close_time', '')::time;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'day_of_week must be 0 (Sunday) through 6 (Saturday)';
    end if;
    if not v_closed and (v_open is null or v_close is null or v_open >= v_close) then
      raise exception 'an open day needs open_time earlier than close_time';
    end if;

    if p_location_id is not null then
      insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
      values (p_organization_id, p_location_id, v_dow, v_closed,
              case when v_closed then null else v_open end,
              case when v_closed then null else v_close end)
      on conflict (location_id, day_of_week) do update set
        is_closed = excluded.is_closed,
        open_time = excluded.open_time,
        close_time = excluded.close_time;
    end if;

    if p_barber_id is not null then
      insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
      values (p_organization_id, p_barber_id, v_dow, v_closed,
              case when v_closed then null else v_open end,
              case when v_closed then null else v_close end)
      on conflict (barber_id, day_of_week) do update set
        is_off = excluded.is_off,
        start_time = excluded.start_time,
        end_time = excluded.end_time;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) is
  'Upserts a whole week of opening hours for a location and/or working hours for a professional in one call. Idempotent via the existing (location_id, day_of_week) / (barber_id, day_of_week) unique constraints. Still one window per day — split shifts and lunch closures are a separate, deliberate schema change, not something to fake here.';

revoke execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_weekly_hours(uuid, uuid, uuid, jsonb) to authenticated;

-- complete_onboarding ----------------------------------------------------------
create or replace function public.complete_onboarding(p_organization_id uuid, p_publish boolean default false)
returns table (
  ready_to_book boolean,
  ready_to_publish boolean,
  is_published boolean,
  missing_requirements text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or manager may complete onboarding'
      using errcode = '42501';
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);

  if r.ready_to_book then
    update public.organizations
      set onboarding_completed_at = coalesce(onboarding_completed_at, now())
      where id = p_organization_id;
  end if;

  -- Publishing goes through the same column the gate trigger watches, so an
  -- unready organization raises here exactly as it would from anywhere else.
  if p_publish and r.ready_to_publish then
    update public.organizations set marketplace_visible = true where id = p_organization_id;
  end if;

  select * into r from public.get_organization_readiness(p_organization_id);
  return query select r.ready_to_book, r.ready_to_publish, r.is_published, r.missing_requirements;
end;
$$;

comment on function public.complete_onboarding(uuid, boolean) is
  'Stamps onboarding_completed_at once the organization is genuinely bookable, and optionally publishes it when it is genuinely publishable. Never forces either: an incomplete organization gets its honest readiness report back instead of a stamp it has not earned.';

revoke execute on function public.complete_onboarding(uuid, boolean) from public, anon;
grant execute on function public.complete_onboarding(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. review_professional_application — stop discarding the applicant's address
--
--    Redefined here rather than patched in place. Everything that made the
--    original correct is preserved VERBATIM: the `for update` row lock that
--    makes a double-clicked Approve a harmless no-op, the idempotent
--    already-decided return, the slug-collision loop, the
--    fadeup.skip_org_owner_membership suppression that makes the APPLICANT
--    the owner rather than the reviewing platform admin, the in-transaction
--    email_outbox enqueue, and the platform_audit_log entry.
--
--    Three things are added:
--      * fadeup.org_creation_authorized for the LOT A guard trigger;
--      * a first location built from the address already on the application,
--        with a timezone suggested from its country (falling back to the
--        pre-existing 'UTC' default rather than guessing);
--      * business_type/country_code/currency seeded from the application's
--        professional_type and country, so onboarding starts pre-filled
--        instead of blank. Every one of these stays editable afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_application(
  p_application_id uuid,
  p_decision text,
  p_rejection_reason text default null,
  p_internal_note text default null
)
returns public.professional_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviewer uuid;
  v_application public.professional_applications;
  v_org public.organizations;
  v_slug text;
  v_slug_base text;
  v_suffix integer := 0;
  v_country text;
  v_timezone text;
  v_business_type public.business_type;
  v_location_id uuid;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional applications';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;

  -- Row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a status that is no longer pending and returns without
  -- repeating any side effect.
  select * into v_application
    from public.professional_applications a
    where a.id = p_application_id
    for update;

  if not found then
    raise exception 'application not found';
  end if;

  if v_application.status <> 'pending_review' then
    return v_application;
  end if;

  if p_decision = 'reject' then
    update public.professional_applications a
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = v_reviewer,
          rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
          internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
      where a.id = v_application.id
      returning * into v_application;

    insert into public.email_outbox (to_email, template, payload)
    values (
      v_application.email,
      'professional_application_rejected',
      jsonb_build_object(
        'business_name', v_application.business_name,
        'first_name', v_application.first_name,
        'rejection_reason', v_application.rejection_reason
      )
    );

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_reviewer, 'professional_application_rejected', 'professional_applications', v_application.id,
      jsonb_build_object('business_name', v_application.business_name, 'has_reason', v_application.rejection_reason is not null)
    );

    return v_application;
  end if;

  -- ---- approve ----------------------------------------------------------
  v_slug_base := regexp_replace(lower(btrim(v_application.business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(regexp_replace(v_slug_base, '(^-+)|(-+$)', '', 'g'), '-');
  if v_slug_base = '' then
    v_slug_base := 'shop';
  end if;
  v_slug_base := left(v_slug_base, 40);
  v_slug := v_slug_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;

  v_country := nullif(btrim(upper(coalesce(v_application.country, ''))), '');
  if v_country is not null and char_length(v_country) <> 2 then
    -- The application form accepts free text; only a clean alpha-2 code is
    -- trustworthy enough to drive a timezone. Anything else is left for
    -- onboarding to ask about rather than guessed at.
    v_country := null;
  end if;

  -- professional_type is the applicant's own description of their business
  -- and maps cleanly onto the two solo shapes; barbershop maps to barbershop.
  -- Anything a salon-shaped applicant needs is chosen in onboarding step 1,
  -- which is why an unmapped type is left NULL rather than defaulted.
  v_business_type := case v_application.professional_type
    when 'barbershop' then 'barbershop'::public.business_type
    when 'independent_barber' then 'solo_professional'::public.business_type
    when 'private_studio' then 'solo_professional'::public.business_type
    when 'mobile_barber' then 'solo_professional'::public.business_type
    else null
  end;

  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug, business_type, country_code, currency)
  values (
    v_application.business_name,
    v_slug,
    v_business_type,
    v_country,
    public.suggested_currency_for_country(v_country)
  )
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- First location, from data the applicant already gave us. Creating it
  -- here is what stops an approved shop from starting with zero locations
  -- and the owner retyping an address FadeUp already holds.
  v_timezone := coalesce(public.suggested_timezone_for_country(v_country), 'UTC');
  insert into public.locations (
    organization_id, name, address_line1, city, postal_code, country, timezone
  )
  values (
    v_org.id,
    v_application.business_name,
    nullif(btrim(coalesce(v_application.address_line1, '')), ''),
    nullif(btrim(coalesce(v_application.city, '')), ''),
    nullif(btrim(coalesce(v_application.postal_code, '')), ''),
    v_country,
    v_timezone
  )
  returning id into v_location_id;

  update public.professional_applications a
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_reviewer,
        organization_id = v_org.id,
        internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
    where a.id = v_application.id
    returning * into v_application;

  insert into public.email_outbox (to_email, template, payload)
  values (
    v_application.email,
    'professional_application_approved',
    jsonb_build_object(
      'business_name', v_application.business_name,
      'first_name', v_application.first_name
    )
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_reviewer, 'professional_application_approved', 'professional_applications', v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'organization_id', v_org.id,
      'organization_slug', v_org.slug,
      'location_id', v_location_id
    )
  );

  return v_application;
end;
$$;

comment on function public.review_professional_application(uuid, text, text, text) is
  'Platform-admin-only approve/reject. Approving creates the organization, makes the APPLICANT its owner (never the reviewer), creates the first location from the address already on the application, seeds business_type/country/currency, records the audit event and queues the applicant email — all in one transaction. Idempotent: reviewing an already-decided application returns it unchanged with no repeated side effects. Never grants any platform role.';

revoke execute on function public.review_professional_application(uuid, text, text, text) from public, anon;
grant execute on function public.review_professional_application(uuid, text, text, text) to authenticated;


-- ============================================================================
-- END db/migrations/20260818220000_business_profile_and_onboarding.sql
-- ============================================================================

commit;

-- ============================================================================
-- Applied. Next step: run
--   supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql
-- and confirm 0 unexpected FAIL rows.
-- ============================================================================
