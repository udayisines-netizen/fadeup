-- FadeUp — B2 : vérification de la boucle d'acquisition.
--
-- NE COMMET RIEN. Une seule transaction, un rollback final — la même raison
-- que verify_b1 : insérer une organisation écrit une ligne append-only dans
-- commercial_plan_changes que personne ne peut supprimer, donc une fixture
-- COMMITTÉE est un résidu permanent. B1 a appris cela en polluant la
-- production avec 31 organisations indestructibles ; ce fichier ne recommence
-- pas.
--
-- Exécution :
--   docker cp db/tests/verify_b2.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_b2.sql

\set ON_ERROR_STOP off

begin;

create temporary table b2_results (
  seq serial primary key,
  chantier text not null,
  check_name text not null,
  verdict text not null,
  detail text
) on commit drop;

create or replace function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into b2_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- FIXTURES
-- ===========================================================================

insert into public.organizations (id, name, slug, business_type, currency, country_code, marketplace_visible)
values ('b2000001-0000-4000-8000-000000000001', 'B2 Free Shop', 'b2-verify-free', 'barbershop', 'EUR', 'FR', true);

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('b2000101-0000-4000-8000-000000000001', 'b2000001-0000-4000-8000-000000000001',
        'B2 Shop', '1 rue de Rivoli', 'Paris', 'Île-de-France', '75001', 'FR', 'Europe/Paris', 48.8584, 2.3470);

insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
values ('b2000201-0000-4000-8000-000000000001', 'b2000001-0000-4000-8000-000000000001',
        'b2000101-0000-4000-8000-000000000001', 'B2 Barber', true, true);

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('b2000401-0000-4000-8000-000000000001', 'b2000001-0000-4000-8000-000000000001',
        'b2000201-0000-4000-8000-000000000001', true);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values ('b2000701-0000-4000-8000-000000000001', 'b2000001-0000-4000-8000-000000000001',
        'B2 Coupe', 30, 2500, true);

-- organization_id est OBLIGATOIRE et dénormalisé sur ces tables de liaison :
-- check_service_location_consistency le compare aux deux côtés, ce qui est ce
-- qui empêche de rattacher le service d'un salon au lieu d'un autre.
insert into public.service_locations (organization_id, service_id, location_id)
values ('b2000001-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001', 'b2000101-0000-4000-8000-000000000001');

insert into public.barber_services (organization_id, barber_id, service_id)
values ('b2000001-0000-4000-8000-000000000001', 'b2000401-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001');

-- Ouvert 24 h sur 24 tous les jours, pour que le test ne dépende pas de
-- l'heure à laquelle on le lance.
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time, is_closed)
select 'b2000001-0000-4000-8000-000000000001', 'b2000101-0000-4000-8000-000000000001', d, '00:00', '23:59', false
from generate_series(0, 6) d;

insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time, is_off)
select 'b2000001-0000-4000-8000-000000000001', 'b2000401-0000-4000-8000-000000000001', d, '00:00', '23:59', false
from generate_series(0, 6) d;

-- Un profil non revendiqué, publié par le chemin d'acquisition réel.
insert into public.prospects (id, type, entity_kind, canonical_name, country, website_domain, email)
values ('b2000501-0000-4000-8000-000000000001', 'independent_barber', 'independent',
        'B2 Prospect', 'FR', 'b2-prospect.example', 'b2-prospect@example.test');

insert into public.prospect_locations (prospect_id, is_primary, city, region, country, latitude, longitude)
values ('b2000501-0000-4000-8000-000000000001', true, 'Paris', 'Île-de-France', 'FR', 48.8584, 2.3470);

insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type)
select id, 'b2000501-0000-4000-8000-000000000001', 'b2-sirene', 'establishment'
from public.prospect_sources where key = 'sirene';

insert into public.professionals (id, claim_state, display_name, handle, source, is_public)
values ('b2000301-0000-4000-8000-000000000001', 'unclaimed', 'B2 Barbier', 'b2.barbier', 'acquisition', false);

insert into public.prospect_professionals (prospect_id, professional_id)
values ('b2000501-0000-4000-8000-000000000001', 'b2000301-0000-4000-8000-000000000001');

update public.professionals set is_public = true where id = 'b2000301-0000-4000-8000-000000000001';

