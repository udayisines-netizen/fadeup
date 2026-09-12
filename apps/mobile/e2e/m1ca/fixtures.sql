-- FadeUp — M1c-a : fixtures de la campagne de captures (rendu web du mobile).
--
-- CE QUI EST ÉCRIT EN PRODUCTION, ET POURQUOI C'EST ACCEPTABLE
--
-- Un compte client jetable (`qa_m1ca_captures@fadeup.test`), sa fiche client
-- sur un salon de démonstration, et DEUX rendez-vous : un à venir, un dans
-- l'historique. Sans eux, l'onglet Réservations est vide et la capture du
-- hors-ligne ne montrerait rien — donc ne prouverait rien.
--
-- `session_replication_role = replica` DÉSACTIVE les triggers le temps des
-- insertions. C'est délibéré et c'est le point important : sans cela,
-- `notify_new_appointment` mettrait en file un VRAI e-mail de confirmation
-- vers une adresse inexistante (@fadeup.test), ce qui abîme la réputation
-- d'envoi du domaine — celui dont dépendent les liens de connexion.
--
-- `cleanup.sql` défait tout. À exécuter dans la même session de travail.

\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

-- Le salon de démonstration utilisé par la QA M1b : services et barbers
-- complets. On ne CRÉE aucune organisation.
do $$
declare
  v_user uuid := 'c0dea001-0000-4000-8000-0000000000ca';
  v_customer uuid := 'c0dec001-0000-4000-8000-0000000000ca';
  v_org uuid;
  v_loc uuid;
  v_barber uuid;
  v_service uuid;
begin
  select o.id into v_org from public.organizations o where o.slug like 'demo-%'
    and exists (select 1 from public.services s where s.organization_id = o.id and s.is_active)
    and exists (select 1 from public.barbers b where b.organization_id = o.id and b.is_bookable)
  order by o.slug limit 1;
  if v_org is null then
    raise exception 'FIXTURE: aucun salon de démonstration complet trouvé';
  end if;

  select l.id into v_loc from public.locations l where l.organization_id = v_org order by l.created_at limit 1;
  select b.id into v_barber from public.barbers b where b.organization_id = v_org and b.is_bookable order by b.created_at limit 1;
  select s.id into v_service from public.services s where s.organization_id = v_org and s.is_active order by s.created_at limit 1;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'qa_m1ca_captures@fadeup.test',
          extensions.crypt('m1ca-captures-2026', extensions.gen_salt('bf')),
          now(), now(), now(), '', '', '', '')
  on conflict (id) do update set encrypted_password = excluded.encrypted_password;

  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_user,
          jsonb_build_object('sub', v_user::text, 'email', 'qa_m1ca_captures@fadeup.test'),
          'email', v_user::text, now(), now(), now())
  on conflict do nothing;

  insert into public.profiles (id, full_name, locale)
  values (v_user, 'QA Captures M1ca', 'fr')
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.customers (id, organization_id, name, email, user_id)
  values (v_customer, v_org, 'QA Captures M1ca', 'qa_m1ca_captures@fadeup.test', v_user)
  on conflict (id) do update set user_id = excluded.user_id;

  -- Un rendez-vous à venir (dans trois jours) et un terminé (il y a dix
  -- jours) : de quoi peupler « à venir » ET « historique ».
  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id, customer_id, customer_name,
     customer_email, starts_at, ends_at, status)
  values
    ('c0deb001-0000-4000-8000-0000000000ca', v_org, v_loc, v_barber, v_service, v_customer,
     'QA Captures M1ca', 'qa_m1ca_captures@fadeup.test',
     date_trunc('hour', now()) + interval '3 days' + interval '10 hours',
     date_trunc('hour', now()) + interval '3 days' + interval '10 hours 30 minutes', 'confirmed'),
    ('c0deb002-0000-4000-8000-0000000000ca', v_org, v_loc, v_barber, v_service, v_customer,
     'QA Captures M1ca', 'qa_m1ca_captures@fadeup.test',
     date_trunc('hour', now()) - interval '10 days',
     date_trunc('hour', now()) - interval '10 days' + interval '30 minutes', 'completed')
  on conflict (id) do nothing;

  raise notice 'fixtures M1ca : org=% loc=% barber=% service=%', v_org, v_loc, v_barber, v_service;
end $$;

commit;
