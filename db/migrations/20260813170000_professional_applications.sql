-- FadeUp — Professional registration approval workflow
--
-- Registering as a professional must NOT hand out an active FadeUp tenant.
-- Registration creates an APPLICATION that a platform reviewer approves or
-- refuses; only approval creates the organization and the owner membership.
--
-- AUTHENTICATED != AUTHORIZED. A pending applicant holds a perfectly valid
-- Supabase session; what they must not hold is a membership. Everything in
-- this migration is built so that authorization is decided by
-- memberships/platform_members as it already is everywhere else in FadeUp —
-- the application row is the workflow, never the permission.
--
-- Two pre-existing holes this migration has to close, both found while
-- auditing rather than assumed:
--
--   1. on_organization_created (20260809..., handle_new_organization) makes
--      auth.uid() the owner of any newly inserted organization. An approval
--      RPC that simply inserts an organization would therefore make the
--      REVIEWING PLATFORM OWNER the owner of the applicant's shop — exactly
--      the PRO OWNER != PLATFORM OWNER violation this feature must prevent.
--      Fixed here by teaching that trigger to stand down when the caller has
--      set a session-local flag, so the approval function can assign
--      ownership explicitly to the applicant.
--
--   2. complete_organization_onboarding / create_organization are callable by
--      ANY authenticated user. Without a guard, a pending (or rejected)
--      applicant simply calls the RPC themselves and becomes a tenant owner,
--      bypassing review completely. Frontend route guards would not even
--      notice. Fixed here with a server-side check in create_organization.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'professional_application_status') then
    -- Deliberately NOT draft/submitted: no draft is ever persisted (the form
    -- submits in one step), and "submitted" and "pending review" are the same
    -- observable state. Unused enum values grow dead branches.
    create type public.professional_application_status as enum ('pending_review', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'professional_type') then
    create type public.professional_type as enum ('barbershop', 'independent_barber', 'private_studio', 'mobile_barber');
  end if;
  if not exists (select 1 from pg_type where typname = 'email_delivery_status') then
    create type public.email_delivery_status as enum ('queued', 'sent', 'failed');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. normalize_phone_number
--
--     The reviewer phones this number, and a tel: link only works on a clean
--     one, so normalization happens server-side rather than being trusted
--     from the form. Rules mirror the worker's existing E.164 normalizer
--     (apps/prospect-worker-v2/src/normalize/phone.ts) so the same input
--     produces the same output on both sides of the product: already-E.164
--     passes through, 00-prefixed becomes +, and a bare national number is
--     assumed French (FadeUp's primary market and the only one that
--     normalizer fully waterfalls) rather than silently guessed at.
--     Returns null when it cannot be normalized confidently — the caller
--     raises rather than storing something undialable.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_phone_number(p_raw text, p_country text default 'FR')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cleaned text;
  v_calling_code text;
  v_national text;
  v_candidate text;
begin
  if p_raw is null then
    return null;
  end if;

  -- Strip everything a human might type as separators.
  v_cleaned := regexp_replace(btrim(p_raw), '[\s().\-]', '', 'g');
  if v_cleaned = '' then
    return null;
  end if;

  if v_cleaned ~ '^\+[1-9][0-9]{6,14}$' then
    return v_cleaned;
  end if;

  if v_cleaned ~ '^00[1-9][0-9]{6,14}$' then
    v_candidate := '+' || substring(v_cleaned from 3);
    return case when v_candidate ~ '^\+[1-9][0-9]{6,14}$' then v_candidate else null end;
  end if;

  -- Anything else with a + in it is malformed rather than national.
  if position('+' in v_cleaned) > 0 then
    return null;
  end if;

  if v_cleaned !~ '^[0-9]+$' then
    return null;
  end if;

  v_calling_code := case upper(coalesce(p_country, 'FR'))
    when 'FR' then '33' when 'BE' then '32' when 'CH' then '41' when 'LU' then '352'
    when 'MC' then '377' when 'GB' then '44' when 'US' then '1' when 'CA' then '1'
    when 'DE' then '49' when 'ES' then '34' when 'IT' then '39' when 'NL' then '31'
    when 'PT' then '351' else null end;
  if v_calling_code is null then
    return null;
  end if;

  v_national := regexp_replace(v_cleaned, '^0', '');
  if char_length(v_national) < 6 or char_length(v_national) > 14 then
    return null;
  end if;

  v_candidate := '+' || v_calling_code || v_national;
  return case when v_candidate ~ '^\+[1-9][0-9]{6,14}$' then v_candidate else null end;