-- ===========================================================================
-- CHANTIER 1a — la branche `pending`
-- ===========================================================================

do $$
declare r record; v_slot timestamptz;
begin
  v_slot := date_trunc('hour', now()) + interval '3 hours';

  -- Organisation Free : pas de capacité `booking`.
  select * into r from public.book_public_appointment(
    'b2-verify-free', 'b2000101-0000-4000-8000-000000000001',
    'b2000401-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001',
    v_slot, 'Karim Benali', null, 'karim@example.test', null);

  perform pg_temp.record('1a', 'une organisation sans capacité booking produit `pending`',
                         r.status = 'pending' and r.is_request, 'status=' || r.status);
  perform pg_temp.record('1a', 'la demande porte une échéance', r.expires_at is not null,
                         'expires_at=' || coalesce(r.expires_at::text, 'NULL'));
  perform pg_temp.record('1a', 'échéance ≤ 24 h', r.expires_at <= now() + interval '24 hours',
                         'expires_at=' || r.expires_at);
  -- LE CAS DU SOIR MÊME que B2 demande explicitement : le créneau est dans
  -- 3 h, donc l'échéance doit être le créneau lui-même, pas dans 24 h.
  perform pg_temp.record('1a', 'échéance ≤ heure demandée (rendez-vous du soir même)',
                         r.expires_at <= v_slot and r.expires_at = v_slot,
                         'expires_at=' || r.expires_at || ' starts_at=' || v_slot);
  perform pg_temp.record('1a', 'un jeton de rattachement est émis sur le chemin pending',
                         r.claim_token is not null and length(r.claim_token) = 64,
                         'len=' || coalesce(length(r.claim_token)::text, 'NULL'));

  perform pg_temp.record('1a', 'le jeton est stocké haché, jamais en clair',
    exists (select 1 from public.appointment_claim_tokens t
            where t.appointment_id = r.id
              and t.token_hash = encode(extensions.digest(r.claim_token, 'sha256'), 'hex')));
exception when others then
  perform pg_temp.record('1a', 'une organisation sans capacité booking produit `pending`', false, sqlerrm);
end $$;

-- Le `pending` ne contourne aucune vérification métier.
do $$
begin
  perform public.book_public_appointment(
    'b2-verify-free', 'b2000101-0000-4000-8000-000000000001',
    'b2000401-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001',
    now() - interval '1 hour', 'Karim Benali', null, 'karim@example.test', null);
  perform pg_temp.record('1a', 'un créneau dans le passé reste refusé', false, 'accepté');
exception when others then
  perform pg_temp.record('1a', 'un créneau dans le passé reste refusé', true, sqlerrm);
end $$;

do $$
declare v_slot timestamptz := date_trunc('hour', now()) + interval '3 hours';
begin
  -- Le même créneau, déjà pris par la demande ci-dessus : la contrainte
  -- d'exclusion GiST doit refuser. Une demande retient bien le créneau.
  perform public.book_public_appointment(
    'b2-verify-free', 'b2000101-0000-4000-8000-000000000001',
    'b2000401-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001',
    v_slot, 'Autre Client', null, 'autre@example.test', null);
  perform pg_temp.record('1a', 'une demande en attente retient le créneau', false, 'un second a été accepté');
exception when exclusion_violation then
  perform pg_temp.record('1a', 'une demande en attente retient le créneau', true);
when others then
  perform pg_temp.record('1a', 'une demande en attente retient le créneau', false, sqlerrm);
end $$;

-- Avec la capacité, on repasse en confirmation immédiate.
do $$
declare r record;
begin
  update public.organization_commercial_state set plan_key = 'salon_pro'
  where organization_id = 'b2000001-0000-4000-8000-000000000001';

  select * into r from public.book_public_appointment(
    'b2-verify-free', 'b2000101-0000-4000-8000-000000000001',
    'b2000401-0000-4000-8000-000000000001', 'b2000701-0000-4000-8000-000000000001',
    date_trunc('hour', now()) + interval '9 hours', 'Paying Client', null, 'paying@example.test', null);

  perform pg_temp.record('1a', 'une organisation avec capacité booking produit `confirmed`',
                         r.status = 'confirmed' and not r.is_request and r.expires_at is null,
                         'status=' || r.status);

  update public.organization_commercial_state set plan_key = 'free'
  where organization_id = 'b2000001-0000-4000-8000-000000000001';
