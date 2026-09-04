-- FadeUp — B2, chantier 4: les gabarits, FR et EN, texte brut et HTML.
--
-- RÈGLE DE RÉDACTION QUI PRIME SUR TOUTES LES AUTRES
--
-- MASTER_SPEC §5 : « Le client sait qu'il envoie une demande, pas qu'il a un
-- rendez-vous. JAMAIS une intention présentée comme une confirmation. »
--
-- Aucun gabarit de demande ne contient « réservé », « booked », « confirmé »
-- ou « confirmed ». La suite de vérification B2 parcourt les 26 lignes de
-- cette table et échoue si l'un de ces mots apparaît dans un gabarit de
-- demande — la règle est testée, pas seulement respectée aujourd'hui.
--
-- Et une demande expirée n'est NI un no-show NI un refus : le client n'a rien
-- fait de mal, le salon non plus. Le gabarit `booking_expired` dit exactement
-- cela et enchaîne sur des alternatives.
--
-- LA DATE
--
-- emit_booking_notification ne posait dans le payload qu'un `starts_at` brut,
-- c'est-à-dire « 2026-09-05T07:30:00+00:00 » dans le corps d'un e-mail client.
-- Ce fichier y ajoute `starts_at_fr` et `starts_at_en`, formatés dans le
-- fuseau du LIEU — un rendez-vous à Paris se dit à l'heure de Paris — plus le
-- nom du fuseau, pour les cas où il diffère de celui du lecteur.
--
-- Deux clés plutôt qu'une clé sensible à la locale : `to_char` dépend de
-- lc_time, un réglage de session que rien ici ne contrôle, et un e-mail dont
-- la date change selon le réglage du serveur est un e-mail qu'on ne peut pas
-- tester.
--
-- Idempotent : sans risque à rejouer. Les gabarits sont réécrits à chaque
-- passage (ON CONFLICT DO UPDATE), parce que corriger une faute dans un
-- gabarit doit se faire en rejouant la migration corrigée.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Des dates lisibles dans le payload
-- ---------------------------------------------------------------------------

create or replace function private.emit_booking_notification(
  p_appointment public.appointments,
  p_type public.notification_type,
  p_audience text,
  p_title text,
  p_body text default null,
  p_email_template text default null,
  p_dedupe_suffix text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text) is
  'Écrit la notification in-app et la ligne d''outbox pour un événement de réservation. B2 y ajoute trois choses : des dates formatées dans le fuseau du LIEU (starts_at_fr / starts_at_en / expires_at_*), la langue du destinataire lue depuis profiles.locale, et une dedupe_key d''outbox — sans elle, un rejeu du même événement enverrait deux fois le même e-mail.';

-- ---------------------------------------------------------------------------
-- 2. Une coquille HTML unique
--
-- Créée, utilisée, puis supprimée en fin de fichier : c'est un outil de
-- migration, pas une API. Écrire 26 fois le même <table> serait 26 occasions
-- de diverger.
-- ---------------------------------------------------------------------------

create or replace function pg_temp_b2_shell(p_heading text, p_body_html text, p_footer_html text default '')
returns text
language sql
immutable
as $$
  select concat(
'<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f6;">',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f6;padding:32px 16px;">',
'<tr><td align="center">',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8e7;border-radius:12px;">',
'<tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;">',
'<div style="font-size:14px;font-weight:600;color:#00875A;letter-spacing:0.02em;">FadeUp</div>',
'<h1 style="margin:16px 0 0 0;font-size:22px;line-height:1.3;color:#080F0D;font-weight:600;">', p_heading, '</h1>',
'</td></tr>',
'<tr><td style="padding:8px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#2c3330;">',
p_body_html,
'</td></tr>',
'</table>',
case when p_footer_html = '' then '' else
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b736f;">'
|| p_footer_html || '</td></tr></table>' end,
'</td></tr></table></body></html>');
$$;