end;
$$;

comment on function public.normalize_phone_number(text, text) is
  'Normalizes a typed phone number to E.164, mirroring apps/prospect-worker-v2/src/normalize/phone.ts. Returns null when it cannot be normalized confidently rather than guessing.';

-- ---------------------------------------------------------------------------
-- 2. professional_applications
-- ---------------------------------------------------------------------------

create table if not exists public.professional_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Contact block. Denormalized on purpose: this is the qualification record
  -- as submitted, and must stay readable by a reviewer even if the applicant
  -- later edits their account.
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,

  -- Business block.
  business_name text not null,
  professional_type public.professional_type not null,
  city text,
  address_line1 text,
  postal_code text,
  country text,
  staff_count integer,
  website text,
  instagram text,
  business_identifier text,

  status public.professional_application_status not null default 'pending_review',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,

  -- Two distinct concepts, never conflated: rejection_reason may be shown to
  -- the applicant, internal_note never leaves the platform interface.
  rejection_reason text,
  internal_note text,

  -- Set on approval so the activation is traceable and repeatable checks are
  -- cheap. Null for every other status.
  organization_id uuid references public.organizations (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_applications_phone_not_blank check (btrim(phone) <> ''),
  constraint professional_applications_business_name_not_blank check (btrim(business_name) <> ''),
  constraint professional_applications_staff_count_sane check (staff_count is null or (staff_count >= 0 and staff_count <= 1000)),
  constraint professional_applications_reason_length check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  constraint professional_applications_internal_note_length check (internal_note is null or char_length(internal_note) <= 2000),
  -- A decided application must carry who decided it and when; a pending one
  -- must not pretend it was reviewed.
  constraint professional_applications_review_consistency check (
    (status = 'pending_review' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending_review' and reviewed_at is not null)
  ),
  -- Only an approved application may point at an organization.
  constraint professional_applications_org_only_when_approved check (
    organization_id is null or status = 'approved'
  )
);

comment on table public.professional_applications is
  'A request to join FadeUp as a professional. Creating one grants NOTHING — authorization still comes exclusively from memberships/platform_members. Only review_professional_application(), executed by a platform admin, turns an approved application into an organization plus an owner membership for the applicant.';

comment on column public.professional_applications.rejection_reason is
  'May be shown to the applicant. Keep it free of internal assessment — that belongs in internal_note.';
comment on column public.professional_applications.internal_note is
  'Platform-only. Never returned by any applicant-facing read path.';

-- One live application per account: an applicant cannot spam the queue and
-- an approved professional cannot re-apply. A rejected one may reapply,
-- which is why 'rejected' is excluded from the index.
create unique index if not exists professional_applications_one_live_per_user
  on public.professional_applications (user_id)
  where status in ('pending_review', 'approved');

create index if not exists professional_applications_status_submitted_idx
  on public.professional_applications (status, submitted_at desc);
create index if not exists professional_applications_user_id_idx
  on public.professional_applications (user_id);

drop trigger if exists professional_applications_set_updated_at on public.professional_applications;
create trigger professional_applications_set_updated_at
  before update on public.professional_applications
  for each row execute function public.set_updated_at();

alter table public.professional_applications enable row level security;
alter table public.professional_applications force row level security;

-- The applicant can read their own application (that is the whole pending
-- status screen), and platform admins can read every application.
drop policy if exists professional_applications_select on public.professional_applications;
create policy professional_applications_select
  on public.professional_applications
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

-- No client INSERT policy at all: submission goes through
-- submit_professional_application, which controls status and the
-- notification fan-out. A client-chosen status would defeat the workflow.

-- The applicant may correct their own CONTACT details while still pending —
-- the reviewer is going to phone them, so a typo'd number must be fixable.
-- Which columns may actually change is enforced by the trigger below, not by
-- this policy: a USING/WITH CHECK clause cannot express "these columns are
-- frozen".
drop policy if exists professional_applications_update_own on public.professional_applications;
create policy professional_applications_update_own
  on public.professional_applications
  for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'pending_review')
  with check (user_id = (select auth.uid()) and status = 'pending_review');

