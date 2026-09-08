-- FadeUp — P1PRO (2/2) : la contre-proposition d'horaire, l'historique des
-- demandes, et la capacité de réservation en lot pour la recherche.
--
-- LE MANQUE : B2 a construit confirm/decline, mais « pas 18h, mais 18h30 »
-- — le cas le plus fréquent — n'avait aucune RPC. Un salon qui ne peut pas
-- honorer l'horaire exact devait refuser, et le client repartait.
--
-- LE MODÈLE (tranché par P1PRO, documenté au contrat de design §11) :
--   - La contre-proposition DÉPLACE la demande sur le créneau proposé
--     (une seule ligne, le mécanisme de reschedule_appointment). Le créneau
--     proposé est donc RETENU — la ligne pending participe à l'exclusion de
--     chevauchement — et l'horaire d'origine est libéré.
--   - `counter_proposed_at` dit que le consentement a changé de camp : tant
--     qu'il est posé sur une ligne pending, le salon ne peut plus
--     « accepter » (confirm_booking_request refuse), le client répond.
--   - Échéance : least(horaire proposé, now() + TTL de l'organisation) —
--     le compte à rebours redémarre, jamais au-delà de l'heure proposée.
--   - Refus client → cancelled / cancelled_by_customer (le salon avait déjà
--     dit non à l'horaire d'origine ; on ne fait pas revivre la demande).
--   - Non-réponse → expiration par le balayage existant, inchangé.
--
-- `was_request` : le marqueur durable « cette ligne est née demande », pour
-- l'historique des demandes (jusqu'ici indiscernable d'une réservation
-- directe une fois confirmée). Backfill déclaré approximatif pour les
-- lignes confirmées d'avant cette migration (voir le rapport P1PRO §7).
--
-- À APPLIQUER EN postgres (tous les objets touchés lui appartiennent —
-- vérifié : appointments, email_templates, get_booking_requests,
-- get_my_appointments, confirm_booking_request,
-- set_appointment_request_expiry). Après 20260908030000 (enum committée).
--
-- Invariant X3 (règle 4) : grants EXPLICITES sur toute RPC neuve ou
-- recréée. Les fonctions recréées (DROP+CREATE pour changement de type de
-- retour) re-matérialisent leur ACL d'origine à l'identique.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column counter_proposed_at timestamptz,
  add column counter_original_starts_at timestamptz,
  add column counter_note text,
  add column was_request boolean not null default false;

comment on column public.appointments.counter_proposed_at is
  'P1PRO — posé quand le salon propose un autre horaire pour une demande pending. Sur une ligne pending, le consentement est côté client : confirm_booking_request refuse. Conservé après issue comme trace (l''historique distingue « contre-proposée puis acceptée/refusée »).';
comment on column public.appointments.counter_original_starts_at is
  'P1PRO — l''horaire DEMANDÉ par le client avant la première contre-proposition (starts_at porte l''horaire proposé). Jamais réécrit par une re-proposition.';
comment on column public.appointments.counter_note is
  'P1PRO — mot facultatif du salon accompagnant la contre-proposition.';
comment on column public.appointments.was_request is
  'P1PRO — la ligne est née demande (pending). Stampé par set_appointment_request_expiry, jamais remis à false. Backfill 2026-09-08 approximatif sur les lignes déjà décidées (voir P1PRO_RAPPORT §7).';

-- Backfill : une ligne encore pending, une résolution qui n''existe que pour
-- les demandes (declined/expired), ou une notification de demande émise à
-- l''époque. Sur-inclusion possible : decided_by est aussi posé par un
-- reschedule côté salon — assumé, déclaré au rapport.
update public.appointments a
   set was_request = true
 where a.status = 'pending'
    or a.resolution in ('declined', 'expired')
    or exists (
      select 1 from public.notifications n
      where n.appointment_id = a.id
        and n.type = 'booking_request_created'
    );

-- ---------------------------------------------------------------------------
-- 2. set_appointment_request_expiry — stampe was_request au passage
-- ---------------------------------------------------------------------------

create or replace function public.set_appointment_request_expiry()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_ttl integer;
begin
  if new.status = 'pending' then
    -- P1PRO : la ligne est (ou redevient) une demande — marqueur durable
    -- pour l'historique. Jamais remis à false.
    new.was_request := true;

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

-- ---------------------------------------------------------------------------
-- 3. confirm_booking_request — refuse quand une contre-proposition attend
-- ---------------------------------------------------------------------------

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

  -- P1PRO : une contre-proposition attend le client — le consentement a
  -- changé de camp. Le salon peut toujours refuser, pas « accepter » à la
  -- place du client.
  if v_appointment.counter_proposed_at is not null then
    raise exception 'a counter-proposal is awaiting the customer'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=counter_pending';
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

