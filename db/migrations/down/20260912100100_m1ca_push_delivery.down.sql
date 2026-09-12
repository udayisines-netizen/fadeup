-- FadeUp — retour arrière de M1c-a (2/2) : le push.
--
-- Remet la base dans l'état qui précède 20260912100100 :
--
--   1. le trigger d'appel de file est retiré ;
--   2. `private.emit_booking_notification` retrouve SON CORPS D'AVANT — celui
--      de la production (lot C + B2), sans le bloc push. C'est la seule pièce
--      du lot qui MODIFIE un objet existant, donc la seule dont le retour
--      arrière ne peut pas se réduire à un DROP ;
--   3. les fonctions et les tables du lot sont supprimées.
--
-- Les données de `push_outbox`, `push_devices` et `appointment_reminder_log`
-- sont PERDUES par ce retour arrière : ce sont des jetons d'appareils et une trace d'envois, pas des
-- données métier, et les jetons se re-enregistrent au prochain lancement de
-- l'application. `push_post_fanout` disparaît aussi : sans le reste, plus rien
-- ne le lit — et si le lot est rejoué, la fenêtre de six heures empêche de
-- réveiller les abonnés pour des posts anciens.
--
-- Les valeurs d'enum de `notification_type` ne sont pas retirables : voir
-- 20260912100000_m1ca_push_notification_types.down.sql.
--
-- Idempotent : `if exists` partout. UNE SEULE transaction : un retour arrière
-- à moitié appliqué serait pire que pas de retour arrière du tout.

set lock_timeout = '5s';

begin;

drop trigger if exists queue_entries_notify_called on public.queue_entries;
drop function if exists public.queue_entries_notify_called();

drop function if exists public.run_push_maintenance();
drop function if exists public.register_push_device(text, text, text, uuid);
drop function if exists public.revoke_push_device(text);
drop function if exists public.get_my_notification_preferences();
drop function if exists public.set_my_notification_preference(text, boolean);

drop function if exists private.push_receipt_resolve_batch(integer);
drop function if exists private.push_receipt_request_batch(integer);
drop function if exists private.push_reconcile_batch(integer);
drop function if exists private.push_dispatch_batch(integer);
drop function if exists private.expo_access_token();
drop function if exists private.enqueue_post_pushes(integer);
drop function if exists private.enqueue_appointment_reminders(integer);
-- Les DEUX signatures : celle du premier jet du lot et celle qui a ajouté
-- `p_not_after`. Un retour arrière ne doit pas laisser une orpheline.
drop function if exists private.enqueue_push(text, public.notification_type, jsonb, jsonb, text, uuid, uuid, boolean, text);
drop function if exists private.enqueue_push(text, public.notification_type, jsonb, jsonb, text, uuid, uuid, boolean, text, timestamptz);
drop function if exists private.render_push_template(text, text, jsonb);
drop function if exists private.push_category_enabled(uuid, public.push_category);
drop function if exists private.push_next_window(text);

