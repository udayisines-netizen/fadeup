-- FadeUp — B1 chantier 5, rollback.
--
-- Removes presence proof: the QR token, the three queue thresholds, the
-- capacity helpers, the service-area queue refusal, and the three new
-- arguments of join_public_queue.
--
-- BE CLEAR ABOUT WHAT THIS RESTORES: anyone, anywhere, can join any queue in
-- the product again, from a script, with no token and no position. That is the
-- defect chantier 5 exists to close. Only run this if the B1 implementation
-- itself is the suspect.
--
-- DATA CONSEQUENCE. Queue entries admitted under the geofence are ordinary
-- rows and are left exactly as they are; nothing is deleted. The per-
-- establishment threshold values and every QR token are DROPPED with their
-- columns and are not recoverable — re-applying the migration issues fresh
-- tokens, so every printed QR code in every shop becomes invalid. Reprint
-- before doing this in anger.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- 1. The pre-B1 join door, six arguments and no presence check.
drop function if exists public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision);

create function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null
)
returns table (id uuid, status public.queue_status, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $jpq$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active
  ) then
    raise exception 'location is not available';
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
  ) then
    raise exception 'requested barber is not available';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$jpq$;

revoke all on function public.join_public_queue(text, uuid, text, text, uuid, uuid) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) to anon, authenticated, service_role;

-- 2. The professional-side RPCs go with it.
drop function if exists public.get_location_queue_check_in(uuid);
drop function if exists public.regenerate_location_queue_check_in_token(uuid);

-- 3. queue_admission_allowed without the service-area clause (the chantier 2
--    version, which is what chantier 5 replaced).
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
    and (select s.queue_open from private.location_service_settings_effective(p_location_id) s),
    false
  );
$$;

-- 4. The capacity helpers.
drop function if exists private.queue_capacity(uuid, uuid);
drop function if exists private.queue_waiting_count(uuid, uuid);

-- 5. The thresholds.
alter table public.location_service_settings
  drop constraint if exists location_service_settings_queue_thresholds_range;

alter table public.location_service_settings
  drop column if exists queue_capacity_per_barber,
  drop column if exists queue_call_grace_minutes,
  drop column if exists queue_geofence_meters;

-- 6. The QR token.
drop index if exists public.locations_queue_check_in_token_unique;

alter table public.locations
  drop constraint if exists locations_queue_check_in_token_shape;

alter table public.locations
  drop column if exists queue_check_in_token;

commit;