create or replace function pg_temp_b2_button(p_url text, p_label text)
returns text
language sql
immutable
as $$
  select '<p style="margin:24px 0;"><a href="' || p_url || '" style="display:inline-block;background:#00C27A;color:#080F0D;text-decoration:none;font-weight:600;font-size:16px;padding:12px 20px;border-radius:8px;">' || p_label || '</a></p>';
$$;

-- ---------------------------------------------------------------------------
-- 3. Les gabarits
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html) values

-- === PROSPECTION — touche 1, immédiate ====================================
('prospect_request_first', 'fr', 'prospecting',
 'Un client souhaite réserver chez vous sur FadeUp',
 E'Bonjour,\n\n{{customer_display_name}} souhaite réserver chez vous sur FadeUp.\n\nService demandé : {{service_label}}\nCréneau souhaité : {{preferred_starts_at_fr}}\nSecteur : {{city}}\n\nVotre profil a été créé à partir de sources publiques et n''est pas encore géré par vous. Revendiquez-le — c''est gratuit et immédiat — pour voir cette demande et y répondre.\n\n{{profile_url}}\n\nSi vous ne souhaitez plus recevoir ces messages : {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   'Un client souhaite réserver chez vous',
   '<p style="margin:0 0 16px 0;"><strong>{{customer_display_name}}</strong> a envoyé une demande à votre profil sur FadeUp.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_label}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Créneau souhaité</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{preferred_starts_at_fr}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Secteur</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{city}}</td></tr>'
   || '</table>'
   || '<p style="margin:0 0 8px 0;">Votre profil a été créé à partir de sources publiques et n''est pas encore géré par vous.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'Voir la demande et revendiquer'),
   'Vous recevez ce message parce qu''un profil professionnel vous concernant est publié sur FadeUp. <a href="{{unsubscribe_url}}" style="color:#6b736f;">Ne plus recevoir ces messages</a>.')),

('prospect_request_first', 'en', 'prospecting',
 'A customer wants to book with you on FadeUp',
 E'Hello,\n\n{{customer_display_name}} wants to book with you on FadeUp.\n\nService requested: {{service_label}}\nPreferred time: {{preferred_starts_at_en}}\nArea: {{city}}\n\nYour profile was created from public sources and is not managed by you yet. Claim it — it is free and instant — to see this request and respond.\n\n{{profile_url}}\n\nTo stop receiving these messages: {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   'A customer wants to book with you',
   '<p style="margin:0 0 16px 0;"><strong>{{customer_display_name}}</strong> sent a request to your profile on FadeUp.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_label}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Preferred time</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{preferred_starts_at_en}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Area</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{city}}</td></tr>'
   || '</table>'
   || '<p style="margin:0 0 8px 0;">Your profile was created from public sources and is not managed by you yet.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'See the request and claim'),
   'You are receiving this because a professional profile about you is published on FadeUp. <a href="{{unsubscribe_url}}" style="color:#6b736f;">Stop receiving these messages</a>.')),

-- === PROSPECTION — touche 2, relance ======================================
('prospect_request_reminder', 'fr', 'prospecting',
 '{{customer_display_name}} attend toujours votre réponse',
 E'Bonjour,\n\nLa demande de {{customer_display_name}} pour « {{service_label}} » est toujours en attente.\n\nCréneau souhaité : {{preferred_starts_at_fr}}\n\nRevendiquer votre profil prend une minute et vous permet d''y répondre.\n\n{{profile_url}}\n\nSe désabonner : {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   '{{customer_display_name}} attend toujours',
   '<p style="margin:0 0 16px 0;">La demande pour <strong>{{service_label}}</strong> ({{preferred_starts_at_fr}}) n''a pas encore reçu de réponse.</p>'
   || '<p style="margin:0 0 8px 0;">Revendiquer votre profil prend une minute, et c''est gratuit.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'Répondre à la demande'),
   '<a href="{{unsubscribe_url}}" style="color:#6b736f;">Ne plus recevoir ces messages</a>.')),

