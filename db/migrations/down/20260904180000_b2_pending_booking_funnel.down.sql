-- FadeUp — B2 chantier 1a, retour arrière.
--
-- Restaure le refus sec : la capacité commerciale `booking` redevient
-- opposable à TOUTE insertion d'appointment, y compris une demande.
--
-- CE QUE ÇA RESTAURE, EN CLAIR : plus personne ne peut réserver nulle part,
-- puisqu'aucune organisation ne détient cette capacité. C'est l'état que B2
-- existe pour corriger. À n'exécuter que si l'implémentation B2 est elle-même
-- en cause.
--
-- CONSÉQUENCE SUR LES DONNÉES. Les lignes `pending` déjà créées par ce chemin
-- ne sont pas supprimées : ce sont de vraies demandes de vrais clients, et le
-- trigger restauré ne s'applique qu'aux INSERT. Elles continueront d'expirer
-- normalement par expire_pending_appointments. Ce qui disparaît, c'est la
-- possibilité d'en créer de nouvelles.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- L'assertion de capacité redevient inconditionnelle : c'est la seule ligne
-- que B2 avait changée dans ce trigger.
create or replace function public.enforce_booking_service_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $ebsm$
declare
  v_mode public.service_mode;
  v_source text;
begin
  perform private.ensure_location_service_settings(new.location_id);

  perform 1
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  perform private.assert_org_capability(new.organization_id, 'booking');

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_booking(v_mode) then
    raise exception 'new reservations are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            hint = format(
              'The effective service mode comes from %s. Existing appointments are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  return new;
end;
$ebsm$;

comment on function public.enforce_booking_service_mode() is null;

-- La signature publique retrouve ses cinq colonnes de retour.
drop function if exists public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text);

create function public.book_public_appointment(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, status public.appointment_status, claim_token text)
language plpgsql
security definer
set search_path = ''
as $bpa$
declare
  v_organization_id uuid;
  v_timezone text;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_user_id uuid;
  v_customer_id uuid;
  v_claim_token text;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' and coalesce(btrim(p_customer_email), '') = '' then
    raise exception 'at least one of customer_phone or customer_email is required';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location';
  end if;

  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and sp.location_id = p_location_id
  ) then
    raise exception 'barber is not available for this service at this location';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  insert into public.appointments (
    organization_id, location_id, barber_id, service_id, customer_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by, booked_by_user_id
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', p_notes, null, v_user_id
  )
  returning * into v_appointment;

  if v_user_id is null then
    v_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.appointment_claim_tokens (appointment_id, token_hash, expires_at)
    values (
      v_appointment.id,
      encode(extensions.digest(v_claim_token, 'sha256'), 'hex'),
      now() + interval '72 hours'
    );
  end if;

  return query select v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_appointment.status, v_claim_token;
end;
$bpa$;

comment on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) is null;

revoke all on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated, service_role;

commit;