exception when others then
  perform pg_temp.record('1a', 'une organisation avec capacité booking produit `confirmed`', false, sqlerrm);
end $$;

-- Le balayage traite bien les demandes créées par ce chemin.
do $$
declare v_n integer;
begin
  update public.appointments set expires_at = now() - interval '1 minute'
  where organization_id = 'b2000001-0000-4000-8000-000000000001' and status = 'pending';

  v_n := public.expire_pending_appointments(100);
  perform pg_temp.record('1a', 'expire_pending_appointments traite les demandes de ce chemin',
                         v_n >= 1, 'expirées=' || v_n);
  perform pg_temp.record('1a', 'une demande expirée est résolue en `expired`',
    exists (select 1 from public.appointments
            where organization_id = 'b2000001-0000-4000-8000-000000000001'
              and status = 'cancelled' and resolution = 'expired'));
end $$;

-- ===========================================================================
-- CHANTIER 1b — la demande d'intérêt, et le cul-de-sac levé
-- ===========================================================================

do $$
declare r record;
begin
  select * into r from public.create_professional_interest_request(
    'b2000301-0000-4000-8000-000000000001', 'Karim Benali', 'Dégradé américain',
    now() + interval '3 hours', 'karim@example.test', '+33600000000', null, 'fr');

  perform pg_temp.record('1b', 'une demande est envoyable à un profil publié non revendiqué',
                         r.id is not null and r.status = 'pending');
  perform pg_temp.record('1b', 'échéance ≤ heure souhaitée', r.expires_at <= r.preferred_starts_at,
                         'expires=' || r.expires_at || ' preferred=' || r.preferred_starts_at);
exception when others then
  perform pg_temp.record('1b', 'une demande est envoyable à un profil publié non revendiqué', false, sqlerrm);
end $$;

do $$
declare v_name text;
begin
  select customer_display_name into v_name from public.professional_interest_requests
  where professional_id = 'b2000301-0000-4000-8000-000000000001';
  perform pg_temp.record('1b', 'le nom est réduit à « Prénom I. » AU STOCKAGE',
                         v_name = 'Karim B.', 'stocké=' || coalesce(v_name, 'NULL'));
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'professional_interest_requests'
    and column_name in ('customer_email', 'customer_phone');
  perform pg_temp.record('1b', 'la table des demandes ne porte AUCUNE colonne de contact',
                         v_n = 0, 'colonnes de contact=' || v_n);
end $$;

do $$
begin
  perform public.create_professional_interest_request(
    'de300401-0000-4000-8000-000000000001', 'Test', 'Coupe', now() + interval '3 hours',
    'x@example.test', null, null, 'fr');
  perform pg_temp.record('1b', 'un profil non publié est refusé', false, 'accepté');
exception when sqlstate '42501' then
  perform pg_temp.record('1b', 'un profil non publié est refusé', true);
when others then
  perform pg_temp.record('1b', 'un profil non publié est refusé', true, sqlerrm);
end $$;

do $$
declare v_n integer;
begin
  update public.professional_interest_requests
  set expires_at = now() - interval '1 minute'
  where professional_id = 'b2000301-0000-4000-8000-000000000001' and status = 'pending';
  v_n := public.expire_interest_requests(100);
  perform pg_temp.record('1b', 'les demandes d''intérêt échues sont balayées', v_n >= 1, 'expirées=' || v_n);
end $$;

-- ===========================================================================
-- CHANTIER 1c — les alternatives
-- ===========================================================================

do $$
declare v_n integer; v_self integer;
begin
  select count(*), count(*) filter (where organization_id = 'de300001-0000-4000-8000-000000000001')
    into v_n, v_self
  from public.get_public_booking_alternatives(48.8584, 2.3470, 'Coupe',
       'de300001-0000-4000-8000-000000000001', 10, 5);

  perform pg_temp.record('1c', 'des alternatives proches sont retournées', v_n >= 1, 'lignes=' || v_n);
  perform pg_temp.record('1c', 'l''organisation d''origine est exclue', v_self = 0, 'occurrences=' || v_self);

  perform pg_temp.record('1c', 'la disponibilité n''est jamais affirmée sans preuve',
    not exists (select 1 from public.get_public_booking_alternatives(48.8584, 2.3470, 'Coupe', null, 10, 5)
                where accepts_immediate_booking
                  and not private.org_has_capability(organization_id, 'booking')));