('prospect_request_reminder', 'en', 'prospecting',
 '{{customer_display_name}} is still waiting for your reply',
 E'Hello,\n\n{{customer_display_name}}''s request for "{{service_label}}" is still waiting.\n\nPreferred time: {{preferred_starts_at_en}}\n\nClaiming your profile takes a minute and lets you respond.\n\n{{profile_url}}\n\nUnsubscribe: {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   '{{customer_display_name}} is still waiting',
   '<p style="margin:0 0 16px 0;">The request for <strong>{{service_label}}</strong> ({{preferred_starts_at_en}}) has not been answered yet.</p>'
   || '<p style="margin:0 0 8px 0;">Claiming your profile takes a minute, and it is free.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'Respond to the request'),
   '<a href="{{unsubscribe_url}}" style="color:#6b736f;">Stop receiving these messages</a>.')),

-- === PROSPECTION — touche 3, dernier rappel ===============================
('prospect_request_final', 'fr', 'prospecting',
 'Dernier rappel : la demande expire le {{expires_at_fr}}',
 E'Bonjour,\n\nDernier message au sujet de la demande de {{customer_display_name}}.\n\nService : {{service_label}}\nCréneau souhaité : {{preferred_starts_at_fr}}\nLa demande expire le {{expires_at_fr}}.\n\nPassé cette échéance, le client sera orienté vers d''autres professionnels du secteur.\n\n{{profile_url}}\n\nSe désabonner : {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   'Dernier rappel',
   '<p style="margin:0 0 16px 0;">La demande de <strong>{{customer_display_name}}</strong> pour {{service_label}} ({{preferred_starts_at_fr}}) expire le <strong>{{expires_at_fr}}</strong>.</p>'
   || '<p style="margin:0 0 8px 0;">Passé cette échéance, le client sera orienté vers d''autres professionnels du secteur. C''est le dernier message que nous vous envoyons à ce sujet.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'Voir la demande'),
   '<a href="{{unsubscribe_url}}" style="color:#6b736f;">Ne plus recevoir ces messages</a>.')),

('prospect_request_final', 'en', 'prospecting',
 'Final reminder: the request expires on {{expires_at_en}}',
 E'Hello,\n\nLast message about {{customer_display_name}}''s request.\n\nService: {{service_label}}\nPreferred time: {{preferred_starts_at_en}}\nThe request expires on {{expires_at_en}}.\n\nAfter that, the customer will be pointed to other professionals in the area.\n\n{{profile_url}}\n\nUnsubscribe: {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_b2_shell(
   'Final reminder',
   '<p style="margin:0 0 16px 0;"><strong>{{customer_display_name}}</strong>''s request for {{service_label}} ({{preferred_starts_at_en}}) expires on <strong>{{expires_at_en}}</strong>.</p>'
   || '<p style="margin:0 0 8px 0;">After that, the customer will be pointed to other professionals in the area. This is the last message we will send about it.</p>'
   || pg_temp_b2_button('{{profile_url}}', 'See the request'),
   '<a href="{{unsubscribe_url}}" style="color:#6b736f;">Stop receiving these messages</a>.')),

-- === TRANSACTIONNEL — demande envoyée (client) ============================
('booking_request_sent', 'fr', 'transactional',
 'Votre demande a été envoyée à {{organization_name}}',
 E'Bonjour {{customer_name}},\n\nVotre demande a été envoyée. Ce n''est pas encore un rendez-vous : {{organization_name}} doit la confirmer.\n\nService : {{service_name}}\nCréneau demandé : {{starts_at_fr}} ({{timezone}})\nRéponse attendue avant le {{expires_at_fr}}\n\nNous vous préviendrons dès que le salon répond. Sans réponse à l''échéance, nous vous proposerons des alternatives proches.\n\nFadeUp',
 pg_temp_b2_shell(
   'Demande envoyée',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, votre demande est partie. <strong>Ce n''est pas encore un rendez-vous</strong> : {{organization_name}} doit la confirmer.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Créneau demandé</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{starts_at_fr}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Réponse attendue avant</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{expires_at_fr}}</td></tr>'
   || '</table>'
   || '<p style="margin:0;">Nous vous préviendrons dès que le salon répond. Sans réponse à l''échéance, nous vous proposerons des alternatives proches.</p>', '')),