-- ---------------------------------------------------------------------------
-- 4. counter_propose_booking_request — le salon propose un autre horaire
-- ---------------------------------------------------------------------------

create function public.counter_propose_booking_request(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_barber_id uuid default null,
  p_note text default null
)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_appointment public.appointments;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_timezone text;
  v_ttl integer;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found'
      using errcode = '42704',
            detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'only a pending request can receive a counter-proposal'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=not_a_pending_request';
  end if;

  if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
    raise exception 'this request has expired'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=request_expired';
  end if;

  if p_starts_at is null then
    raise exception 'the proposed time is required'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=missing_time';
  end if;

  if p_starts_at <= now() then
    raise exception 'the proposed time must be in the future'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=past_time';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- Même règle que reschedule_appointment : un autre professionnel doit
  -- appartenir au salon et rester apte au service. Jamais cru sur parole.
  if v_barber_id is distinct from v_appointment.barber_id then
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

  -- Durée depuis le SNAPSHOT de la demande, pas depuis le service du jour.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  select l.timezone into v_timezone
    from public.locations l where l.id = v_appointment.location_id;

  -- Le créneau proposé doit être réellement proposable : dans les heures
  -- d'ouverture ; le chevauchement est tranché par la contrainte d'exclusion
  -- au moment de l'UPDATE (l'autorité, comme pour reschedule).
  if not private.slot_is_within_hours(v_barber_id, v_appointment.location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'proposed time is outside available hours'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=outside_hours';
  end if;

  select o.booking_request_ttl_minutes into v_ttl
    from public.organizations o where o.id = v_appointment.organization_id;

  -- Voie sanctionnée de déplacement (garde de colonnes LOT 11) — exactement
  -- comme reschedule_appointment.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- Une seule instruction : la contrainte d'exclusion est l'autorité sur la
  -- liberté du créneau proposé. La ligne pending déplacée RETIENT ce
  -- créneau ; l'horaire d'origine est libéré. L'échéance redémarre :
  -- least(horaire proposé, now() + TTL) — le trigger la re-plafonne.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        counter_proposed_at = now(),
        counter_original_starts_at = coalesce(v_appointment.counter_original_starts_at, v_appointment.starts_at),
        counter_note = nullif(btrim(coalesce(p_note, '')), ''),
        expires_at = least(p_starts_at, now() + make_interval(mins => coalesce(v_ttl, 1440))),
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  -- Suffixe daté : une re-proposition est une NOUVELLE information — la clé
  -- de dédoublonnage ne doit pas avaler la seconde notification.
  perform private.emit_booking_notification(
    v_appointment, 'booking_counter_proposed', 'customer',
    'A new time was proposed for your request',
    v_appointment.counter_note, 'booking_counter_proposed',
    ':' || to_char(now(), 'YYYYMMDDHH24MISS')
  );

  return v_appointment;
end;
$function$;

comment on function public.counter_propose_booking_request(uuid, timestamptz, uuid, text) is
  'P1PRO — le salon propose un autre horaire pour une demande pending. Déplace la ligne sur le créneau proposé (retenu par l''exclusion), pose counter_proposed_at (le client répond), redémarre l''échéance : least(proposé, now()+TTL).';

revoke all on function public.counter_propose_booking_request(uuid, timestamptz, uuid, text) from public;
grant execute on function public.counter_propose_booking_request(uuid, timestamptz, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. accept_booking_counter_proposal — le client accepte
-- ---------------------------------------------------------------------------

create function public.accept_booking_counter_proposal(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_appointment public.appointments;
  v_is_customer boolean;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found'
      using errcode = '42704',
            detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  -- X3 : coalesce anti-NULL — sans lui, customer_id NULL rend la condition
  -- NULL et « if not » ne lève pas.
  v_is_customer := coalesce(v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  ), false);

  if not v_is_customer then
    raise exception 'not authorized to answer this proposal'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  -- Idempotent : si le salon a re-proposé PUIS que deux réponses se
  -- croisent, la ligne réglée est rendue telle quelle.
  if v_appointment.status = 'confirmed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' or v_appointment.counter_proposed_at is null then
    raise exception 'no counter-proposal is awaiting an answer'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=no_counter_pending';
  end if;

  if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
    raise exception 'this proposal has expired'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=request_expired';
  end if;

  -- Le salon a proposé ce créneau, le client y consent : confirmé. Le
  -- créneau était déjà retenu par la ligne pending — aucune course possible
  -- sur le chevauchement.
  update public.appointments
    set status = 'confirmed',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_confirmed', 'customer',
    'Your appointment is confirmed',
    null, 'booking_confirmed', ':counter-accept'
  );
  perform private.emit_booking_notification(
    v_appointment, 'booking_confirmed', 'business',
    'Proposed time accepted',
    v_appointment.customer_name, null, ':counter-accept'
  );

  return v_appointment;
end;
$function$;

comment on function public.accept_booking_counter_proposal(uuid) is
  'P1PRO — le client accepte le créneau contre-proposé : pending → confirmed (créneau déjà retenu par la ligne). Notifie les deux parties.';

revoke all on function public.accept_booking_counter_proposal(uuid) from public;
grant execute on function public.accept_booking_counter_proposal(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. decline_booking_counter_proposal — le client refuse
-- ---------------------------------------------------------------------------

create function public.decline_booking_counter_proposal(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_appointment public.appointments;
  v_is_customer boolean;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found'
      using errcode = '42704',
            detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  v_is_customer := coalesce(v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  ), false);

  if not v_is_customer then
    raise exception 'not authorized to answer this proposal'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  if v_appointment.status = 'cancelled' and v_appointment.resolution = 'cancelled_by_customer' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' or v_appointment.counter_proposed_at is null then
    raise exception 'no counter-proposal is awaiting an answer'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=no_counter_pending';
  end if;

  -- Le salon avait déjà dit non à l'horaire d'origine : refuser la
  -- proposition clôt la demande. cancelled libère le créneau (prédicat
  -- d'exclusion intact) ; la résolution dit QUI a tranché.
  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_customer',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'business',
    'Proposed time declined',
    v_appointment.customer_name, null, ':counter-decline'
  );

  return v_appointment;
end;
$function$;

comment on function public.decline_booking_counter_proposal(uuid) is
  'P1PRO — le client refuse le créneau contre-proposé : la demande se clôt (cancelled / cancelled_by_customer), le salon est notifié.';

revoke all on function public.decline_booking_counter_proposal(uuid) from public;
grant execute on function public.decline_booking_counter_proposal(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. get_booking_requests — les colonnes de contre-proposition
--    (DROP + CREATE : le type de retour change ; ACL re-matérialisée à
--     l'identique de l'origine.)
-- ---------------------------------------------------------------------------

drop function public.get_booking_requests(uuid);

create function public.get_booking_requests(p_organization_id uuid)
returns table(
  id uuid,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  price_cents integer,
  customer_name text,
  customer_phone text,
  customer_email text,
  notes text,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  counter_proposed_at timestamptz,
  counter_original_starts_at timestamptz,
  counter_note text
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
    a.starts_at, a.ends_at, a.expires_at, a.created_at,
    a.counter_proposed_at, a.counter_original_starts_at, a.counter_note
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

comment on function public.get_booking_requests(uuid) is
  'Demandes pending d''une organisation, la plus urgente en tête. P1PRO ajoute les colonnes de contre-proposition : counter_proposed_at non nul = en attente du CLIENT (le front sépare les deux groupes).';

revoke all on function public.get_booking_requests(uuid) from public;
grant execute on function public.get_booking_requests(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. get_my_appointments — le client voit la contre-proposition
--    (DROP + CREATE : colonnes ajoutées en FIN de type de retour.)
-- ---------------------------------------------------------------------------

drop function public.get_my_appointments();

create function public.get_my_appointments()
returns table(
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  price_cents integer,
  currency text,
  location_timezone text,
  resolution public.appointment_resolution,
  resolution_note text,
  expires_at timestamptz,
  created_at timestamptz,
  counter_proposed_at timestamptz,
  counter_original_starts_at timestamptz,
  counter_note text
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
    a.resolution, a.resolution_note, a.expires_at, a.created_at,
    a.counter_proposed_at, a.counter_original_starts_at, a.counter_note
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

comment on function public.get_my_appointments() is
  'Rendez-vous et demandes du client connecté. P1PRO ajoute la contre-proposition : counter_proposed_at non nul sur une ligne pending = le salon propose starts_at (l''horaire demandé est counter_original_starts_at) — répondre via accept/decline_booking_counter_proposal.';

revoke all on function public.get_my_appointments() from public;
grant execute on function public.get_my_appointments() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. get_booking_request_history — les demandes traitées, avec leur issue
-- ---------------------------------------------------------------------------

create function public.get_booking_request_history(
  p_organization_id uuid,
  p_limit integer default 100
)
returns table(
  id uuid,
  location_id uuid,
  location_name text,
  barber_display_name text,
  service_name text,
  price_cents integer,
  currency text,
  customer_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  resolution public.appointment_resolution,
  counter_proposed_at timestamptz,
  counter_original_starts_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  -- L'issue se dérive côté front, sans invention :
  --   confirmed/completed              → acceptée (contre-proposée si counter_proposed_at)
  --   cancelled + declined             → refusée par le salon
  --   cancelled + expired              → expirée sans réponse
  --   cancelled + cancelled_by_customer→ retirée par le client
  --                                      (contre-proposition refusée si counter_proposed_at)
  select
    a.id, a.location_id, l.name, sp.display_name, s.name,
    s.price_cents, coalesce(o.currency, 'EUR'),
    a.customer_name, a.starts_at, a.ends_at,
    a.status, a.resolution,
    a.counter_proposed_at, a.counter_original_starts_at,
    a.decided_at, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.was_request
    and a.status <> 'pending'
    and (select private.can_manage_appointments(p_organization_id))
  order by coalesce(a.decided_at, a.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$function$;

comment on function public.get_booking_request_history(uuid, integer) is
  'P1PRO — les demandes traitées d''une organisation avec leur issue (statut + résolution + trace de contre-proposition). C''est la preuve de ce que FadeUp apporte au salon.';

revoke all on function public.get_booking_request_history(uuid, integer) from public;
grant execute on function public.get_booking_request_history(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. get_public_booking_capabilities — la capacité en lot pour la recherche
--     (le singulier F4 reste ; la recherche affiche « Réservable » vs
--      « Sur demande » sans N+1 supplémentaire.)
-- ---------------------------------------------------------------------------

create function public.get_public_booking_capabilities(p_organization_slugs text[])
returns table(organization_slug text, accepts_immediate_booking boolean)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if cardinality(coalesce(p_organization_slugs, '{}')) > 50 then
    raise exception 'too many organizations requested at once (max 50)'
      using errcode = '22023';
  end if;

  -- Même prédicat que le singulier F4 (le slug seul) : la recherche et le
  -- tunnel doivent voir le même monde.
  return query
  select o.slug, private.org_has_capability(o.id, 'booking')
  from public.organizations o
  where o.slug = any(coalesce(p_organization_slugs, '{}'));
end;
$function$;

comment on function public.get_public_booking_capabilities(text[]) is
  'P1PRO — get_public_booking_capability en lot (max 50 slugs), pour que la découverte distingue « Réservable » (confirmation immédiate) de « Sur demande » (pending sous échéance) sans N+1.';

revoke all on function public.get_public_booking_capabilities(text[]) from public;
grant execute on function public.get_public_booking_capabilities(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Gabarits e-mail de la contre-proposition (fr + en)
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html)
values
  (
    'booking_counter_proposed', 'fr', 'transactional',
    '{{organization_name}} vous propose un autre horaire',
    E'Bonjour {{customer_name}},\n\n{{organization_name}} ne peut pas assurer {{service_name}} à l''horaire demandé, et vous propose : {{starts_at_fr}}.\n\nCette proposition expire le {{expires_at_fr}}. Ouvrez FadeUp et répondez depuis vos réservations — accepter, ou refuser.\n\nFadeUp',
    '<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f6;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8e7;border-radius:12px;"><tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;"><div style="font-size:14px;font-weight:600;color:#00875A;letter-spacing:0.02em;">FadeUp</div><h1 style="margin:16px 0 0 0;font-size:22px;line-height:1.3;color:#080F0D;font-weight:600;">Un autre horaire vous est propos&eacute;</h1></td></tr><tr><td style="padding:8px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#2c3330;"><p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, {{organization_name}} ne peut pas assurer <strong>{{service_name}}</strong> &agrave; l''horaire demand&eacute; et vous propose&nbsp;: <strong>{{starts_at_fr}}</strong>.</p><p style="margin:0;">Cette proposition expire le {{expires_at_fr}}. Ouvrez FadeUp et r&eacute;pondez depuis vos r&eacute;servations — accepter, ou refuser.</p></td></tr></table></td></tr></table></body></html>'
  ),
  (
    'booking_counter_proposed', 'en', 'transactional',
    '{{organization_name}} proposed another time',
    E'Hello {{customer_name}},\n\n{{organization_name}} can''t make the time you asked for {{service_name}}, and proposes: {{starts_at_en}}.\n\nThis proposal expires on {{expires_at_en}}. Open FadeUp and answer from your bookings — accept, or decline.\n\nFadeUp',
    '<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f6;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8e7;border-radius:12px;"><tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;"><div style="font-size:14px;font-weight:600;color:#00875A;letter-spacing:0.02em;">FadeUp</div><h1 style="margin:16px 0 0 0;font-size:22px;line-height:1.3;color:#080F0D;font-weight:600;">Another time was proposed</h1></td></tr><tr><td style="padding:8px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#2c3330;"><p style="margin:0 0 16px 0;">Hello {{customer_name}}, {{organization_name}} can''t make the time you asked for <strong>{{service_name}}</strong> and proposes: <strong>{{starts_at_en}}</strong>.</p><p style="margin:0;">This proposal expires on {{expires_at_en}}. Open FadeUp and answer from your bookings — accept, or decline.</p></td></tr></table></td></tr></table></body></html>'
  )
on conflict (template_key, locale) do update
  set subject = excluded.subject,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      stream = excluded.stream,
      updated_at = now();

commit;
