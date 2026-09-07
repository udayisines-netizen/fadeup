-- X3 — Chantier 1 : correctifs du motif NULL dans les gardes d'autorisation.
--
-- À APPLIQUER EN supabase_admin (deux fonctions redéfinies ici appartiennent à
-- supabase_admin : private.assert_organization_creation_authorized et
-- public.guard_marketplace_publication ; CREATE OR REPLACE conserve le
-- propriétaire et l'ACL existants quand il est exécuté par un superuser).
--
-- Contenu :
--   1. public.reschedule_appointment — coalesce anti-NULL sur v_is_customer
--      (customer_id NULL ⇒ IN rend NULL ⇒ la garde ne levait pas) + garde
--      explicite p_starts_at NULL. LA vulnérabilité réelle de ce lot.
--   2. private.assert_organization_creation_authorized,
--      public.guard_customers_identity, public.guard_marketplace_publication,
--      public.guard_professional_application_update — l'échappatoire
--      « uid NULL ⇒ passe » ne vaut plus pour un rôle-claim client
--      ('anon'/'authenticated') ; les sessions serveur, service_role,
--      restaurations et cascades FK passent comme avant.
--   3. public.book_public_appointment et
--      public.create_professional_interest_request — rejet explicite d'un
--      horodatage NULL (avant : traversée silencieuse des gardes temporelles,
--      rattrapée par accident par une contrainte NOT NULL en aval).
--   4. staff_profiles_insert — l'EXISTS d'appartenance était tautologique
--      (m.organization_id = m.organization_id) : n'importe quel owner pouvait
--      rattacher n'importe quel compte de la plateforme comme staff.
--      + trigger enforce_staff_profile_identity sur la réassignation de
--      user_id en UPDATE (une policy ne voit pas OLD).
--   5. post_likes_select_all (using true) → post_likes_select_visible ;
--      queue_entry_moves_select et service_duration_samples_select passent
--      de « to public » à « to authenticated ».

begin;

CREATE OR REPLACE FUNCTION private.assert_organization_creation_authorized()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Set by the sanctioned SECURITY DEFINER creation RPCs, transaction-local.
  -- current_setting(..., true) returns null instead of raising when the GUC
  -- was never set in this session, so an unflagged insert falls through to
  -- the checks below rather than erroring for the wrong reason.
  if coalesce(current_setting('fadeup.org_creation_authorized', true), '') = 'on' then
    return new;
  end if;

  -- review_professional_application() already raises
  -- fadeup.skip_org_owner_membership for exactly one statement — the
  -- approval insert — so it is, today, the approval path's own marker.
  -- Accepting it here keeps THIS migration independently correct: platform
  -- approval keeps working the moment this migration lands, with no edit to
  -- that function. The LOT B migration, which has to touch the approval
  -- function anyway to create the first location, additionally raises the
  -- dedicated flag above, at which point this branch is belt-and-braces.
  if coalesce(current_setting('fadeup.skip_org_owner_membership', true), '') = 'on' then
    return new;
  end if;

  -- No JWT identity: an operator psql session, a service_role job, or a
  -- restore. Not a client request — anon and authenticated no longer hold
  -- the INSERT privilege at all. Same escape hatch, same reasoning, as
  -- public.guard_professional_application_update().
  if (select auth.uid()) is null then
    -- X3 : un client PostgREST anonyme arrive TOUJOURS avec uid NULL. Seules
    -- les sessions serveur (psql opérateur, service_role, restauration,
    -- cascade) passent ; le rôle-claim 'anon'/'authenticated' est refusé.
    if coalesce((select auth.role()), '') in ('anon', 'authenticated') then
      raise exception 'organizations may only be created through create_organization() or review_professional_application()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'organizations may only be created through create_organization() or review_professional_application()'
    using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.book_public_appointment(p_organization_slug text, p_location_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_phone text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status appointment_status, is_request boolean, expires_at timestamp with time zone, claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if p_starts_at is null then
    raise exception 'starts_at is required';
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_professional_interest_request(p_professional_id uuid, p_customer_name text, p_service_label text, p_preferred_starts_at timestamp with time zone, p_customer_email text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_locale text DEFAULT 'fr'::text)
 RETURNS TABLE(id uuid, status interest_request_status, preferred_starts_at timestamp with time zone, expires_at timestamp with time zone, professional_display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_professional public.professionals;
  v_request public.professional_interest_requests;
  v_user_id uuid;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if btrim(coalesce(p_service_label, '')) = '' then
    raise exception 'service_label is required';
  end if;

  if coalesce(btrim(p_customer_email), '') = '' and coalesce(btrim(p_customer_phone), '') = '' then
    raise exception 'at least one of customer_email or customer_phone is required'
      using detail = 'fadeup_interest_refusal=no_contact_channel';
  end if;

  if p_preferred_starts_at is null then
    raise exception 'preferred_starts_at is required'
      using detail = 'fadeup_interest_refusal=missing_time';
  end if;

  if p_preferred_starts_at <= now() then
    raise exception 'preferred_starts_at must be in the future'
      using detail = 'fadeup_interest_refusal=past_time';
  end if;

  -- Jusqu'à 90 jours à l'avance, la même fenêtre que la réservation
  -- (MASTER_SPEC §6). Au-delà, ce n'est plus une intention, c'est du bruit.
  if p_preferred_starts_at > now() + interval '90 days' then
    raise exception 'preferred_starts_at is too far in the future'
      using detail = 'fadeup_interest_refusal=too_far_ahead';
  end if;

  select p.* into v_professional
  from public.professionals p
  where p.id = p_professional_id;

  if not found or not v_professional.is_public then
    -- Même refus pour « inexistant » et « non publié » : un refus distinct
    -- laisserait sonder quelles identités existent.
    raise exception 'this profile is not open to requests'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=profile_not_public';
  end if;

  -- Un profil REVENDIQUÉ n'a rien à faire ici : son propriétaire a un compte,
  -- une organisation et un agenda, et la demande doit passer par
  -- book_public_appointment, qui vérifie une disponibilité réelle. Envoyer une
  -- demande d'intérêt à quelqu'un qui a un vrai agenda serait lui faire
  -- retaper à la main ce que la base sait déjà.
  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional is on FadeUp; book a real slot instead'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=professional_is_claimed';
  end if;

  -- Un profil retiré de la marketplace ou marqué do_not_contact ne reçoit
  -- plus rien. La garde vit ici, à la porte d'entrée, en plus de celle des
  -- relances : une demande créée après un retrait produirait un e-mail que la
  -- relance refuserait ensuite d'envoyer, donc une demande morte-née.
  if exists (
    select 1
    from public.prospect_professionals pp
    join public.prospects pr on pr.id = pp.prospect_id
    where pp.professional_id = p_professional_id
      and pr.do_not_contact
  ) then
    raise exception 'this profile is not open to requests'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=profile_withdrawn';
  end if;

  v_user_id := (select auth.uid());

  insert into public.professional_interest_requests (
    professional_id, customer_display_name, service_label,
    preferred_starts_at, notes, locale, status, expires_at
  )
  values (
    p_professional_id,
    private.reduce_customer_display_name(p_customer_name),
    btrim(p_service_label),
    p_preferred_starts_at,
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when lower(coalesce(p_locale, 'fr')) = 'en' then 'en' else 'fr' end,
    'pending',
    -- Valeur provisoire : le trigger la dérive et la plafonne. La colonne est
    -- NOT NULL, il faut bien poser quelque chose.
    p_preferred_starts_at
  )
  returning * into v_request;

  insert into public.professional_interest_request_contacts (
    request_id, customer_email, customer_phone, booked_by_user_id
  )
  values (
    v_request.id,
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    v_user_id
  );

  return query select
    v_request.id,
    v_request.status,
    v_request.preferred_starts_at,
    v_request.expires_at,
    v_professional.display_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_customers_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- X3 : l'absence de JWT n'exempte que les sessions serveur — jamais le
  -- rôle-claim 'anon' d'un client PostgREST.
  if ((select auth.uid()) is null
      and coalesce((select auth.role()), '') not in ('anon', 'authenticated'))
     or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_marketplace_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ready boolean;
  v_missing text[];
begin
  if new.marketplace_visible is not true or old.marketplace_visible is true then
    return new;
  end if;

  -- No JWT identity: operator SQL or a restore. Same documented escape hatch
  -- as guard_professional_application_update() and the organization-creation
  -- guard — never a client request.
  if (select auth.uid()) is null then
    -- X3 : même durcissement que les autres gardes — l'échappatoire ne vaut
    -- que pour les sessions serveur, pas pour un rôle-claim client.
    if coalesce((select auth.role()), '') in ('anon', 'authenticated') then
      raise exception 'marketplace publication requires an authenticated session'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select r.ready_to_publish, r.missing_requirements
    into v_ready, v_missing
    from public.get_organization_readiness(new.id) r;

  if not coalesce(v_ready, false) then
    raise exception 'this business is not ready to publish yet: missing %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_professional_application_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- No JWT identity at all means this is not a client request: a trusted
  -- server-side role, or a foreign-key cascade (deleting an organization
  -- sets organization_id to null here). Those must not be blocked — RLS and
  -- the EXECUTE grants are what keep anon/authenticated out of this path in
  -- the first place.
  if (select auth.uid()) is null then
    -- X3 : sessions serveur et cascades FK seulement — un client PostgREST
    -- porte toujours un rôle-claim, et 'anon'/'authenticated' sont refusés.
    if coalesce((select auth.role()), '') in ('anon', 'authenticated') then
      raise exception 'only a platform reviewer can change the review state of an application'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (select private.is_platform_admin()) then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.organization_id is distinct from old.organization_id
     or new.rejection_reason is distinct from old.rejection_reason
     or new.internal_note is distinct from old.internal_note
     or new.user_id is distinct from old.user_id
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'only a platform reviewer can change the review state of an application';
  end if;

  return new;
end;
$function$
;

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
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  -- X3 : coalesce anti-NULL — un rendez-vous walk-in (customer_id NULL) rendait
  -- la comparaison IN NULL, et « if not (false or NULL) » ne levait pas.
  v_is_customer := coalesce(v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  ), false);

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking' using errcode = '42501';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled' using errcode = '22023';
  end if;

  if p_starts_at is null then
    raise exception 'the new time is required' using errcode = '22023';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future' using errcode = '22023';
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
      raise exception 'that professional is not available for this service' using errcode = '22023';
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
    raise exception 'requested time is outside available hours' using errcode = '22023';
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


-- 4a. staff_profiles_insert : qualification correcte de l'appartenance.
-- user_id NULL reste permis (staff sans compte, colonne nullable par
-- conception) ; un user_id non NULL doit être membre de la même organisation.
drop policy staff_profiles_insert on public.staff_profiles;
create policy staff_profiles_insert
  on public.staff_profiles
  for insert
  to authenticated
  with check (
    (select private.has_org_role(staff_profiles.organization_id, array['owner', 'manager']::public.membership_role[]))
    and (
      staff_profiles.user_id is null
      or exists (
        select 1 from public.memberships m
        where m.organization_id = staff_profiles.organization_id
          and m.user_id = staff_profiles.user_id
      )
    )
  );

-- 4b. Garde de réassignation de user_id en UPDATE.
create or replace function private.enforce_staff_profile_identity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- Sessions serveur (uid NULL sans rôle-claim client) et admins plateforme.
  if ((select auth.uid()) is null
      and coalesce((select auth.role()), '') not in ('anon', 'authenticated'))
     or (select private.is_platform_admin()) then
    return new;
  end if;

  -- Détacher un compte est permis au rôle que la policy UPDATE autorise déjà.
  if new.user_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.user_id
  ) then
    raise exception 'staff_profiles.user_id must reference a member of the organization'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_staff_profile_identity() from public;

drop trigger if exists enforce_staff_profile_identity on public.staff_profiles;
create trigger enforce_staff_profile_identity
  before update on public.staff_profiles
  for each row
  execute function private.enforce_staff_profile_identity();

-- 5a. post_likes : le SELECT « true » laissait énumérer les paires
-- (post_id, user_id) de posts non visibles pour le lecteur.
drop policy post_likes_select_all on public.post_likes;
create policy post_likes_select_visible
  on public.post_likes
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_view_post(post_id)
  );

-- 5b. « to public » n'a aucun usage : anon n'a pas SELECT sur ces tables,
-- mais la policy ne doit pas dépendre de l'état des GRANTs.
drop policy queue_entry_moves_select on public.queue_entry_moves;
create policy queue_entry_moves_select
  on public.queue_entry_moves
  for select
  to authenticated
  using ((select private.is_org_member(queue_entry_moves.organization_id)));

drop policy service_duration_samples_select on public.service_duration_samples;
create policy service_duration_samples_select
  on public.service_duration_samples
  for select
  to authenticated
  using ((select private.is_org_member(service_duration_samples.organization_id)));

commit;