('booking_request_sent', 'en', 'transactional',
 'Your request was sent to {{organization_name}}',
 E'Hello {{customer_name}},\n\nYour request has been sent. This is not a booking yet: {{organization_name}} still has to confirm it.\n\nService: {{service_name}}\nRequested time: {{starts_at_en}} ({{timezone}})\nAnswer expected before {{expires_at_en}}\n\nWe will let you know as soon as the shop replies. If there is no answer by then, we will suggest nearby alternatives.\n\nFadeUp',
 pg_temp_b2_shell(
   'Request sent',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, your request is on its way. <strong>This is not a booking yet</strong>: {{organization_name}} still has to confirm it.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Requested time</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{starts_at_en}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Answer expected before</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{expires_at_en}}</td></tr>'
   || '</table>'
   || '<p style="margin:0;">We will let you know as soon as the shop replies. If there is no answer by then, we will suggest nearby alternatives.</p>', '')),

-- === TRANSACTIONNEL — nouvelle demande (salon) ============================
('booking_request_created', 'fr', 'transactional',
 'Nouvelle demande de {{customer_name}} — réponse avant le {{expires_at_fr}}',
 E'Bonjour,\n\nVous avez reçu une demande de réservation.\n\nClient : {{customer_name}}\nService : {{service_name}}\nCréneau demandé : {{starts_at_fr}} ({{timezone}})\nÀ répondre avant le {{expires_at_fr}}\n\nSans réponse de votre part à l''échéance, la demande expire et le créneau est libéré.\n\nFadeUp',
 pg_temp_b2_shell(
   'Nouvelle demande de réservation',
   '<p style="margin:0 0 16px 0;"><strong>{{customer_name}}</strong> a demandé un créneau.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Créneau demandé</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{starts_at_fr}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">À répondre avant</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{expires_at_fr}}</td></tr>'
   || '</table>'
   || '<p style="margin:0;">Sans réponse à l''échéance, la demande expire et le créneau est libéré.</p>', '')),

('booking_request_created', 'en', 'transactional',
 'New request from {{customer_name}} — answer before {{expires_at_en}}',
 E'Hello,\n\nYou have received a booking request.\n\nCustomer: {{customer_name}}\nService: {{service_name}}\nRequested time: {{starts_at_en}} ({{timezone}})\nAnswer before {{expires_at_en}}\n\nWithout an answer by then, the request expires and the slot is released.\n\nFadeUp',
 pg_temp_b2_shell(
   'New booking request',
   '<p style="margin:0 0 16px 0;"><strong>{{customer_name}}</strong> requested a slot.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Requested time</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{starts_at_en}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Answer before</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{expires_at_en}}</td></tr>'
   || '</table>'
   || '<p style="margin:0;">Without an answer by then, the request expires and the slot is released.</p>', '')),

-- === TRANSACTIONNEL — confirmée ===========================================
('booking_confirmed', 'fr', 'transactional',
 'Votre rendez-vous chez {{organization_name}} est confirmé',
 E'Bonjour {{customer_name}},\n\nVotre rendez-vous est confirmé.\n\n{{organization_name}}\nService : {{service_name}}\nLe {{starts_at_fr}} ({{timezone}})\n\nÀ bientôt.\n\nFadeUp',
 pg_temp_b2_shell(
   'Rendez-vous confirmé',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, c''est confirmé.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Salon</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{organization_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Date</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{starts_at_fr}}</td></tr>'
   || '</table>', '')),

('booking_confirmed', 'en', 'transactional',
 'Your appointment at {{organization_name}} is confirmed',
 E'Hello {{customer_name}},\n\nYour appointment is confirmed.\n\n{{organization_name}}\nService: {{service_name}}\nOn {{starts_at_en}} ({{timezone}})\n\nSee you soon.\n\nFadeUp',
 pg_temp_b2_shell(
   'Appointment confirmed',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, you are all set.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Shop</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{organization_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Date</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{starts_at_en}}</td></tr>'
   || '</table>', '')),

