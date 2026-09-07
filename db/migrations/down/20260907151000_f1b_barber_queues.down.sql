-- F1b — retour arrière des files par barber.
--
-- Restaure les définitions B1/F1 exactes de get_public_queue_status,
-- get_my_queue_status, join_public_queue et restrict_queue_entry_self_update
-- (corps relevés sur la production le 2026-09-07 avant modification), retire
-- le réglage queue_enabled, la liste publique des files, le déplacement et
-- sa trace.
--
-- ATTENTION : queue_entry_moves est un journal d'audit — ce retrait le
-- jette. Les déplacements passés deviennent introuvables.
--
-- À exécuter APRÈS 20260907154000.down.sql (change_queue_entry_barber écrit
-- dans queue_entry_moves).

set lock_timeout = '5s';

begin;

drop function public.move_queue_entry(uuid, uuid);
drop function private.is_org_barber(uuid);
drop table public.queue_entry_moves;
drop function public.list_public_queues(text, uuid);
drop function public.set_barber_queue_enabled(uuid, boolean);

-- get_public_queue_status : retour au type de retour F1 (sans barber_id).
drop function public.get_public_queue_status(text, uuid);

CREATE OR REPLACE FUNCTION public.get_public_queue_status(p_organization_slug text, p_location_id uuid)
 RETURNS TABLE(id uuid, display_name text, status public.queue_status, queue_position integer, barber_display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    q.id,
    btrim(split_part(q.customer_name, ' ', 1))
      || case when position(' ' in btrim(q.customer_name)) > 0
              then ' ' || left(split_part(q.customer_name, ' ', 2), 1) || '.'
              else '' end as display_name,
    q.status,
    case when q.status = 'waiting' then
      row_number() over (partition by q.status order by q.created_at)::integer
    else null end as queue_position,
    sp.display_name as barber_display_name
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where o.slug = p_organization_slug
    and q.location_id = p_location_id
    and q.status in ('waiting', 'called', 'in_service')
  order by
    case q.status when 'in_service' then 0 when 'called' then 1 else 2 end,
    q.created_at;
$function$;

revoke execute on function public.get_public_queue_status(text, uuid) from public;
grant execute on function public.get_public_queue_status(text, uuid) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_queue_status()
 RETURNS TABLE(id uuid, organization_id uuid, organization_name text, organization_slug text, location_id uuid, location_name text, status public.queue_status, queue_position integer, barber_display_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with waiting_positions as (
    select id, row_number() over (partition by location_id order by created_at) as position
    from public.queue_entries
    where status = 'waiting'
  )
  select
    q.id,
    q.organization_id,
    o.name,
    o.slug,
    q.location_id,
    l.name,
    q.status,
    case when q.status = 'waiting' then wp.position::integer else null end,
    sp.display_name,
    q.created_at
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  join public.locations l on l.id = q.location_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join waiting_positions wp on wp.id = q.id
  where q.status in ('waiting', 'called', 'in_service')
    and q.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  order by q.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.join_public_queue(p_organization_slug text, p_location_id uuid, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_barber_id uuid DEFAULT NULL::uuid, p_service_id uuid DEFAULT NULL::uuid, p_check_in_token text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, status public.queue_status, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
  v_location public.locations;
  v_geofence_meters integer;
  v_distance_meters double precision;
  v_waiting integer;
  v_capacity integer;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.* into v_location
  from public.locations l
  where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;

  if not found then
    raise exception 'location is not available';
  end if;

  if v_location.kind = 'service_area' then
    raise exception 'this professional works in a service area and has no live queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=service_area_has_no_queue',
            hint = 'A live queue is a line of people at an address. Book a slot instead.';
  end if;

  if nullif(btrim(coalesce(p_check_in_token, '')), '') is null
     or lower(btrim(p_check_in_token)) <> v_location.queue_check_in_token then
    raise exception 'the check-in code for this establishment is missing or invalid'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=invalid_check_in_token',
            hint = 'Scan the QR code displayed in the shop.';
  end if;

  if v_location.latitude is null or v_location.longitude is null then
    raise exception 'this establishment has not published its position, so presence cannot be verified'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=location_not_geolocated',
            hint = 'The establishment must set its coordinates before the live queue can admit anyone.';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'your position is required to join the queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=position_required',
            hint = 'Joining a live queue requires being at the shop.';
  end if;

  select s.queue_geofence_meters into v_geofence_meters
  from public.location_service_settings s
  where s.location_id = p_location_id;
  v_geofence_meters := coalesce(v_geofence_meters, 150);

  v_distance_meters := private.point_distance_km(
    p_latitude, p_longitude, v_location.latitude, v_location.longitude
  ) * 1000.0;

  if v_distance_meters is null or v_distance_meters > v_geofence_meters then
    raise exception 'you are too far from this establishment to join its queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=too_far',
            hint = format('The live queue admits customers within %s m.', v_geofence_meters);
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

  if not private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id) then
    raise exception 'this queue is not accepting new entries right now'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_closed';
  end if;

  v_waiting  := private.queue_waiting_count(p_location_id, p_barber_id);
  v_capacity := private.queue_capacity(p_location_id, p_barber_id);
  if v_capacity is not null and v_waiting >= v_capacity then
    raise exception 'this queue is full'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_full',
            hint = format('%s people are already waiting.', v_waiting);
  end if;

  v_user_id := (select auth.uid());

  if v_user_id is not null and exists (
    select 1 from public.queue_entries qe
    where qe.booked_by_user_id = v_user_id
      and qe.status in ('waiting', 'called', 'in_service')
  ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  if v_user_id is null
     and nullif(btrim(coalesce(p_customer_phone, '')), '') is not null
     and exists (
       select 1 from public.queue_entries qe
       where qe.location_id = p_location_id
         and qe.customer_phone = btrim(p_customer_phone)
         and qe.status in ('waiting', 'called', 'in_service')
     ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

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
$function$;

COMMENT ON FUNCTION public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision) IS
  'Anon-callable. Joins the live queue of an establishment, and since B1 requires PROOF OF PRESENCE to do it: the QR token displayed in the shop plus coordinates within the establishment''s geofence (150 m by default, per-salon). Both are verified on the server, so calling the REST API directly is exactly as constrained as using the app. Both are also defeatable by a determined person — a photographed QR, a spoofed position — and nothing downstream should treat a queue entry as evidence that someone was physically present. Refusals carry DETAIL fadeup_queue_refusal=<code>: service_area_has_no_queue, invalid_check_in_token, location_not_geolocated, position_required, too_far, queue_closed, queue_full, already_in_queue.';

CREATE OR REPLACE FUNCTION public.restrict_queue_entry_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$function$;

alter table public.barbers drop column queue_enabled;

commit;