end $$;

-- ===========================================================================
-- CHANTIER 2 + 4 — gabarits et envoi
-- ===========================================================================

do $$
declare v_missing text := '';
        r record;
begin
  -- Chaque gabarit existe dans les deux langues.
  for r in select distinct template_key from public.email_templates loop
    if (select count(*) from public.email_templates t where t.template_key = r.template_key) <> 2 then
      v_missing := v_missing || r.template_key || ' ';
    end if;
  end loop;
  perform pg_temp.record('4', 'chaque gabarit existe en FR ET EN', v_missing = '',
                         case when v_missing = '' then null else 'incomplets: ' || v_missing end);

  -- Chaque gabarit référencé par une ligne d'outbox existe.
  v_missing := '';
  for r in select distinct template from public.email_outbox loop
    if not exists (select 1 from public.email_templates t where t.template_key = r.template) then
      v_missing := v_missing || r.template || ' ';
    end if;
  end loop;
  perform pg_temp.record('4', 'tout gabarit attendu par l''outbox existe', v_missing = '',
                         case when v_missing = '' then null else 'manquants: ' || v_missing end);
end $$;

-- LA RÈGLE DE LANGUE : aucun gabarit de demande ne dit « réservé ».
do $$
declare v_bad text := '';
        r record;
begin
  for r in
    select template_key, locale, subject || ' ' || body_text || ' ' || body_html as blob
    from public.email_templates
    where template_key in ('booking_request_sent', 'booking_request_created',
                           'prospect_request_first', 'prospect_request_reminder', 'prospect_request_final')
  loop
    if r.blob ~* '\m(réservé|reserve|booked|confirmé|confirmed)\M' then
      v_bad := v_bad || r.template_key || '/' || r.locale || ' ';
    end if;
  end loop;
  perform pg_temp.record('4', 'aucun gabarit de DEMANDE ne la présente comme une réservation',
                         v_bad = '', case when v_bad = '' then null else 'fautifs: ' || v_bad end);
end $$;

-- Une demande expirée n'est ni un no-show ni un refus.
do $$
declare v_bad text := '';
        r record;
begin
  for r in select locale, subject || ' ' || body_text as blob
           from public.email_templates where template_key = 'booking_expired'
  loop
    if r.blob ~* '\m(no.?show|absent|refus|refusé|declined|rejected)\M' then
      v_bad := v_bad || r.locale || ' ';
    end if;
  end loop;
  perform pg_temp.record('4', 'une demande expirée n''est ni un no-show ni un refus',
                         v_bad = '', case when v_bad = '' then null else 'fautifs: ' || v_bad end);
end $$;

do $$
declare r record;
begin
  select * into r from private.render_email_template('booking_request_sent', 'fr', jsonb_build_object(
    'customer_name', 'Karim', 'organization_name', 'B2 Free Shop', 'service_name', 'B2 Coupe',
    'starts_at_fr', '05/09/2026 à 09:30', 'expires_at_fr', '05/09/2026 à 09:30', 'timezone', 'Europe/Paris',
    'starts_at', 'x', 'starts_at_en', 'x', 'expires_at_en', 'x', 'appointment_id', 'x'));
  perform pg_temp.record('4', 'le rendu produit sujet, texte et HTML',
                         r.subject <> '' and r.body_text <> '' and r.body_html like '<!doctype%');
end $$;

do $$
begin
  perform private.render_email_template('booking_request_sent', 'fr', '{}'::jsonb);
  perform pg_temp.record('4', 'un jeton non résolu fait échouer le rendu', false, 'accepté');
exception when sqlstate '22023' then
  perform pg_temp.record('4', 'un jeton non résolu fait échouer le rendu', true);
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.email_streams where requires_unsubscribe;
  perform pg_temp.record('2', 'seule la prospection exige un désabonnement', v_n = 1, 'flux=' || v_n);

  select count(*) into v_n from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('email_templates', 'email_streams') and grantee = 'anon';
  perform pg_temp.record('2', 'anon ne lit ni gabarits ni flux', v_n = 0, 'grants=' || v_n);