-- ---------------------------------------------------------------------------
-- emit_booking_notification : le corps d'AVANT M1c-a, à l'identique — repris
-- de pg_get_functiondef sur la production, commentaires compris, pour qu'un
-- pg_dump -s d'après retour arrière soit IDENTIQUE à celui d'avant le lot.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.emit_booking_notification(p_appointment appointments, p_type notification_type, p_audience text, p_title text, p_body text DEFAULT NULL::text, p_email_template text DEFAULT NULL::text, p_dedupe_suffix text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_email text;
  v_org_name text;
  v_service_name text;
  v_recipient record;
  v_timezone text;
  v_payload jsonb;
  v_locale text;
begin
  select o.name into v_org_name from public.organizations o where o.id = p_appointment.organization_id;
  select s.name into v_service_name from public.services s where s.id = p_appointment.service_id;
  select l.timezone into v_timezone from public.locations l where l.id = p_appointment.location_id;
  v_timezone := coalesce(v_timezone, 'UTC');

  -- Le payload commun aux deux publics. `expires_at` n'est renseigné que sur
  -- une demande — sur une réservation confirmée il n'y a rien à faire expirer,
  -- et un gabarit qui l'attendrait échouerait bruyamment au rendu plutôt que
  -- d'afficher une échéance vide.
  v_payload := jsonb_build_object(
    'appointment_id', p_appointment.id,
    'organization_name', coalesce(v_org_name, ''),
    'service_name', coalesce(v_service_name, ''),
    'starts_at', p_appointment.starts_at,
    'starts_at_fr', to_char(p_appointment.starts_at at time zone v_timezone, 'DD/MM/YYYY à HH24:MI'),
    'starts_at_en', to_char(p_appointment.starts_at at time zone v_timezone, 'YYYY-MM-DD at HH24:MI'),
    'timezone', v_timezone,
    'customer_name', p_appointment.customer_name
  );

  if p_appointment.expires_at is not null then
    v_payload := v_payload || jsonb_build_object(
      'expires_at_fr', to_char(p_appointment.expires_at at time zone v_timezone, 'DD/MM/YYYY à HH24:MI'),
      'expires_at_en', to_char(p_appointment.expires_at at time zone v_timezone, 'YYYY-MM-DD at HH24:MI')
    );
  end if;

  if p_audience = 'customer' then
    -- The account behind the booking, if there is one. An anonymous booking
    -- has no account to notify in-app; it still gets the email, because the
    -- appointment carries the address that was typed at booking time.
    select c.user_id into v_user_id
      from public.customers c where c.id = p_appointment.customer_id;
    v_email := p_appointment.customer_email;

    if v_user_id is not null then
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':customer' || p_dedupe_suffix)
      on conflict (dedupe_key) do nothing;
    end if;

    if v_email is not null and p_email_template is not null then
      select p.locale into v_locale from public.profiles p where p.id = v_user_id;
      insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
      values (v_email, p_email_template,
              case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
              v_payload, 'transactional',
              p_appointment.id::text || ':' || p_email_template || ':customer' || p_dedupe_suffix)
      -- Le prédicat est OBLIGATOIRE : email_outbox_dedupe_key_unique est un
      -- index unique PARTIEL, et Postgres ne l'infère qu'à condition qu'on
      -- répète sa condition ici. Sans elle : « there is no unique or
      -- exclusion constraint matching the ON CONFLICT specification ».
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;

  elsif p_audience = 'business' then
    -- Everyone who can actually act on it. A request that only reaches the
    -- owner is a request that waits for the owner to be free.
    for v_recipient in
      select m.user_id
        from public.memberships m
        where m.organization_id = p_appointment.organization_id
          and m.role in ('owner', 'manager', 'receptionist')
    loop
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_recipient.user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':' || v_recipient.user_id::text || p_dedupe_suffix)
      -- notifications.dedupe_key porte une contrainte unique PLEINE : pas de
      -- prédicat ici, contrairement aux insertions dans email_outbox.
      on conflict (dedupe_key) do nothing;
    end loop;

    if p_email_template is not null then
      -- One address for the shop: the owner's. Fanning transactional email out
      -- to every member is a notification-preference decision, not a booking
      -- one, and belongs with the preferences that do not exist yet.
      select u.email, pr.locale into v_email, v_locale
        from public.memberships m
        join auth.users u on u.id = m.user_id
        left join public.profiles pr on pr.id = m.user_id
        where m.organization_id = p_appointment.organization_id and m.role = 'owner'
        order by m.created_at
        limit 1;

      if v_email is not null then
        insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
        values (v_email, p_email_template,
                case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
                v_payload, 'transactional',
                p_appointment.id::text || ':' || p_email_template || ':business' || p_dedupe_suffix)
        -- Le prédicat est OBLIGATOIRE : email_outbox_dedupe_key_unique est un
      -- index unique PARTIEL, et Postgres ne l'infère qu'à condition qu'on
      -- répète sa condition ici. Sans elle : « there is no unique or
      -- exclusion constraint matching the ON CONFLICT specification ».
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end if;
end;
$function$;

revoke execute on function private.emit_booking_notification(
  public.appointments, public.notification_type, text, text, text, text, text
) from public, anon, authenticated;

drop table if exists public.appointment_reminder_log;
drop table if exists public.push_post_fanout;
drop table if exists public.push_receipt_requests;
drop table if exists public.push_outbox;
drop table if exists public.push_templates;
drop table if exists public.notification_push_preferences;
drop table if exists public.push_devices;

drop type if exists public.push_category;
drop type if exists public.push_delivery_status;
drop type if exists public.push_platform;

commit;
