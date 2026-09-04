-- FadeUp — B2, chantier 1a: le refus sec devient une demande en attente.
--
-- L'ÉTAT MESURÉ AVANT CE FICHIER
--
-- Aucune organisation de la base ne détient la capacité `booking` : les neuf
-- de la marketplace, Side Agency comprise, sont en plan `free`. Le trigger
-- enforce_booking_service_mode appelle
-- private.assert_org_capability(org, 'booking') sans condition, donc
-- book_public_appointment **refuse partout**. Personne ne peut réserver nulle
-- part sur FadeUp, et c'est B1 qui l'a constaté en rapport final.
--
-- Le commentaire de book_public_appointment dit encore, mot pour mot :
-- « CONFIRMED, not pending. […] there is no further question for a human to
-- answer. » C'était vrai du monde que R1A décrivait — un salon payant avec un
-- agenda réel. MASTER_SPEC §5 en décrit un second, qui est le moteur
-- d'acquisition : un profil Free reçoit une demande, elle sort en `pending`,
-- un e-mail part, et **la demande en attente est l'argument de vente**.
--
-- CE QUI CHANGE, ET CE QUI NE CHANGE PAS
--
-- Une seule question bascule : la question COMMERCIALE.
--
--   capacité `booking` présente  -> 'confirmed', comportement R1A intact
--   capacité `booking` absente   -> 'pending', avec échéance
--
-- Toutes les autres vérifications restent, dans le même ordre, et le `pending`
-- n'en contourne aucune : organisation connue, lieu actif, service actif et
-- offert à ce lieu, barbier réellement apte à ce service à ce lieu, horaire
-- dans les heures d'ouverture, créneau libre (les contraintes d'exclusion
-- GiST restent l'autorité finale), mode de service autorisant la réservation.
--
-- C'est le point le plus important du fichier. Une demande en attente sur un
-- créneau impossible serait un mensonge au client, et pire qu'un refus : le
-- refus se comprend tout de suite, la fausse attente se découvre 24 h plus
-- tard.
--
-- POURQUOI LE MODE DE SERVICE RESTE OPPOSABLE AU `pending`
--
-- La capacité commerciale et le mode de service répondent à deux questions
-- différentes. « Ce salon a-t-il payé pour l'agenda ? » — non, et c'est
-- exactement le cas que le tunnel d'acquisition existe pour traiter. « Ce
-- salon accepte-t-il des réservations en ce moment ? » — s'il a répondu non,
-- en réglant son mode sur queue_only ou unavailable, lui envoyer des demandes
-- est du démarchage, pas de l'acquisition. Seul le premier verrou s'ouvre.
--
-- LE CRÉNEAU EST BIEN RETENU
--
-- appointments_barber_no_overlap exclut uniquement `cancelled` et `no_show`,
-- donc une ligne `pending` occupe le créneau. C'est voulu et conforme à
-- MASTER_SPEC §5 : la demande tient la place jusqu'à son échéance, et
-- expire_pending_appointments la libère. Sans cela, deux clients pourraient
-- recevoir la même heure.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Le trigger : la capacité commerciale n'est plus opposable à une demande
--
-- Tout le reste du corps est inchangé, y compris le verrou partagé sur la
-- ligne de réglages et le refus par mode de service.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_booking_service_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
            hint = format(
              'The effective service mode comes from %s. Existing appointments are unaffected.',
              coalesce(v_source, 'no configured establishment')
            );
  end if;

  return new;
end;
$$;

comment on function public.enforce_booking_service_mode() is
  'BEFORE INSERT sur appointments. Deux verrous distincts : le mode de service, opposable à TOUTE insertion, et la capacité commerciale `booking`, opposable aux seules lignes non-`pending`. B2 a ouvert le second pour les demandes : une demande en attente est le tunnel d''acquisition de MASTER_SPEC §5, pas une vente. Une confirmation reste payante.';

-- ---------------------------------------------------------------------------
-- 2. book_public_appointment — la branche
--
-- La signature ne bouge pas. Le retour gagne deux colonnes, `expires_at` et
-- `is_request`, parce que l'écran « demande envoyée » de MASTER_SPEC §5 en a
-- besoin et parce qu'un front ne doit pas avoir à DÉDUIRE d'un enum qu'il
-- affiche « Demande envoyée » plutôt que « Réservé ». La déduction est
-- exactement l'endroit où une interface se trompe.
-- ---------------------------------------------------------------------------

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
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  is_request boolean,
  expires_at timestamptz,
  claim_token text
)
language plpgsql
security definer
set search_path = ''
as $$
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
  v_status public.appointment_status;
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

  -- The client is never trusted to have only ever requested a time we offered.
  -- Cette ligne vaut pour les DEUX branches : une demande en attente sur un
  -- horaire hors ouverture n'est pas une demande, c'est une fausse promesse.
  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours';
  end if;

  -- Signed-in booker: resolve (or create) their own CRM row for this shop so
  -- the appointment is owned from the moment it exists. Anonymous booker:
  -- v_customer_id stays null and a claim token is issued below. (LOT 13.)
  v_user_id := (select auth.uid());
  if v_user_id is not null then
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
$$;

comment on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) is
'Anon-callable. Le seul chemin public de réservation. Deux issues, décidées par la capacité commerciale de l''organisation et par elle seule :

  capacité `booking`  -> status = ''confirmed'', is_request = false, expires_at NULL
  pas de capacité     -> status = ''pending'',   is_request = true,  expires_at renseigné

`is_request` et `expires_at` sont retournés pour que l''interface n''ait jamais à DÉDUIRE laquelle des deux elle affiche. MASTER_SPEC §5 : le client doit savoir qu''il envoie une demande, pas qu''il a un rendez-vous — un écran qui infère cela d''un enum est un écran qui finira par afficher « Réservé » sur une attente.

Le `pending` ne contourne AUCUNE vérification : lieu actif, service offert ici, barbier apte, horaire dans les heures d''ouverture, créneau libre, mode de service autorisant la réservation. Seule la question commerciale s''efface, parce qu''apporter un client à un professionnel qui n''a pas encore payé est le modèle, pas une faille.

`claim_token` est émis pour tout appelant anonyme, sur les deux branches.';

revoke all on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_public_appointment(text, uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated, service_role;

commit;