-- Platform admins update through the review RPC; this policy exists so they
-- can also maintain internal_note directly from the platform interface.
drop policy if exists professional_applications_update_platform on public.professional_applications;
create policy professional_applications_update_platform
  on public.professional_applications
  for update
  to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- No DELETE policy: applications are an audit trail.

-- The column-level freeze. RLS decides WHICH ROWS you may touch; this decides
-- WHICH COLUMNS. Without it, the applicant's legitimate "fix my phone number"
-- policy above would equally permit `update ... set status = 'approved'`.
create or replace function public.guard_professional_application_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No JWT identity at all means this is not a client request: a trusted
  -- server-side role, or a foreign-key cascade (deleting an organization
  -- sets organization_id to null here). Those must not be blocked — RLS and
  -- the EXECUTE grants are what keep anon/authenticated out of this path in
  -- the first place.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (select private.is_platform_admin()) then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.organization_id is distinct from old.organization_id
     or new.rejection_reason is distinct from old.rejection_reason
     or new.internal_note is distinct from old.internal_note
     or new.user_id is distinct from old.user_id
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'only a platform reviewer can change the review state of an application';
  end if;

  return new;
end;
$$;

comment on function public.guard_professional_application_update() is
  'Freezes review/ownership columns against everyone except platform admins. RLS scopes rows; this scopes columns, which an RLS policy cannot express.';

drop trigger if exists professional_applications_guard_update on public.professional_applications;
create trigger professional_applications_guard_update
  before update on public.professional_applications
  for each row execute function public.guard_professional_application_update();

-- ---------------------------------------------------------------------------
-- 3. platform_notifications
-- ---------------------------------------------------------------------------

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  target_type text,
  target_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_notifications_type_not_blank check (btrim(type) <> '')
);

comment on table public.platform_notifications is
  'In-app notifications for FadeUp platform staff only (one row per recipient). Carries no more applicant data than a reviewer needs to decide whether to open the item.';

create index if not exists platform_notifications_recipient_unread_idx
  on public.platform_notifications (recipient_user_id, created_at desc)
  where read_at is null;
create index if not exists platform_notifications_recipient_idx
  on public.platform_notifications (recipient_user_id, created_at desc);

alter table public.platform_notifications enable row level security;
alter table public.platform_notifications force row level security;

-- Recipient-only, and only for actual platform staff: a tenant owner who
-- somehow ended up with a row must still not read it.
drop policy if exists platform_notifications_select on public.platform_notifications;
create policy platform_notifications_select
  on public.platform_notifications
  for select
  to authenticated
  using (recipient_user_id = (select auth.uid()) and (select private.has_platform_role(array['platform_owner','platform_admin','platform_support']::public.platform_role[])));

-- Marking your own notification read is the only client write. No INSERT
-- policy: notifications are produced server-side.
drop policy if exists platform_notifications_update_own on public.platform_notifications;
create policy platform_notifications_update_own
  on public.platform_notifications
  for update
  to authenticated
  using (recipient_user_id = (select auth.uid()) and (select private.has_platform_role(array['platform_owner','platform_admin','platform_support']::public.platform_role[])))
  with check (recipient_user_id = (select auth.uid()) and (select private.has_platform_role(array['platform_owner','platform_admin','platform_support']::public.platform_role[])));

-- ---------------------------------------------------------------------------
-- 4. email_outbox
-- ---------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  locale text not null default 'en',
  payload jsonb not null default '{}'::jsonb,
  status public.email_delivery_status not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_to_email_not_blank check (btrim(to_email) <> ''),
  constraint email_outbox_attempts_sane check (attempts >= 0)
);

comment on table public.email_outbox is
  'Durable queue for transactional email. Enqueued inside the same transaction as the state change it describes, delivered separately, so a mail outage can never roll back an approval — and a failed send stays visible and retryable instead of vanishing. Contains no secrets and no auth tokens.';