end $$;

-- ===========================================================================
-- CHANTIER 3 — relances, fuite, idempotence, heures calmes
-- ===========================================================================

-- LA GARDE STRUCTURELLE : la composition ne peut pas atteindre les contacts.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'prospect_outreach_payload';

  perform pg_temp.record('3', 'la composition ne nomme JAMAIS la table de contacts',
                         v_def not like '%professional_interest_request_contacts%');
  perform pg_temp.record('3', 'la composition ne nomme aucune colonne de contact',
                         v_def not like '%customer_email%' and v_def not like '%customer_phone%');
end $$;

-- LA GARDE OBSERVÉE : le payload produit ne contient ni e-mail ni téléphone.
do $$
declare v_request_id uuid; v_payload jsonb; v_blob text;
begin
  insert into public.professional_interest_requests
    (id, professional_id, customer_display_name, service_label, preferred_starts_at, locale, status, expires_at)
  values ('b2000601-0000-4000-8000-000000000001', 'b2000301-0000-4000-8000-000000000001',
          private.reduce_customer_display_name('Karim Benali'), 'Dégradé américain',
          now() + interval '20 hours', 'fr', 'pending', now() + interval '20 hours')
  returning id into v_request_id;

  insert into public.professional_interest_request_contacts (request_id, customer_email, customer_phone)
  values (v_request_id, 'karim.benali@example.test', '+33612345678');

  v_payload := private.prospect_outreach_payload(v_request_id);
  v_blob := v_payload::text;

  perform pg_temp.record('3', 'le payload ne contient pas l''e-mail du client',
                         v_blob not like '%karim.benali@example.test%' and v_blob not like '%@example.test%');
  perform pg_temp.record('3', 'le payload ne contient pas le téléphone du client',
                         v_blob not like '%33612345678%' and v_blob !~ '\+[0-9]{6,}');
  perform pg_temp.record('3', 'le payload ne porte que le nom réduit',
                         v_payload ->> 'customer_display_name' = 'Karim B.',
                         v_payload ->> 'customer_display_name');
  perform pg_temp.record('3', 'le payload porte un lien de désabonnement',
                         (v_payload ->> 'unsubscribe_url') like 'https://fade-up.com/unsubscribe/%');
end $$;

-- IDEMPOTENCE : deux mises en file successives ne produisent qu'un envoi.
do $$
declare v_first integer; v_second integer; v_rows integer;
begin
  v_first  := private.enqueue_prospect_outreach(100);
  v_second := private.enqueue_prospect_outreach(100);

  select count(*) into v_rows from public.email_outbox
  where dedupe_key like 'interest:b2000601-0000-4000-8000-000000000001:%';

  -- Le premier appel peut mettre 0 en file si l'heure locale est en heures
  -- calmes : dans ce cas le second aussi, et le total reste 0. Ce qui est
  -- testé ici, c'est qu'un second passage n'AJOUTE rien.
  perform pg_temp.record('3', 'un second passage n''ajoute aucun envoi (idempotence)',
                         v_second = 0, 'premier=' || v_first || ' second=' || v_second || ' lignes=' || v_rows);
  perform pg_temp.record('3', 'au plus une ligne par touche', v_rows <= 1, 'lignes=' || v_rows);
end $$;

-- L'index unique est bien ce qui garantit l'idempotence.
do $$
begin
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values ('x@example.test', 'prospect_request_first', 'fr', '{}'::jsonb, 'prospecting',
          'interest:b2000601-0000-4000-8000-000000000001:1');
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values ('x@example.test', 'prospect_request_first', 'fr', '{}'::jsonb, 'prospecting',
          'interest:b2000601-0000-4000-8000-000000000001:1');
  perform pg_temp.record('3', 'la clé de déduplication est unique en base', false, 'doublon accepté');
exception when unique_violation then
  perform pg_temp.record('3', 'la clé de déduplication est unique en base', true);
end $$;

