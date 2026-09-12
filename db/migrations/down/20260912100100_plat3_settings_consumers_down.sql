-- Retour arrière de 20260912100100_plat3_settings_consumers.sql — EN postgres.
--
-- CE QU'IL DÉTRUIT : rien en données. Deux fonctions reprennent le corps
-- EXACT qu'elles avaient avant PLAT-3, extrait de la production le
-- 2026-09-12 et recopié ici sans une virgule de différence.
--
-- MAIS IL EST STRICTEMENT MOINS STRICT, et il faut le savoir avant de
-- l'ordonner : `book_public_appointment` reperd sa garde de fenêtre de
-- réservation. Un appel direct pourra de nouveau réserver à cinq ans. C'est
-- le sens d'un retour arrière, et c'est écrit pour qu'on le sache.
--
-- Les heures calmes et les délais de relance redeviennent les littéraux 8,
-- 21, 8 h et 2 h. Un réglage plateforme différent cesse alors d'avoir un
-- effet — sans erreur, ce qui est exactement le piège à connaître : après ce
-- retour arrière, l'écran de réglages MENTIRAIT sur ces quatre valeurs.

begin;

CREATE OR REPLACE FUNCTION public.book_public_appointment(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status appointment_status, is_request boolean, expires_at timestamp with time zone, claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION private.enqueue_prospect_outreach(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_touch text;
  v_template text;
  v_local_hour integer;
  v_count integer := 0;
begin
  for v_row in
    select
      r.id as request_id,
      r.locale,
      r.created_at,
      r.expires_at,
      pr.id as prospect_id,
      pr.email as prospect_email,
      private.prospect_timezone(pr.id) as tz,
      (select count(*) from public.email_outbox o
        where o.dedupe_key like 'interest:' || r.id::text || ':%') as touches_sent
    from public.professional_interest_requests r
    join public.professionals p on p.id = r.professional_id
    join public.prospect_professionals pp on pp.professional_id = p.id
    join public.prospects pr on pr.id = pp.prospect_id
    where r.status = 'pending'
      and r.expires_at > now()
      -- Le professionnel n'a pas encore revendiqué : c'est le seul cas où une
      -- relance de prospection a un sens.
      and p.claim_state = 'unclaimed'
      and p.is_public
      -- Joignable, et qui n'a pas dit non.
      and pr.email is not null
      and not pr.do_not_contact
      and not exists (
        select 1 from public.prospect_suppressions s
        where s.scope = 'prospect' and s.prospect_id = pr.id
      )
      and not private.is_prospect_value_suppressed('email', pr.email)
      -- MASTER_SPEC §5 : trois touches, jamais plus.
      and (select count(*) from public.email_outbox o
            where o.dedupe_key like 'interest:' || r.id::text || ':%') < 3
    order by r.created_at
    limit greatest(p_limit, 0)
  loop
    -- HEURES CALMES, dans le fuseau du destinataire. La touche n'est pas
    -- annulée : elle n'est pas encore due, et le tick suivant la reprendra.
    v_local_hour := extract(hour from (now() at time zone v_row.tz))::integer;
    if v_local_hour < 8 or v_local_hour >= 21 then
      continue;
    end if;

    -- Quelle touche est due.
    if v_row.touches_sent = 0 then
      v_touch := '1'; v_template := 'prospect_request_first';
    elsif v_row.touches_sent = 1 and now() >= v_row.created_at + interval '8 hours'
          -- Inutile de relancer une demande qui expire dans l'heure : la
          -- troisième touche, plus utile, arriverait juste après.
          and v_row.expires_at > now() + interval '1 hour' then
      v_touch := '2'; v_template := 'prospect_request_reminder';
    elsif v_row.touches_sent = 2 and now() >= v_row.expires_at - interval '2 hours' then
      v_touch := '3'; v_template := 'prospect_request_final';
    else
      continue;
    end if;

    insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
    values (
      v_row.prospect_email,
      v_template,
      v_row.locale,
      -- LE payload, et rien d'autre. Voir prospect_outreach_payload.
      private.prospect_outreach_payload(v_row.request_id),
      'prospecting',
      'interest:' || v_row.request_id::text || ':' || v_touch
    )
    -- Prédicat requis : l'index unique sur dedupe_key est PARTIEL.
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

commit;