-- === TRANSACTIONNEL — refusée =============================================
('booking_declined', 'fr', 'transactional',
 '{{organization_name}} n''a pas pu accepter votre demande',
 E'Bonjour {{customer_name}},\n\n{{organization_name}} n''a pas pu accepter votre demande pour {{service_name}} du {{starts_at_fr}}.\n\nCela arrive : un créneau se remplit, une équipe change. Vous pouvez chercher un autre horaire ou un autre professionnel du secteur.\n\nFadeUp',
 pg_temp_b2_shell(
   'Demande non acceptée',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, {{organization_name}} n''a pas pu accepter votre demande pour <strong>{{service_name}}</strong> du {{starts_at_fr}}.</p>'
   || '<p style="margin:0;">Cela arrive : un créneau se remplit, une équipe change. Vous pouvez chercher un autre horaire ou un autre professionnel du secteur.</p>', '')),

('booking_declined', 'en', 'transactional',
 '{{organization_name}} could not accept your request',
 E'Hello {{customer_name}},\n\n{{organization_name}} could not accept your request for {{service_name}} on {{starts_at_en}}.\n\nIt happens: a slot fills up, a team changes. You can look for another time or another professional in the area.\n\nFadeUp',
 pg_temp_b2_shell(
   'Request not accepted',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, {{organization_name}} could not accept your request for <strong>{{service_name}}</strong> on {{starts_at_en}}.</p>'
   || '<p style="margin:0;">It happens: a slot fills up, a team changes. You can look for another time or another professional in the area.</p>', '')),

-- === TRANSACTIONNEL — expirée =============================================
-- NI un no-show, NI un refus. Le client n'a rien fait de mal, le salon non
-- plus. MASTER_SPEC §5 l'exige explicitement et c'est le gabarit où la
-- tentation de blâmer quelqu'un est la plus forte.
('booking_expired', 'fr', 'transactional',
 'Votre demande n''a pas été confirmée à temps',
 E'Bonjour {{customer_name}},\n\nVotre demande pour {{service_name}} du {{starts_at_fr}} n''a pas été confirmée à temps par {{organization_name}}.\n\nLe créneau est de nouveau libre pour tout le monde. Personne n''a annulé : la demande a simplement atteint son échéance.\n\nDes professionnels proches peuvent assurer un service équivalent — nous vous les proposons dans l''application.\n\nFadeUp',
 pg_temp_b2_shell(
   'Demande non confirmée à temps',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, votre demande pour <strong>{{service_name}}</strong> du {{starts_at_fr}} n''a pas été confirmée à temps par {{organization_name}}.</p>'
   || '<p style="margin:0 0 16px 0;">Le créneau est de nouveau libre pour tout le monde. Personne n''a annulé : la demande a simplement atteint son échéance.</p>'
   || '<p style="margin:0;">Des professionnels proches peuvent assurer un service équivalent — nous vous les proposons dans l''application.</p>', '')),

('booking_expired', 'en', 'transactional',
 'Your request was not confirmed in time',
 E'Hello {{customer_name}},\n\nYour request for {{service_name}} on {{starts_at_en}} was not confirmed in time by {{organization_name}}.\n\nThe slot is open again for everyone. Nobody cancelled: the request simply reached its deadline.\n\nProfessionals nearby can provide an equivalent service — we suggest them in the app.\n\nFadeUp',
 pg_temp_b2_shell(
   'Request not confirmed in time',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, your request for <strong>{{service_name}}</strong> on {{starts_at_en}} was not confirmed in time by {{organization_name}}.</p>'
   || '<p style="margin:0 0 16px 0;">The slot is open again for everyone. Nobody cancelled: the request simply reached its deadline.</p>'
   || '<p style="margin:0;">Professionals nearby can provide an equivalent service — we suggest them in the app.</p>', '')),