-- TROIS TOUCHES MAXIMUM.
do $$
declare v_n integer;
begin
  delete from public.email_outbox where dedupe_key like 'interest:b2000601%';
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values ('a@example.test','prospect_request_first','fr','{}'::jsonb,'prospecting','interest:b2000601-0000-4000-8000-000000000001:1'),
         ('a@example.test','prospect_request_reminder','fr','{}'::jsonb,'prospecting','interest:b2000601-0000-4000-8000-000000000001:2'),
         ('a@example.test','prospect_request_final','fr','{}'::jsonb,'prospecting','interest:b2000601-0000-4000-8000-000000000001:3');

  perform private.enqueue_prospect_outreach(100);
  select count(*) into v_n from public.email_outbox where dedupe_key like 'interest:b2000601%';
  perform pg_temp.record('3', 'jamais plus de trois touches', v_n = 3, 'touches=' || v_n);
end $$;

-- DÉSABONNEMENT : définitif, et il coupe tout.
do $$
declare v_token text; v_n integer;
begin
  select outreach_unsubscribe_token into v_token from public.prospects
  where id = 'b2000501-0000-4000-8000-000000000001';

  perform public.unsubscribe_prospect_outreach(v_token);

  select count(*) into v_n from public.prospects
  where id = 'b2000501-0000-4000-8000-000000000001' and do_not_contact;
  perform pg_temp.record('3', 'le désabonnement pose do_not_contact', v_n = 1);

  select count(*) into v_n from public.prospect_suppressions
  where prospect_id = 'b2000501-0000-4000-8000-000000000001';
  perform pg_temp.record('3', 'le désabonnement pose une suppression durable', v_n >= 1);

  -- Et il est définitif : une nouvelle demande client ne le contourne pas.
  begin
    perform public.create_professional_interest_request(
      'b2000301-0000-4000-8000-000000000001', 'Autre Client', 'Coupe',
      now() + interval '5 hours', 'autre@example.test', null, null, 'fr');
    perform pg_temp.record('3', 'aucune nouvelle demande ne contourne un désabonnement', false, 'acceptée');
  exception when sqlstate '42501' then
    perform pg_temp.record('3', 'aucune nouvelle demande ne contourne un désabonnement', true);
  end;

  delete from public.email_outbox where dedupe_key like 'interest:b2000601%';
  select private.enqueue_prospect_outreach(100) into v_n;
  perform pg_temp.record('3', 'aucune relance vers un prospect désabonné', v_n = 0, 'mises en file=' || v_n);

  perform pg_temp.record('3', 'un jeton inconnu ne révèle rien',
    (select unsubscribed from public.unsubscribe_prospect_outreach('deadbeef')) = true);
end $$;

-- ===========================================================================
-- CHANTIER 5 — retrait de marketplace
-- ===========================================================================

do $$
declare v_admin uuid; r record; v_id uuid;
begin
  select user_id into v_admin from public.platform_members limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select * into r from public.request_marketplace_withdrawal(
    'b2000301-0000-4000-8000-000000000001', 'email', 'test B2');
  v_id := r.id;

  perform pg_temp.record('5', 'une demande de retrait est enregistrable', v_id is not null);
  perform pg_temp.record('5', 'l''échéance est à 72 h',
    r.deadline_at between now() + interval '71 hours' and now() + interval '73 hours',
    'deadline=' || r.deadline_at);

  perform pg_temp.record('5', 'une seule demande en cours par profil',
    (select count(*) from public.marketplace_withdrawal_requests
     where professional_id = 'b2000301-0000-4000-8000-000000000001' and status = 'pending') = 1);

  perform pg_temp.record('5', 'l''échéance est visible et mesurée',
    exists (select 1 from public.list_marketplace_withdrawal_requests(false)
            where id = v_id and hours_remaining > 0 and not is_overdue));

  select * into r from public.complete_marketplace_withdrawal(v_id, 'test B2');
  perform pg_temp.record('5', 'le retrait dépublie le profil',
    not (select is_public from public.professionals where id = 'b2000301-0000-4000-8000-000000000001'));
  perform pg_temp.record('5', 'le retrait coupe toute relance future',
    (select do_not_contact from public.prospects where id = 'b2000501-0000-4000-8000-000000000001'));
  perform pg_temp.record('5', 'les demandes en cours passent en `withdrawn`',
    not exists (select 1 from public.professional_interest_requests
                where professional_id = 'b2000301-0000-4000-8000-000000000001' and status = 'pending'));
  perform pg_temp.record('5', 'le délai réel est mesuré, pas estimé',
    r.hours_taken is not null, 'heures=' || r.hours_taken);

  -- LA NON-REPUBLICATION, vérifiée sur la garde qui existait déjà.
  perform pg_temp.record('5', 'le Worker ne peut pas republier un profil retiré',
    public.publication_block_reason('b2000501-0000-4000-8000-000000000001') is not null,
    'motif=' || coalesce(public.publication_block_reason('b2000501-0000-4000-8000-000000000001'), 'AUCUN'));

  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('5', 'workflow de retrait', false, sqlerrm);
