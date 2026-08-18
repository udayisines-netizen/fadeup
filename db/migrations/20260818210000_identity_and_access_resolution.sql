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