-- === TRANSACTIONNEL — annulée =============================================
('booking_cancelled', 'fr', 'transactional',
 'Votre rendez-vous chez {{organization_name}} a été annulé',
 E'Bonjour {{customer_name}},\n\nVotre rendez-vous pour {{service_name}} du {{starts_at_fr}} chez {{organization_name}} a été annulé.\n\nVous pouvez reprendre un créneau quand vous voulez.\n\nFadeUp',
 pg_temp_b2_shell(
   'Rendez-vous annulé',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, votre rendez-vous pour <strong>{{service_name}}</strong> du {{starts_at_fr}} chez {{organization_name}} a été annulé.</p>'
   || '<p style="margin:0;">Vous pouvez reprendre un créneau quand vous voulez.</p>', '')),

('booking_cancelled', 'en', 'transactional',
 'Your appointment at {{organization_name}} was cancelled',
 E'Hello {{customer_name}},\n\nYour appointment for {{service_name}} on {{starts_at_en}} at {{organization_name}} was cancelled.\n\nYou can book another slot whenever you like.\n\nFadeUp',
 pg_temp_b2_shell(
   'Appointment cancelled',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, your appointment for <strong>{{service_name}}</strong> on {{starts_at_en}} at {{organization_name}} was cancelled.</p>'
   || '<p style="margin:0;">You can book another slot whenever you like.</p>', '')),

-- === TRANSACTIONNEL — rappel ==============================================
('booking_reminder', 'fr', 'transactional',
 'Rappel : {{service_name}} chez {{organization_name}} le {{starts_at_fr}}',
 E'Bonjour {{customer_name}},\n\nPetit rappel de votre rendez-vous.\n\n{{organization_name}}\nService : {{service_name}}\nLe {{starts_at_fr}} ({{timezone}})\n\nFadeUp',
 pg_temp_b2_shell(
   'Rappel de rendez-vous',
   '<p style="margin:0 0 16px 0;">Bonjour {{customer_name}}, petit rappel.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Salon</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{organization_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Date</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{starts_at_fr}}</td></tr>'
   || '</table>', '')),

