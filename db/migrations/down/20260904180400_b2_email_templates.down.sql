-- FadeUp — B2 chantier 4, retour arrière.
--
-- Supprime les 26 gabarits et rend à emit_booking_notification son payload
-- d'origine : plus de dates formatees dans le fuseau du lieu, plus de langue
-- du destinataire, plus de dedupe_key sur l'outbox.
--
-- CE QUE ÇA RESTAURE, EN CLAIR : les e-mails transactionnels redeviennent
-- inenvoyables, puisque l'expéditeur ne trouve plus de gabarit — chaque ligne
-- d'outbox passera en `failed` avec « no email template for key ». Et
-- l'absence de dedupe_key rouvre la porte au doublon qu'elle ferme.
--
-- Doit être exécuté AVANT le retour arrière de 20260904180300, qui supprime
-- les colonnes que la version B2 de cette fonction utilise.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

delete from public.email_templates;

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
begin
  select o.name into v_org_name from public.organizations o where o.id = p_appointment.organization_id;
  select s.name into v_service_name from public.services s where s.id = p_appointment.service_id;

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
      insert into public.email_outbox (to_email, template, payload)
      values (v_email, p_email_template, jsonb_build_object(
        'appointment_id', p_appointment.id,
        'organization_name', v_org_name,
        'service_name', v_service_name,
        'starts_at', p_appointment.starts_at,
        'customer_name', p_appointment.customer_name
      ));
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
      on conflict (dedupe_key) do nothing;
    end loop;

    if p_email_template is not null then
      -- One address for the shop: the owner's. Fanning transactional email out
      -- to every member is a notification-preference decision, not a booking
      -- one, and belongs with the preferences that do not exist yet.
      select u.email into v_email
        from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.organization_id = p_appointment.organization_id and m.role = 'owner'
        order by m.created_at
        limit 1;

      if v_email is not null then
        insert into public.email_outbox (to_email, template, payload)
        values (v_email, p_email_template, jsonb_build_object(
          'appointment_id', p_appointment.id,
          'organization_name', v_org_name,
          'service_name', v_service_name,
          'starts_at', p_appointment.starts_at,
          'customer_name', p_appointment.customer_name
        ));
      end if;
    end if;
  end if;
end;
$function$;

comment on function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text) is null;

commit;