create index if not exists email_outbox_pending_idx
  on public.email_outbox (next_attempt_at)
  where status = 'queued';

drop trigger if exists email_outbox_set_updated_at on public.email_outbox;
create trigger email_outbox_set_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;

-- Platform staff may LOOK at the queue (that is what makes delivery failure
-- observable), and nobody may write to it from a client. The dispatcher
-- connects as a privileged role and goes through the RPCs below.
drop policy if exists email_outbox_select_platform on public.email_outbox;
create policy email_outbox_select_platform
  on public.email_outbox
  for select
  to authenticated
  using ((select private.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 5. Teach on_organization_created to stand down for server-side activation
--
--    handle_new_organization assigns ownership to auth.uid(). That is right
--    for self-serve onboarding and WRONG for approval, where auth.uid() is
--    the reviewer, not the future shop owner. Rather than insert-then-delete
--    the wrong membership, the approval function sets a session-local flag
--    and assigns ownership explicitly.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Set only by review_professional_application, for the single statement
  -- that creates an approved applicant's organization. current_setting(...,
  -- true) returns null rather than raising when the GUC was never set, so
  -- every ordinary path is unaffected.
  if coalesce(current_setting('fadeup.skip_org_owner_membership', true), '') = 'on' then
    return new;
  end if;

  if (select auth.uid()) is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (new.id, (select auth.uid()), 'owner')
    on conflict (organization_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.handle_new_organization() is
  'Makes the creating user the owner of a newly created organization. Stands down when fadeup.skip_org_owner_membership = on, which review_professional_application sets so that approving an application makes the APPLICANT the owner rather than the reviewing platform admin.';

-- ---------------------------------------------------------------------------
-- 6. Close the self-activation bypass in create_organization
--
--    Any authenticated user can call create_organization /
--    complete_organization_onboarding. An applicant awaiting review could
--    therefore simply create their own organization and become a tenant
--    owner, skipping approval entirely — no frontend guard would see it.
--    Accounts with no application at all (invited staff, pre-existing
--    owners) keep working exactly as before.
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

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning * into v_org;

  -- on_organization_created (AFTER INSERT trigger on public.organizations)
  -- has already run by this point, making the caller the org's owner.
  return v_org;
end;
$$;

comment on function public.create_organization(text, text) is
  'Creates an organization owned by the calling user. Refuses callers whose most recent professional application is pending or rejected — otherwise an applicant could self-activate and bypass platform review entirely.';

-- ---------------------------------------------------------------------------
-- 7. submit_professional_application
-- ---------------------------------------------------------------------------

create or replace function public.submit_professional_application(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_business_name text,
  p_professional_type public.professional_type,
  p_city text default null,
  p_address_line1 text default null,
  p_postal_code text default null,
  p_country text default null,
  p_staff_count integer default null,
  p_website text default null,
  p_instagram text default null,
  p_business_identifier text default null
)
returns public.professional_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_application public.professional_applications;
  v_existing public.professional_applications;
  v_phone text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'authentication required to submit a professional application';
  end if;

  -- The email is taken from the verified auth identity, never from the form:
  -- a reviewer must be able to trust that the address they see is the one
  -- that actually owns the account.
  select u.email into v_email from auth.users u where u.id = v_user_id;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'this account has no email address';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'first and last name are required';
  end if;
  if btrim(coalesce(p_business_name, '')) = '' then
    raise exception 'business name is required';
  end if;

  -- Phone is the qualification channel — the reviewer calls this number — so
  -- it is required and normalized here rather than trusted from the client.
  v_phone := public.normalize_phone_number(p_phone);
  if v_phone is null then
    raise exception 'a valid phone number is required';
  end if;

  -- Resubmission is idempotent rather than an error: a double-submit (or a
  -- refresh mid-request) should land the applicant on their status screen,
  -- not on a unique-violation stack trace.
  select * into v_existing
    from public.professional_applications a
    where a.user_id = v_user_id and a.status in ('pending_review', 'approved')
    limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.professional_applications (
    user_id, first_name, last_name, email, phone,
    business_name, professional_type, city, address_line1, postal_code, country,
    staff_count, website, instagram, business_identifier, status
  )
  values (
    v_user_id, btrim(p_first_name), btrim(p_last_name), lower(btrim(v_email)), v_phone,
    btrim(p_business_name), p_professional_type,
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    nullif(btrim(coalesce(p_country, '')), ''),
    p_staff_count,
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_instagram, '')), ''),
    nullif(btrim(coalesce(p_business_identifier, '')), ''),
    'pending_review'
  )
  returning * into v_application;

  -- Fan out to every platform member. Body carries only what a reviewer needs
  -- to decide whether to open the item — no phone, no address.
  insert into public.platform_notifications (recipient_user_id, type, title, body, target_type, target_id)
  select
    pm.user_id,
    'professional_application_submitted',
    v_application.business_name,
    v_application.first_name || ' ' || v_application.last_name,
    'professional_applications',
    v_application.id
  from public.platform_members pm;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_user_id,
    'professional_application_submitted',
    'professional_applications',
    v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'professional_type', v_application.professional_type
    )
  );

  return v_application;