('booking_reminder', 'en', 'transactional',
 'Reminder: {{service_name}} at {{organization_name}} on {{starts_at_en}}',
 E'Hello {{customer_name}},\n\nA quick reminder about your appointment.\n\n{{organization_name}}\nService: {{service_name}}\nOn {{starts_at_en}} ({{timezone}})\n\nFadeUp',
 pg_temp_b2_shell(
   'Appointment reminder',
   '<p style="margin:0 0 16px 0;">Hello {{customer_name}}, a quick reminder.</p>'
   || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Shop</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{organization_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;border-bottom:1px solid #eef0ef;color:#6b736f;font-size:14px;">Service</td><td style="padding:8px 0;border-bottom:1px solid #eef0ef;text-align:right;font-weight:600;">{{service_name}}</td></tr>'
   || '<tr><td style="padding:8px 0;color:#6b736f;font-size:14px;">Date</td><td style="padding:8px 0;text-align:right;font-weight:600;">{{starts_at_en}}</td></tr>'
   || '</table>', '')),

-- === TRANSACTIONNEL — invitation d'équipe =================================
('team_invitation', 'fr', 'transactional',
 '{{invited_by}} vous invite à rejoindre {{organization_name}} sur FadeUp',
 E'Bonjour,\n\n{{invited_by}} vous invite à rejoindre {{organization_name}} sur FadeUp en tant que {{role}}.\n\nL''invitation expire le {{expires_at}}.\n\nhttps://fade-up.com{{accept_path}}\n\nFadeUp',
 pg_temp_b2_shell(
   'Invitation à rejoindre {{organization_name}}',
   '<p style="margin:0 0 8px 0;">{{invited_by}} vous invite à rejoindre <strong>{{organization_name}}</strong> en tant que {{role}}.</p>'
   || pg_temp_b2_button('https://fade-up.com{{accept_path}}', 'Accepter l''invitation')
   || '<p style="margin:0;color:#6b736f;font-size:14px;">L''invitation expire le {{expires_at}}.</p>', '')),

('team_invitation', 'en', 'transactional',
 '{{invited_by}} invited you to join {{organization_name}} on FadeUp',
 E'Hello,\n\n{{invited_by}} invited you to join {{organization_name}} on FadeUp as {{role}}.\n\nThe invitation expires on {{expires_at}}.\n\nhttps://fade-up.com{{accept_path}}\n\nFadeUp',
 pg_temp_b2_shell(
   'Invitation to join {{organization_name}}',
   '<p style="margin:0 0 8px 0;">{{invited_by}} invited you to join <strong>{{organization_name}}</strong> as {{role}}.</p>'
   || pg_temp_b2_button('https://fade-up.com{{accept_path}}', 'Accept the invitation')
   || '<p style="margin:0;color:#6b736f;font-size:14px;">The invitation expires on {{expires_at}}.</p>', '')),

-- === TRANSACTIONNEL — candidature professionnelle =========================
('professional_application_approved', 'fr', 'transactional',
 'Votre espace professionnel FadeUp est ouvert',
 E'Bonjour {{first_name}},\n\nVotre candidature pour {{business_name}} est acceptée. Votre espace professionnel est ouvert.\n\nhttps://fade-up.com/pro\n\nFadeUp',
 pg_temp_b2_shell(
   'Votre espace professionnel est ouvert',
   '<p style="margin:0 0 8px 0;">Bonjour {{first_name}}, votre candidature pour <strong>{{business_name}}</strong> est acceptée.</p>'
   || pg_temp_b2_button('https://fade-up.com/pro', 'Ouvrir FadeUp Pro'), '')),

('professional_application_approved', 'en', 'transactional',
 'Your FadeUp professional workspace is open',
 E'Hello {{first_name}},\n\nYour application for {{business_name}} has been approved. Your professional workspace is open.\n\nhttps://fade-up.com/pro\n\nFadeUp',
 pg_temp_b2_shell(
   'Your professional workspace is open',
   '<p style="margin:0 0 8px 0;">Hello {{first_name}}, your application for <strong>{{business_name}}</strong> has been approved.</p>'
   || pg_temp_b2_button('https://fade-up.com/pro', 'Open FadeUp Pro'), '')),

('professional_application_rejected', 'fr', 'transactional',
 'Votre candidature FadeUp pour {{business_name}}',
 E'Bonjour {{first_name}},\n\nNous n''avons pas pu donner suite à votre candidature pour {{business_name}}.\n\nMotif : {{rejection_reason}}\n\nVous pouvez répondre à ce message si vous pensez qu''il s''agit d''une erreur.\n\nFadeUp',
 pg_temp_b2_shell(
   'Votre candidature pour {{business_name}}',
   '<p style="margin:0 0 16px 0;">Bonjour {{first_name}}, nous n''avons pas pu donner suite à votre candidature pour <strong>{{business_name}}</strong>.</p>'
   || '<p style="margin:0 0 16px 0;color:#6b736f;">Motif : {{rejection_reason}}</p>'
   || '<p style="margin:0;">Vous pouvez répondre à ce message si vous pensez qu''il s''agit d''une erreur.</p>', '')),

('professional_application_rejected', 'en', 'transactional',
 'Your FadeUp application for {{business_name}}',
 E'Hello {{first_name}},\n\nWe were not able to move forward with your application for {{business_name}}.\n\nReason: {{rejection_reason}}\n\nYou can reply to this message if you believe this is a mistake.\n\nFadeUp',
 pg_temp_b2_shell(
   'Your application for {{business_name}}',
   '<p style="margin:0 0 16px 0;">Hello {{first_name}}, we were not able to move forward with your application for <strong>{{business_name}}</strong>.</p>'
   || '<p style="margin:0 0 16px 0;color:#6b736f;">Reason: {{rejection_reason}}</p>'
   || '<p style="margin:0;">You can reply to this message if you believe this is a mistake.</p>', ''))

on conflict (template_key, locale) do update set
  stream    = excluded.stream,
  subject   = excluded.subject,
  body_text = excluded.body_text,
  body_html = excluded.body_html,
  updated_at = now();

drop function if exists pg_temp_b2_shell(text, text, text);
drop function if exists pg_temp_b2_button(text, text);

commit;
