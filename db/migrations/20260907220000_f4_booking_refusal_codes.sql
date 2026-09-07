-- F4 — Codes de refus nommés sur le tunnel de réservation, et plafond de
-- réservations futures simultanées.
--
-- À APPLIQUER EN postgres (les quatre fonctions redéfinies lui appartiennent,
-- vérifié : proowner = postgres pour chacune — doctrine DB_OWNERSHIP règle 2).
--
-- POURQUOI. F4 exige que chaque motif de refus soit lu sur un CODE, jamais sur
-- le texte (le motif F1 : DETAIL fadeup_queue_refusal=<code>, repris par B2
-- avec fadeup_interest_refusal). Or book_public_appointment, la RPC la plus
-- importante du produit, lève des exceptions à texte libre. Cette migration
-- attache `detail = 'fadeup_booking_refusal=<code>'` à chaque refus des
-- chemins client (book / cancel / reschedule / garde de mode de service),
-- SANS changer aucun comportement, aucun message, aucun errcode existant.
--
-- Elle ajoute UNE garde : le plafond de réservations futures simultanées
-- (MASTER_SPEC §6 : « 5 par défaut, réglable depuis /platform »). La table de
-- réglages plateforme n'existe pas (V2_DATA_CONTRACT §2 P5 : BLOQUÉ) ; la
-- valeur par défaut vit donc ici, en tête de fonction, à remplacer par une
-- lecture de réglage le jour où la table existera. Le compte porte sur le
-- self-service du COMPTE (booked_by_user_id) : un appelant anonyme n'est pas
-- comptable par construction — et l'interface F4 ne réserve plus jamais en
-- anonyme (inscription légère dans le flux).
--
-- Fonctions NON touchées, à dessein :
--   - check_appointment_time_blocks (proowner = supabase_admin — y toucher
--     forcerait toute la migration en supabase_admin pour un seul detail ;
--     son errcode 22023 sans detail suffit au front pour « créneau
--     indisponible ») ;
--   - la contrainte d'exclusion GiST (conflit de créneau) lève 23P01, un
--     SQLSTATE déjà nommé.
--
-- Aucune RPC neuve : la surface anon (x3_anon_surface.sh) est inchangée.
-- CREATE OR REPLACE conserve propriétaire et ACL (DB_OWNERSHIP §2.3) ; les
-- grants sont néanmoins ré-affirmés explicitement en fin de fichier
-- (invariant X3, règle 4).

begin;

create or replace function public.book_public_appointment(
  p_organization_slug text,
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamp with time zone,
  p_customer_name text,
  p_customer_phone text default null::text,
  p_customer_email text default null::text,
  p_notes text default null::text
)
returns table(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status public.appointment_status, is_request boolean, expires_at timestamp with time zone, claim_token text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- MASTER_SPEC §6 : réservations futures simultanées, 5 par défaut. Réglable
  -- depuis /platform le jour où la table de réglages plateforme existera —
  -- elle n'existe pas encore, la constante vit ici et nulle part ailleurs.
  c_max_future_bookings constant integer := 5;
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
  v_status public.appointment_status;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required'
      using detail = 'fadeup_booking_refusal=missing_name';
  end if;

  if coalesce(btrim(p_customer_phone), '') = '' and coalesce(btrim(p_customer_email), '') = '' then
    raise exception 'at least one of customer_phone or customer_email is required'
      using detail = 'fadeup_booking_refusal=missing_contact';
  end if;

  if p_starts_at is null then
    raise exception 'starts_at is required'
      using detail = 'fadeup_booking_refusal=missing_time';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future'
      using detail = 'fadeup_booking_refusal=past_time';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization'
      using detail = 'fadeup_booking_refusal=unknown_organization';
  end if;

  select l.timezone into v_timezone
    from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking'
      using detail = 'fadeup_booking_refusal=location_unavailable';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location'
      using detail = 'fadeup_booking_refusal=service_unavailable';
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
    raise exception 'barber is not available for this service at this location'
      using detail = 'fadeup_booking_refusal=barber_unavailable';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  -- The client is never trusted to have only ever requested a time we offered.
  -- Cette ligne vaut pour les DEUX branches : une demande en attente sur un
  -- horaire hors ouverture n'est pas une demande, c'est une fausse promesse.
  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours'
      using detail = 'fadeup_booking_refusal=outside_hours';
  end if;

  -- Signed-in booker: resolve (or create) their own CRM row for this shop so
  -- the appointment is owned from the moment it exists. Anonymous booker:
  -- v_customer_id stays null and a claim token is issued below. (LOT 13.)
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    -- Le plafond se vérifie AVANT de matérialiser la ligne CRM : un client au
    -- plafond ne doit laisser aucune trace d'écriture. Demandes et rendez-vous
    -- comptent ensemble : une demande retient un créneau (contrainte
    -- d'exclusion), elle occupe donc bien un des cinq emplacements.
    if (
      select count(*)
      from public.appointments a
      where a.booked_by_user_id = v_user_id
        and a.status in ('pending', 'confirmed')
        and a.starts_at > now()
    ) >= c_max_future_bookings then
      raise exception 'this account already has the maximum number of upcoming bookings'
        using detail = 'fadeup_booking_refusal=too_many_future_bookings';
    end if;

    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, p_customer_email
    );
  end if;

  -- LA BRANCHE. La question est commerciale et une seule fois posée, par le
  -- helper de R2 : ce fichier ne connaît aucun nom de plan.
  --
  -- decided_at/decided_by restent NULL dans les deux cas et pour deux raisons
  -- différentes : sur une confirmation automatique personne n'a décidé, sur
  -- une demande personne n'a ENCORE décidé. confirm_booking_request les
  -- remplira dans le second cas, et c'est ce qui permettra de distinguer plus
  -- tard une confirmation automatique d'une acceptation humaine.
  v_status := case
    when (select private.org_has_capability(v_organization_id, 'booking')) then 'confirmed'
    else 'pending'
  end;

  -- appointments_check_time_blocks (LOT D) runs before the insert lands, and
  -- the GiST exclusion constraints remain the final race-free authority: two
  -- visitors racing this exact slot still produce exactly one appointment —
  -- et une ligne `pending` participe à cette exclusion, donc une demande
  -- retient bien le créneau qu'elle demande.
  --
  -- expires_at n'est pas passé : set_appointment_request_expiry le dérive du
  -- TTL de l'organisation et le plafonne par least(expires_at, starts_at). Le
  -- calculer ici en dupliquerait la règle à deux endroits.
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
    v_status, p_notes, null, v_user_id
  )
  returning * into v_appointment;

  -- Anonymous booking: issue the one-time proof-of-booking token. (LOT 13.)
  -- Émis pour les deux branches : un visiteur anonyme qui envoie une demande
  -- doit pouvoir la rattacher à son compte après inscription, exactement comme
  -- une réservation confirmée — c'est même plus important ici, puisque la
  -- réponse arrivera plus tard.
  if v_user_id is null then
    v_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.appointment_claim_tokens (appointment_id, token_hash, expires_at)
    values (
      v_appointment.id,
      encode(extensions.digest(v_claim_token, 'sha256'), 'hex'),
      now() + interval '72 hours'
    );
  end if;

  -- L'aval existait déjà et n'attendait qu'une ligne à traiter : le
  -- professionnel est prévenu, le client reçoit son accusé. Les deux
  -- notifications portent des types déjà définis dans l'enum.
  if v_status = 'pending' then
    perform private.emit_booking_notification(
      v_appointment, 'booking_request_created', 'business',
      'Nouvelle demande de réservation',
      null, 'booking_request_created'
    );
    perform private.emit_booking_notification(
      v_appointment, 'booking_request_created', 'customer',
      'Votre demande a été envoyée',
      null, 'booking_request_sent'
    );
  else
    perform private.emit_booking_notification(
      v_appointment, 'booking_confirmed', 'customer',
      'Votre réservation est confirmée',
      null, 'booking_confirmed'
    );
  end if;

  return query select
    v_appointment.id,
    v_appointment.starts_at,
    v_appointment.ends_at,
    v_appointment.status,
    v_appointment.status = 'pending',
    v_appointment.expires_at,
    v_claim_token;
