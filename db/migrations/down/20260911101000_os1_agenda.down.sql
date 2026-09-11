-- OS-1 (2/2) — retour arrière de l'agenda : forçage, réservation manuelle,
-- permission de revenu, agenda enrichi.
--
-- Restaure les définitions d'AVANT OS-1 de reschedule_appointment et
-- get_calendar_appointments (copiées VERBATIM de la production du
-- 2026-09-11, ACL re-matérialisées à l'identique), retire les RPC neuves,
-- le journal, le trigger, les colonnes, et remet les deux contraintes
-- d'exclusion à leur prédicat d'origine.
--
-- REFUSE de tourner tant qu'un rendez-vous ACTIF porte une trace de forçage :
-- le prédicat d'origine le mettrait en violation d'exclusion. Le script
-- nomme la requête à faire (déplacer ou annuler ces lignes) au lieu de
-- détruire. Les traces effacées avec les colonnes sont perdues (le journal
-- appointment_overlap_forces est retiré aussi) — assumé.
--
-- À APPLIQUER EN postgres. Indépendant de 20260911100000 (time_blocks).

set lock_timeout = '5s';

begin;

do $guard$
declare v_count bigint;
begin
  select count(*) into v_count
  from public.appointments a
  where a.overlap_forced_at is not null
    and a.status not in ('cancelled', 'no_show');
  if v_count > 0 then
    raise exception 'OS-1 down : % rendez-vous actif(s) portent un chevauchement forcé — déplacer ou annuler d''abord : select id, barber_id, starts_at from public.appointments where overlap_forced_at is not null and status not in (''cancelled'',''no_show'');', v_count;
  end if;
end;
$guard$;

-- 1. RPC neuves et règles d'accès
drop function if exists public.create_appointment_as_business(uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, text);
drop function if exists public.set_membership_revenue_visibility(uuid, boolean);

-- 2. reschedule_appointment — définition d'origine
drop function if exists public.reschedule_appointment(uuid, timestamptz, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone, p_barber_id uuid DEFAULT NULL::uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appointment public.appointments;
  v_is_business boolean;
  v_is_customer boolean;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_timezone text;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found'
      using errcode = '42704',
            detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  -- X3 : coalesce anti-NULL — un rendez-vous walk-in (customer_id NULL) rendait
  -- la comparaison IN NULL, et « if not (false or NULL) » ne levait pas.
  v_is_customer := coalesce(v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  ), false);

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=no_longer_reschedulable';
  end if;

  if p_starts_at is null then
    raise exception 'the new time is required'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=missing_time';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=past_time';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- A different professional must still belong to this shop and still be
  -- eligible for this service. Never trusted from the caller.
  if v_barber_id <> v_appointment.barber_id then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.barber_services bs on bs.barber_id = b.id and bs.service_id = v_appointment.service_id
      where b.id = v_barber_id
        and b.organization_id = v_appointment.organization_id
        and b.is_bookable and sp.is_active and sp.is_public
    ) then
      raise exception 'that professional is not available for this service'
        using errcode = '22023',
              detail = 'fadeup_booking_refusal=barber_unavailable';
    end if;
  end if;

  -- Duration comes from the SNAPSHOT on the appointment, not from the service
  -- as it stands today: a price list edited since booking must not silently
  -- change the length of an appointment already agreed.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  select l.timezone into v_timezone
    from public.locations l where l.id = v_appointment.location_id;

  -- NEW IN LOT E. Previously this relied entirely on a human seeing the new
  -- time, because a customer move became a request. Nobody sees it now, so
  -- the destination has to be genuinely bookable — not merely unoccupied.
  if not private.slot_is_within_hours(v_barber_id, v_appointment.location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=outside_hours';
  end if;

  -- The status is PRESERVED. A confirmed appointment moved to another valid
  -- slot is still a confirmed appointment: the shop said yes to the slot, and
  -- the customer has not stopped being expected.
  --
  -- Raised for exactly this UPDATE, after the checks above — it tells the LOT
  -- 11 column guard that this is the sanctioned reschedule path rather than a
  -- barber editing a time directly.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- One statement. The GiST exclusion constraint is the authority on whether
  -- the destination is free; if it raises, nothing here has changed and the
  -- original appointment is left exactly as it was. There is never a moment
  -- with two appointments.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        decided_at = case when v_is_business then now() else decided_at end,
        decided_by = case when v_is_business then (select auth.uid()) else decided_by end
    where id = p_appointment_id
    returning * into v_appointment;

  perform set_config('fadeup.appointment_reschedule', 'off', true);

  perform private.emit_booking_notification(
    v_appointment, 'booking_rescheduled',
    case when v_is_business then 'customer' else 'business' end,
    'Appointment moved',
    v_appointment.customer_name,
    'booking_rescheduled',
    ':' || extract(epoch from v_appointment.starts_at)::bigint::text
  );

  return v_appointment;
end;
$function$

;

revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated, service_role;

-- 3. get_calendar_appointments — définition d'origine (type de retour d'origine)
drop function if exists public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_calendar_appointments(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location_id uuid DEFAULT NULL::uuid, p_barber_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status appointment_status, resolution appointment_resolution, expires_at timestamp with time zone, location_id uuid, location_name text, location_timezone text, barber_id uuid, barber_display_name text, service_id uuid, service_name text, price_cents integer, currency text, customer_name text, customer_phone text, notes text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    a.id, a.starts_at, a.ends_at, a.status, a.resolution, a.expires_at,
    a.location_id, l.name, l.timezone,
    a.barber_id, sp.display_name,
    a.service_id, s.name, s.price_cents, coalesce(o.currency, 'EUR'),
    a.customer_name, a.customer_phone, a.notes, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$function$

;

revoke all on function public.get_calendar_appointments(uuid, timestamp with time zone, timestamp with time zone, uuid, uuid) from public, anon;
grant execute on function public.get_calendar_appointments(uuid, timestamp with time zone, timestamp with time zone, uuid, uuid) to authenticated, service_role;

-- 4. Permission de revenu
drop function if exists private.can_view_revenue(uuid);
alter table public.memberships drop column if exists can_view_revenue;

-- 5. Journal, trigger, règle de forçage
drop table if exists public.appointment_overlap_forces;
drop trigger if exists appointments_check_forced_overlap on public.appointments;
drop function if exists public.check_appointment_forced_overlap();
drop function if exists private.can_force_overlap(uuid);

-- 6. Contraintes d'exclusion — prédicat d'origine
alter table public.appointments
  drop constraint appointments_barber_no_overlap,
  add constraint appointments_barber_no_overlap
    exclude using gist (barber_id with =, blocked_range with &&)
    where (status not in ('cancelled', 'no_show'));

alter table public.appointments
  drop constraint appointments_chair_no_overlap,
  add constraint appointments_chair_no_overlap
    exclude using gist (chair_id with =, blocked_range with &&)
    where (status not in ('cancelled', 'no_show'));

-- 7. Colonnes de trace
alter table public.appointments
  drop constraint if exists appointments_overlap_forced_consistent,
  drop constraint if exists appointments_overlap_forced_reason_length,
  drop column if exists overlap_forced_reason,
  drop column if exists overlap_forced_by,
  drop column if exists overlap_forced_at;

commit;
