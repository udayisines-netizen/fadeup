-- P1PRO — retour arrière de la contre-proposition.
--
-- Restaure les définitions d'AVANT P1PRO (copiées verbatim de la production
-- du 2026-09-08), retire les RPC neuves, les colonnes et les gabarits.
-- Perte assumée : l'état de contre-proposition en cours et le marqueur
-- was_request (dérivables ni l'un ni l'autre après coup).
--
-- À exécuter AVANT 20260908030000.down.sql (l'enum reste porté par
-- l'émission de counter_propose tant que ce fichier n'est pas passé).
-- À APPLIQUER EN postgres.

set lock_timeout = '5s';

begin;

-- 1. RPC neuves
drop function if exists public.counter_propose_booking_request(uuid, timestamptz, uuid, text);
drop function if exists public.accept_booking_counter_proposal(uuid);
drop function if exists public.decline_booking_counter_proposal(uuid);
drop function if exists public.get_booking_request_history(uuid, integer);
drop function if exists public.get_public_booking_capabilities(text[]);

-- 2. get_booking_requests — définition d'origine (type de retour d'origine)
drop function if exists public.get_booking_requests(uuid);

create function public.get_booking_requests(p_organization_id uuid)
returns table(
  id uuid, location_id uuid, location_name text, barber_id uuid,
  barber_display_name text, service_id uuid, service_name text,
  duration_minutes integer, price_cents integer, customer_name text,
  customer_phone text, customer_email text, notes text,
  starts_at timestamptz, ends_at timestamptz, expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    a.id, a.location_id, l.name, a.barber_id, sp.display_name,
    a.service_id, s.name,
    (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
    s.price_cents,
    a.customer_name, a.customer_phone, a.customer_email, a.notes,
    a.starts_at, a.ends_at, a.expires_at, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.status = 'pending'
    -- Already past its deadline but not yet swept: showing it would offer an
    -- Accept that confirm_booking_request would then refuse.
    and (a.expires_at is null or a.expires_at > now())
    and (select private.can_manage_appointments(p_organization_id))
  order by a.expires_at nulls last, a.created_at;
$function$;

revoke all on function public.get_booking_requests(uuid) from public;
grant execute on function public.get_booking_requests(uuid) to authenticated, service_role;

-- 3. get_my_appointments — définition d'origine
drop function if exists public.get_my_appointments();

create function public.get_my_appointments()
returns table(
  id uuid, organization_id uuid, organization_name text,
  organization_slug text, location_id uuid, location_name text,
  barber_id uuid, barber_display_name text, service_id uuid,
  service_name text, starts_at timestamptz, ends_at timestamptz,
  status public.appointment_status, price_cents integer, currency text,
  location_timezone text, resolution public.appointment_resolution,
  resolution_note text, expires_at timestamptz, created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    a.id, a.organization_id, o.name, o.slug, a.location_id, l.name,
    a.barber_id, sp.display_name, a.service_id, s.name,
    a.starts_at, a.ends_at, a.status, s.price_cents,
    coalesce(o.currency, 'EUR'),
    -- The shop's timezone travels with the appointment: a customer abroad must
    -- still read the time the salon means, not the one their phone assumes.
    l.timezone,
    a.resolution, a.resolution_note, a.expires_at, a.created_at
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  )
  order by a.starts_at desc;
$function$;

revoke all on function public.get_my_appointments() from public;
grant execute on function public.get_my_appointments() to authenticated, service_role;

-- 4. confirm_booking_request — corps d'origine (OR REPLACE conserve l'ACL)
create or replace function public.confirm_booking_request(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  -- Idempotent: whoever lost the race gets the settled row, not an error and
  -- not a second confirmation.
  if v_appointment.status = 'confirmed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'this request has already been answered' using errcode = '22023';
  end if;

  -- The accept-versus-expire race. The row is locked, so the sweep is either
  -- already done (status is no longer pending, caught above) or is waiting
  -- behind this lock and will find the row confirmed. This check closes the
  -- remaining case: the deadline passed but the sweep has not run yet.
  if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
    raise exception 'this request has expired' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'confirmed',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_confirmed', 'customer',
    'Your appointment is confirmed',
    null, 'booking_confirmed'
  );

  return v_appointment;
end;
$function$;

-- 5. set_appointment_request_expiry — corps d'origine
create or replace function public.set_appointment_request_expiry()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_ttl integer;
begin
  if new.status = 'pending' then
    -- Only derive on the way IN to pending. A row already carrying a deadline
    -- keeps it, so a reschedule or a staff edit never silently extends the
    -- window a customer is already watching count down.
    if new.expires_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'pending') then
      select o.booking_request_ttl_minutes into v_ttl
        from public.organizations o where o.id = new.organization_id;
      new.expires_at := now() + make_interval(mins => coalesce(v_ttl, 1440));
    end if;

    -- A request can never outlive the appointment it is asking for: answering
    -- at 10:05 for a 10:00 slot is not an answer.
    new.expires_at := least(new.expires_at, new.starts_at);
  else
    -- Left pending: there is nothing left to expire. Keeping a stale deadline
    -- would make the sweep and the UI both lie.
    new.expires_at := null;
  end if;

  return new;
end;
$function$;

-- 6. Colonnes
alter table public.appointments
  drop column if exists counter_proposed_at,
  drop column if exists counter_original_starts_at,
  drop column if exists counter_note,
  drop column if exists was_request;

-- 7. Gabarits
delete from public.email_templates where template_key = 'booking_counter_proposed';

commit;