end;
$function$;

create or replace function public.enforce_booking_service_mode()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_mode public.service_mode;
  v_source text;
begin
  -- THE LOCK. Shared, taken before the mode is read, released at commit.
  -- B1 a retiré l'appel ensure_… des LECTURES ; ici on est dans une écriture,
  -- où matérialiser la ligne est légitime — et le verrou a besoin d'une ligne
  -- à verrouiller.
  perform private.ensure_location_service_settings(new.location_id);

  perform 1
  from public.location_service_settings s
  where s.location_id = new.location_id
  for share;

  -- LA SEULE LIGNE QUE B2 CHANGE.
  --
  -- Une DEMANDE n'est pas une réservation : elle ne consomme pas l'agenda du
  -- professionnel, elle attend qu'un humain réponde, et elle est précisément
  -- ce que MASTER_SPEC §5 veut voir arriver chez un profil Free. Lui opposer
  -- la capacité commerciale, c'est refuser d'apporter un client à quelqu'un
  -- pour la raison qu'il n'a pas encore payé pour en recevoir — l'inverse
  -- exact du modèle d'acquisition.
  --
  -- Une CONFIRMATION reste soumise à la capacité, sans exception : c'est elle
  -- qui pose un rendez-vous ferme dans un agenda, et c'est elle qui se paie.
  if new.status <> 'pending' then
    perform private.assert_org_capability(new.organization_id, 'booking');
  end if;

  select m.mode, m.source into v_mode, v_source
  from private.effective_service_mode(new.location_id, new.barber_id) m;

  if v_mode is null or not private.mode_allows_booking(v_mode) then
    -- The message names the mode and where it came from, so a professional who
    -- has forgotten they set a one-hour override an hour ago is told exactly
    -- that, rather than being handed a generic refusal. It deliberately carries
    -- no organization or location id: error strings end up in logs a wider
    -- audience reads.
    raise exception 'new reservations are not being accepted (service mode: %)',
      coalesce(v_mode::text, 'unknown')
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=service_mode_closed',
            hint = format(
              'The effective service mode comes from %s. Existing appointments are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  return new;
end;
$function$;

create or replace function public.cancel_my_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_appointment public.appointments;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  for update;

  if not found then
    raise exception 'appointment not found'
      using detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled'
      using detail = 'fadeup_booking_refusal=no_longer_cancellable';
  end if;

  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_customer',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'business',
    'A customer cancelled',
    v_appointment.customer_name, 'booking_cancelled'
  );

  return v_appointment;
end;
$function$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamp with time zone,
  p_barber_id uuid default null::uuid
)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

-- Invariant X3 (règle 4) : les grants sont explicites. CREATE OR REPLACE
-- conserve les ACL existantes ; on les ré-affirme pour que le fichier soit
-- lisible seul et que le durcissement des défauts ne puisse jamais laisser
-- ces chemins morts.
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_my_appointment(uuid) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated;
-- enforce_booking_service_mode est une fonction de trigger : jamais accordée.

commit;
