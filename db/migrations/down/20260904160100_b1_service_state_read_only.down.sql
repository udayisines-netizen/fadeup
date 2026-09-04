-- FadeUp — B1 chantier 2, rollback.
--
-- Restores the four function bodies as they stood before B1, including the
-- perform private.ensure_location_service_settings(...) calls inside the two
-- STABLE readers.
--
-- BE CLEAR ABOUT WHAT THIS RESTORES: it puts the 405 back.
-- get_public_service_state will again answer
-- "cannot execute INSERT in a read-only transaction" to every caller arriving
-- through PostgREST, and get_service_mode_state will do the same as soon as
-- anything calls it over HTTP. Only run this if the B1 rewrite itself is the
-- suspect; it is not a mitigation for anything else.
--
-- No data is touched. Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

create or replace function private.effective_service_mode(p_location_id uuid, p_barber_id uuid default null)
returns table (mode public.service_mode, source text, starts_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select 1 as precedence,
           o.mode,
           'barber_temporary_override'::text as source,
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where p_barber_id is not null
      and o.scope = 'barber'
      and o.barber_id = p_barber_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    select 2,
           o.mode,
           'location_temporary_override',
           o.starts_at,
           o.expires_at
    from public.service_mode_overrides o
    where o.scope = 'location'
      and o.location_id = p_location_id
      and o.cleared_at is null
      and o.starts_at <= now()
      and (o.expires_at is null or o.expires_at > now())

    union all

    select 3,
           b.service_mode_override,
           'barber_override',
           null::timestamptz,
           null::timestamptz
    from public.barbers b
    where p_barber_id is not null
      and b.id = p_barber_id
      and b.service_mode_override is not null

    union all

    select 4,
           s.default_service_mode,
           'location_default',
           null::timestamptz,
           null::timestamptz
    from public.location_service_settings s
    where s.location_id = p_location_id
  )
  select c.mode, c.source, c.starts_at, c.expires_at
  from candidates c
  order by c.precedence
  limit 1;
$$;

create or replace function private.queue_admission_allowed(p_organization_id uuid, p_location_id uuid, p_barber_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      private.org_has_capability(p_organization_id, 'walkIns')
      or private.org_has_capability(p_organization_id, 'liveQueue')
    )
    and private.mode_allows_queue((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m))
    and (select s.queue_open from public.location_service_settings s where s.location_id = p_location_id),
    false
  );
$$;

create or replace function public.get_public_service_state(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid default null
)
returns table (
  location_id uuid,
  barber_id uuid,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_expires_at timestamptz,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  queue_open boolean,
  queue_accepting_new_entries boolean,
  booking_accepting_new_entries boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_mode public.service_mode;
  v_source text;
  v_expires_at timestamptz;
  v_queue_open boolean;
begin
  select o.id into v_organization_id
  from public.organizations o
  where o.slug = p_organization_slug;
  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id
      and l.organization_id = v_organization_id
      and l.is_active
  ) then
    return;
  end if;

  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    return;
  end if;

  perform private.ensure_location_service_settings(p_location_id);

  select m.mode, m.source, m.expires_at
    into v_mode, v_source, v_expires_at
  from private.effective_service_mode(p_location_id, p_barber_id) m;

  select s.queue_open into v_queue_open
  from public.location_service_settings s
  where s.location_id = p_location_id;

  return query
  select
    p_location_id,
    p_barber_id,
    v_mode,
    v_source,
    v_expires_at,
    coalesce(private.mode_allows_booking(v_mode), false),
    coalesce(private.mode_allows_queue(v_mode), false),
    coalesce(v_queue_open, false),
    private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id),
    private.booking_admission_allowed(v_organization_id, p_location_id, p_barber_id);
end;
$$;

comment on function public.get_public_service_state(text, uuid, uuid) is null;

create or replace function public.get_service_mode_state(p_location_id uuid)
returns table (
  scope public.service_mode_scope,
  barber_id uuid,
  barber_display_name text,
  location_default_service_mode public.service_mode,
  barber_service_mode_override public.service_mode,
  effective_service_mode public.service_mode,
  mode_source text,
  mode_starts_at timestamptz,
  mode_expires_at timestamptz,
  queue_open boolean,
  mode_allows_booking boolean,
  mode_allows_queue boolean,
  booking_accepting_new_entries boolean,
  queue_accepting_new_entries boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select l.organization_id into v_organization_id
  from public.locations l
  where l.id = p_location_id;
  if not found then
    return;
  end if;

  if not (
    (select private.is_org_member(v_organization_id))
    or (select private.is_platform_admin())
  ) then
    return;
  end if;

  perform private.ensure_location_service_settings(p_location_id);

  return query
  select
    'location'::public.service_mode_scope,
    null::uuid,
    null::text,
    s.default_service_mode,
    null::public.service_mode,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, null),
    private.queue_admission_allowed(v_organization_id, p_location_id, null)
  from public.location_service_settings s
  cross join lateral private.effective_service_mode(p_location_id, null) m
  where s.location_id = p_location_id;

  return query
  select
    'barber'::public.service_mode_scope,
    b.id,
    sp.display_name,
    s.default_service_mode,
    b.service_mode_override,
    m.mode,
    m.source,
    m.starts_at,
    m.expires_at,
    s.queue_open,
    coalesce(private.mode_allows_booking(m.mode), false),
    coalesce(private.mode_allows_queue(m.mode), false),
    private.booking_admission_allowed(v_organization_id, p_location_id, b.id),
    private.queue_admission_allowed(v_organization_id, p_location_id, b.id)
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  join public.location_service_settings s on s.location_id = p_location_id
  cross join lateral private.effective_service_mode(p_location_id, b.id) m
  where b.organization_id = v_organization_id
    and sp.location_id = p_location_id
  order by 3;
end;
$$;

comment on function public.get_service_mode_state(uuid) is null;

drop function if exists private.location_service_settings_effective(uuid);

commit;