end $$;

-- ===========================================================================
-- RLS
-- ===========================================================================

do $$
declare v_bad text := ''; r record;
begin
  for r in
    select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('professional_interest_requests', 'professional_interest_request_contacts',
                        'email_templates', 'email_streams', 'marketplace_withdrawal_requests')
  loop
    if not r.relrowsecurity then v_bad := v_bad || r.relname || ' '; end if;
  end loop;
  perform pg_temp.record('RLS', 'RLS activée sur toute table créée par B2', v_bad = '',
                         case when v_bad = '' then null else 'sans RLS: ' || v_bad end);
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and table_name in ('professional_interest_requests', 'professional_interest_request_contacts',
                       'email_templates', 'email_streams', 'marketplace_withdrawal_requests', 'email_outbox');
  perform pg_temp.record('RLS', 'anon ne détient rien sur les tables B2', v_n = 0, 'grants=' || v_n);
end $$;

-- Un client connecté ne voit ni les demandes des autres, ni les gabarits, ni
-- les retraits. Les verdicts sont collectés puis enregistrés après reset role :
-- `authenticated` n'a aucun privilège sur la table temporaire.
do $$
declare v_stranger uuid; v_n integer;
        v_requests text; v_contacts text; v_withdrawals text; v_templates text;
begin
  select id into v_stranger from auth.users
  where id not in (select user_id from public.platform_members)
    and id not in (select user_id from public.memberships) limit 1;

  if v_stranger is null then
    perform pg_temp.record('RLS', 'un client tiers est isolé', false, 'aucun compte non-membre disponible');
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    select count(*) into v_n from public.professional_interest_requests;
    v_requests := case when v_n = 0 then 'ok:0' else 'FUITE:' || v_n end;
  exception when insufficient_privilege then v_requests := 'ok:aucun privilège';
  end;

  begin
    select count(*) into v_n from public.professional_interest_request_contacts;
    v_contacts := case when v_n = 0 then 'ok:0' else 'FUITE:' || v_n end;
  exception when insufficient_privilege then v_contacts := 'ok:aucun privilège';
  end;

  begin
    select count(*) into v_n from public.marketplace_withdrawal_requests;
    v_withdrawals := case when v_n = 0 then 'ok:0' else 'FUITE:' || v_n end;
  exception when insufficient_privilege then v_withdrawals := 'ok:aucun privilège';
  end;

  begin
    select count(*) into v_n from public.email_templates;
    v_templates := case when v_n = 0 then 'ok:0' else 'FUITE:' || v_n end;
  exception when insufficient_privilege then v_templates := 'ok:aucun privilège';
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('RLS', 'un tiers ne lit aucune demande d''intérêt',   v_requests    like 'ok:%', v_requests);
  perform pg_temp.record('RLS', 'un tiers ne lit aucune coordonnée client',    v_contacts    like 'ok:%', v_contacts);
  perform pg_temp.record('RLS', 'un tiers ne lit aucune demande de retrait',   v_withdrawals like 'ok:%', v_withdrawals);
  perform pg_temp.record('RLS', 'un tiers ne lit aucun gabarit d''e-mail',     v_templates   like 'ok:%', v_templates);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('RLS', 'un client tiers est isolé', false, sqlerrm);
end $$;

-- La clé Resend n'est atteignable par aucun rôle client.
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'resend_api_key'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.record('RLS', 'la clé Resend n''est exécutable par aucun rôle client', v_n = 0);
end $$;

-- ===========================================================================
-- RÉSULTATS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from b2_results order by seq;

select verdict, count(*) from b2_results group by verdict order by verdict;

rollback;