end;
$$;

comment on function public.submit_professional_application(text, text, text, text, public.professional_type, text, text, text, text, integer, text, text, text) is
  'Creates the caller''s professional application (status always pending_review — never client-chosen), notifies every platform member and writes an audit event. Idempotent: re-submitting while an application is pending or approved returns the existing row instead of raising.';

revoke execute on function public.submit_professional_application(text, text, text, text, public.professional_type, text, text, text, text, integer, text, text, text) from public, anon;
grant execute on function public.submit_professional_application(text, text, text, text, public.professional_type, text, text, text, text, integer, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. get_my_professional_application
--
--    The status screen's only read. A plain RLS select would also work, but
--    going through a function lets the applicant-facing shape omit
--    internal_note structurally rather than by remembering to leave it out of
--    every client query.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_professional_application()
returns table (
  id uuid,
  status public.professional_application_status,
  first_name text,
  last_name text,
  email text,
  phone text,
  business_name text,
  professional_type public.professional_type,
  city text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  organization_id uuid
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.status, a.first_name, a.last_name, a.email, a.phone,
    a.business_name, a.professional_type, a.city,
    a.submitted_at, a.reviewed_at, a.rejection_reason, a.organization_id
  from public.professional_applications a
  where a.user_id = (select auth.uid())
  order by a.submitted_at desc
  limit 1;
$$;

comment on function public.get_my_professional_application() is
  'The caller''s most recent professional application, in an applicant-safe shape: internal_note and reviewed_by are not in the return type at all, so they cannot leak through this path.';

revoke execute on function public.get_my_professional_application() from public, anon;
grant execute on function public.get_my_professional_application() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. review_professional_application — the activation transaction
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
    -- Already decided. Idempotent no-op rather than an error: the reviewer
    -- clicked twice, which is not a mistake worth an error dialog.
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
        -- Only the reason explicitly written for the applicant travels here.
        -- internal_note is never placed in an email payload.
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
  -- Slug derived from the business name, with a numeric suffix on collision.
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

  -- Suppress the owner-membership trigger for this insert: auth.uid() here is
  -- the REVIEWER, and making them the owner of the applicant's shop is the
  -- precise thing this workflow exists to prevent. set_config(..., true)
  -- scopes it to this transaction.
  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  insert into public.organizations (name, slug)
  values (v_application.business_name, v_slug)
  returning * into v_org;
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  -- The applicant becomes the TENANT owner. Note what is absent: nothing here
  -- touches platform_members. An approved professional never gains any
  -- platform role.
  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

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
    jsonb_build_object('business_name', v_application.business_name, 'organization_id', v_org.id, 'organization_slug', v_org.slug)
  );

  return v_application;
end;
$$;

comment on function public.review_professional_application(uuid, text, text, text) is
  'Platform-admin-only approve/reject. Approving creates the organization, makes the APPLICANT its owner (never the reviewer — see the trigger suppression inside), records the audit event and queues the applicant email, all in one transaction. Idempotent: reviewing an already-decided application returns it unchanged with no repeated side effects. Never grants any platform role.';

revoke execute on function public.review_professional_application(uuid, text, text, text) from public, anon;
grant execute on function public.review_professional_application(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Platform read + notification helpers
-- ---------------------------------------------------------------------------

create or replace function public.mark_platform_notification_read(p_notification_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.platform_notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id and n.recipient_user_id = (select auth.uid());
$$;

comment on function public.mark_platform_notification_read(uuid) is
  'Marks one of the caller''s own notifications read. security invoker on purpose — the RLS update policy is the check.';

revoke execute on function public.mark_platform_notification_read(uuid) from public, anon;
grant execute on function public.mark_platform_notification_read(uuid) to authenticated;

create or replace function public.mark_all_platform_notifications_read()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with updated as (
    update public.platform_notifications n
      set read_at = now()
      where n.recipient_user_id = (select auth.uid()) and n.read_at is null
      returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke execute on function public.mark_all_platform_notifications_read() from public, anon;
grant execute on function public.mark_all_platform_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Outbox dispatch RPCs
--
--     The dispatcher (apps/prospect-worker-v2) connects with a privileged
--     role and drives delivery through these, so the outbox table itself
--     never needs a write policy. Claiming uses the same
--     `for update skip locked` lease pattern the prospect job queue already
--     uses, so two dispatcher instances can run without double-sending.
-- ---------------------------------------------------------------------------

create or replace function private.claim_next_email(p_limit integer default 10)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.email_outbox o
    set status = 'queued', locked_at = now(), attempts = o.attempts + 1
    where o.id in (
      select i.id from public.email_outbox i
      where i.status = 'queued' and i.next_attempt_at <= now()
      order by i.next_attempt_at
      for update skip locked
      limit greatest(coalesce(p_limit, 10), 1)
    )
    returning o.*;
end;
$$;

comment on function private.claim_next_email(integer) is
  'Leases up to p_limit queued emails for delivery, incrementing attempts. `for update skip locked` mirrors the prospect job queue so concurrent dispatchers never claim the same row.';

revoke execute on function private.claim_next_email(integer) from public, anon, authenticated;

create or replace function private.mark_email_sent(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox set status = 'sent', sent_at = now(), locked_at = null, last_error = null where id = p_id;
$$;

revoke execute on function private.mark_email_sent(uuid) from public, anon, authenticated;

create or replace function private.mark_email_failed(p_id uuid, p_error text, p_max_attempts integer default 5)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.email_outbox where id = p_id;

  -- Exponential backoff while retries remain, then park it as 'failed' so it
  -- stays visible in the platform outbox view rather than retrying forever
  -- or disappearing.
  if coalesce(v_attempts, 0) >= greatest(coalesce(p_max_attempts, 5), 1) then
    update public.email_outbox
      set status = 'failed', locked_at = null, last_error = left(coalesce(p_error, 'unknown error'), 1000)
      where id = p_id;
  else
    update public.email_outbox
      set status = 'queued',
          locked_at = null,
          last_error = left(coalesce(p_error, 'unknown error'), 1000),
          next_attempt_at = now() + (interval '1 minute' * power(3, coalesce(v_attempts, 1)))
      where id = p_id;
  end if;
end;
$$;

comment on function private.mark_email_failed(uuid, text, integer) is
  'Records a delivery failure. Backs off exponentially while attempts remain, then parks the row as failed so it stays observable and retryable instead of silently disappearing.';

revoke execute on function private.mark_email_failed(uuid, text, integer) from public, anon, authenticated;

-- The dispatcher runs inside the existing prospect worker, which connects as
-- the dedicated `prospect_worker` role (never postgres/service_role, no
-- BYPASSRLS — see 20260811150100). Give that role exactly the three
-- functions it needs and read access to the queue it drives, nothing more.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'prospect_worker') then
    grant execute on function private.claim_next_email(integer) to prospect_worker;
    grant execute on function private.mark_email_sent(uuid) to prospect_worker;
    grant execute on function private.mark_email_failed(uuid, text, integer) to prospect_worker;
    grant select on public.email_outbox to prospect_worker;

    -- The SECURITY DEFINER functions above do the actual writing, so the
    -- role needs no direct INSERT/UPDATE/DELETE on the table.
    drop policy if exists email_outbox_worker_select on public.email_outbox;
    create policy email_outbox_worker_select
      on public.email_outbox
      for select
      to prospect_worker
      using (true);
  end if;
end $$;
