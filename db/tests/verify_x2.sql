-- FadeUp — X2 : suite de vérification. NE COMMET RIEN (rollback final).
--
-- Exécution :
--   docker cp db/tests/verify_x2.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_x2.sql
--
-- Couvre : le gabarit d'information article 14 (zéro vocabulaire commercial,
-- liens de retrait et de désabonnement, FR+EN, rendu réel), le déclenchement
-- à la publication (les DEUX branches, idempotence, cas sans e-mail), la
-- demande de retrait publique (canaux, idempotence, refus nommés, jeton), le
-- traitement des événements Resend (délivré, rebond dur → do_not_contact,
-- rebond transitoire ignoré, plainte, rejeu sans double effet), la
-- non-republication après retrait, et les ACL.

\set ON_ERROR_STOP off

begin;

create temporary table x2_results (
  seq serial,
  chantier text,
  check_name text,
  verdict text,
  detail text
) on commit drop;

create function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into x2_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- Fixtures (annulées par le rollback final)
-- ===========================================================================

create temporary table x2_ctx (
  key text primary key,
  uuid_val uuid,
  text_val text
) on commit drop;

do $$
declare
  v_type text;
  v_src_a uuid; v_src_b uuid;
  v_p1 uuid; v_p2 uuid;
begin
  select enumlabel into v_type
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'prospect_type' order by e.enumsortorder limit 1;

  insert into public.prospect_sources (key, display_name)
  values ('qa_x2_source_a', 'ZZ dead QA X2 source A') returning id into v_src_a;
  insert into public.prospect_sources (key, display_name)
  values ('qa_x2_source_b', 'ZZ dead QA X2 source B') returning id into v_src_b;

  -- Prospect 1 : publiable, AVEC e-mail (le chemin nominal de l'information).
  insert into public.prospects (type, canonical_name, country, email)
  values (v_type::public.prospect_type, 'QA X2 Salon Un', 'FR', 'qa-x2-prospect-un@fadeup.test')
  returning id into v_p1;
  insert into public.prospect_source_records (source_id, prospect_id) values (v_src_a, v_p1), (v_src_b, v_p1);
  insert into public.prospect_locations (prospect_id, country, city) values (v_p1, 'FR', 'Paris');

  -- Prospect 2 : publiable, SANS e-mail (la mesure appropriée = la page).
  insert into public.prospects (type, canonical_name, country)
  values (v_type::public.prospect_type, 'QA X2 Salon Deux', 'FR')
  returning id into v_p2;
  insert into public.prospect_source_records (source_id, prospect_id) values (v_src_a, v_p2), (v_src_b, v_p2);
  insert into public.prospect_locations (prospect_id, country, city) values (v_p2, 'FR', 'Lyon');

  insert into x2_ctx (key, uuid_val) values ('p1', v_p1), ('p2', v_p2);
exception when others then
  perform pg_temp.record('fixtures', 'construction des prospects', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 2a — le gabarit d'information
-- ===========================================================================

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.email_templates
  where template_key = 'external_profile_published';
  perform pg_temp.record('gabarit', 'external_profile_published existe en FR et EN',
    v_count = 2, 'lignes: ' || v_count);

  select count(*) into v_count from public.email_templates
  where template_key = 'external_profile_published' and stream <> 'prospecting';
  perform pg_temp.record('gabarit', 'flux prospecting (réputation séparée du transactionnel)',
    v_count = 0);
end $$;

-- Le contrôle le plus important du lot : AUCUN vocabulaire commercial.
do $$
declare r record; v_bad text;
begin
  for r in
    select locale, subject || ' ' || body_text || ' ' || body_html as blob
    from public.email_templates where template_key = 'external_profile_published'
  loop
    v_bad := (select (regexp_matches(lower(r.blob),
      '\m(abonnement|subscription|tarif|tarifs|pricing|prix|price|offre|offer|essai|trial|promo|promotion|remise|discount|réserver|réservation|booking|book|payant|payment|paiement)\M'))[1]);
    perform pg_temp.record('gabarit', 'aucun mot commercial (' || r.locale || ')',
      v_bad is null, coalesce('trouvé: ' || v_bad, null));
  end loop;
exception when others then
  -- regexp_matches sans résultat rend NULL via la sous-requête ; une erreur
  -- ici est une vraie erreur.
  perform pg_temp.record('gabarit', 'aucun mot commercial', false, sqlerrm);
end $$;

do $$
declare r record;
begin
  for r in
    select locale, body_text, body_html
    from public.email_templates where template_key = 'external_profile_published'
  loop
    perform pg_temp.record('gabarit', 'lien de désabonnement présent, texte et HTML (' || r.locale || ')',
      r.body_text like '%{{unsubscribe_url}}%' and r.body_html like '%{{unsubscribe_url}}%');
    perform pg_temp.record('gabarit', 'lien de retrait présent, texte et HTML (' || r.locale || ')',
      r.body_text like '%{{withdrawal_url}}%' and r.body_html like '%{{withdrawal_url}}%');
    perform pg_temp.record('gabarit', 'lien vers la page d''information présent (' || r.locale || ')',
      r.body_text like '%{{info_url}}%' and r.body_html like '%{{info_url}}%');
    perform pg_temp.record('gabarit', 'l''article 14 est nommé (' || r.locale || ')',
      r.body_text ~* 'article 14' and r.body_html ~* 'article 14');
    perform pg_temp.record('gabarit', 'l''engagement des 72 heures est nommé (' || r.locale || ')',
      r.body_text ~* '72' and r.body_html ~* '72');
  end loop;
end $$;

-- Rendu réel : tous les placeholders se résolvent, dans les deux langues.
do $$
declare
  v_payload jsonb := jsonb_build_object(
    'display_name', 'QA X2 Salon Un',
    'profile_url', 'https://fade-up.com/pro/qa-x2',
    'info_url', 'https://fade-up.com/professionals-data?pro=qa-x2',
    'withdrawal_url', 'https://fade-up.com/professionals-data?pro=qa-x2#withdraw',
    'unsubscribe_url', 'https://fade-up.com/unsubscribe/deadbeef');
  r record;
begin
  for r in
    select l as locale, t.* from unnest(array['fr','en']) l,
    lateral private.render_email_template('external_profile_published', l, v_payload) t
  loop
    perform pg_temp.record('gabarit', 'rendu complet (' || r.locale || ')',
      btrim(r.subject) <> '' and btrim(r.body_text) <> '' and r.body_html like '<!doctype%');
  end loop;
exception when others then
  perform pg_temp.record('gabarit', 'rendu complet', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 2b — le déclenchement à la publication
-- ===========================================================================

do $$
declare
  v_admin uuid;
  v_p1 uuid; v_p2 uuid;
  v_prof1 uuid; v_prof2 uuid; v_again uuid;
  v_outbox record;
  v_notice record;
  v_count integer;
  v_rendered record;
begin
  select user_id into v_admin from public.platform_members limit 1;
  select uuid_val into v_p1 from x2_ctx where key = 'p1';
  select uuid_val into v_p2 from x2_ctx where key = 'p2';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Publication du prospect avec e-mail.
  v_prof1 := public.publish_external_professional(v_p1, 'QA X2');
  insert into x2_ctx (key, uuid_val) values ('prof1', v_prof1);

  select * into v_outbox from public.email_outbox
  where dedupe_key = 'publication_notice:' || v_prof1::text;
  perform pg_temp.record('déclenchement', 'la publication met l''information en file',
    v_outbox.id is not null and v_outbox.template = 'external_profile_published'
    and v_outbox.status = 'queued', coalesce('status=' || v_outbox.status, 'aucune ligne'));
  perform pg_temp.record('déclenchement', 'destinataire = l''adresse du prospect',
    v_outbox.to_email = 'qa-x2-prospect-un@fadeup.test', v_outbox.to_email);
  perform pg_temp.record('déclenchement', 'flux prospecting, locale fr (pays FR)',
    v_outbox.stream = 'prospecting' and v_outbox.locale = 'fr',
    v_outbox.stream || '/' || v_outbox.locale);
  perform pg_temp.record('déclenchement', 'le payload porte retrait, désabonnement et page d''information',
    (v_outbox.payload ? 'withdrawal_url') and (v_outbox.payload ? 'unsubscribe_url')
    and (v_outbox.payload ->> 'info_url') like 'https://fade-up.com/professionals-data%');
  perform pg_temp.record('déclenchement', 'le lien de désabonnement pointe la fonction One-Click (RFC 8058)',
    (v_outbox.payload ->> 'unsubscribe_url') like 'https://fade-up.com/functions/v1/unsubscribe/%');

  -- Le payload réel rend sans placeholder orphelin.
  begin
    select * into v_rendered
    from private.render_email_template(v_outbox.template, v_outbox.locale, v_outbox.payload);
    perform pg_temp.record('déclenchement', 'le payload réel rend le gabarit sans trou',
      btrim(v_rendered.subject) <> '');
  exception when others then
    perform pg_temp.record('déclenchement', 'le payload réel rend le gabarit sans trou', false, sqlerrm);
  end;

  select * into v_notice from public.professional_information_notices
  where professional_id = v_prof1;
  perform pg_temp.record('déclenchement', 'la trace existe : canal email, outbox lié',
    v_notice.channel = 'email' and v_notice.outbox_id = v_outbox.id
    and v_notice.email = v_outbox.to_email);

  -- Republication (branche idempotente) : même identité, pas de second envoi.
  v_again := public.publish_external_professional(v_p1, 'QA X2 again');
  select count(*) into v_count from public.email_outbox
  where dedupe_key = 'publication_notice:' || v_prof1::text;
  perform pg_temp.record('déclenchement', 'republication : une seule information, jamais deux',
    v_again = v_prof1 and v_count = 1, 'outbox=' || v_count);
  select count(*) into v_count from public.professional_information_notices
  where professional_id = v_prof1;
  perform pg_temp.record('déclenchement', 'republication : une seule trace',
    v_count = 1, 'notices=' || v_count);

  -- Publication du prospect SANS e-mail : la publication passe, la trace dit
  -- que la page publique couvre le cas.
  v_prof2 := public.publish_external_professional(v_p2, 'QA X2 no email');
  insert into x2_ctx (key, uuid_val) values ('prof2', v_prof2);

  select count(*) into v_count from public.email_outbox
  where dedupe_key = 'publication_notice:' || v_prof2::text;
  select * into v_notice from public.professional_information_notices
  where professional_id = v_prof2;
  perform pg_temp.record('déclenchement', 'sans e-mail : publication possible, zéro envoi, trace public_page_only',
    v_count = 0 and v_notice.channel = 'public_page_only' and v_notice.email is null,
    'outbox=' || v_count || ' canal=' || coalesce(v_notice.channel, 'aucun'));

  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('déclenchement', 'parcours de publication', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 2c — les gardes de contact du durcissement (revue X2)
--
-- Le scénario A de la revue : un profil DÉJÀ PUBLIC dont le prospect s'est
-- désabonné, sans trace d'information préalable — un re-clic Publier mettait
-- en file un e-mail vers l'adresse qui a dit non. Plus maintenant.
-- ===========================================================================

do $$
declare
  v_admin uuid;
  v_type text;
  v_src uuid;
  v_p3 uuid;
  v_prof3 uuid;
  v_count integer;
  v_notice record;
begin
  select user_id into v_admin from public.platform_members limit 1;
  select id into v_src from public.prospect_sources where key = 'qa_x2_source_a';
  select enumlabel into v_type
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'prospect_type' order by e.enumsortorder limit 1;

  insert into public.prospects (type, canonical_name, country, email)
  values (v_type::public.prospect_type, 'QA X2 Salon Trois', 'FR', 'qa-x2-prospect-trois@fadeup.test')
  returning id into v_p3;
  insert into public.prospect_source_records (source_id, prospect_id)
  values (v_src, v_p3), ((select id from public.prospect_sources where key = 'qa_x2_source_b'), v_p3);
  insert into public.prospect_locations (prospect_id, country, city) values (v_p3, 'FR', 'Nice');
  insert into x2_ctx (key, uuid_val) values ('p3', v_p3);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_prof3 := public.publish_external_professional(v_p3, 'QA X2 scenario A');
  insert into x2_ctx (key, uuid_val) values ('prof3', v_prof3);

  -- Reconstruire l'état du scénario A : public, désabonné, AUCUNE trace.
  delete from public.professional_information_notices where professional_id = v_prof3;
  delete from public.email_outbox where dedupe_key = 'publication_notice:' || v_prof3::text;
  update public.prospects set do_not_contact = true where id = v_p3;

  perform public.publish_external_professional(v_p3, 'QA X2 re-clic');

  select count(*) into v_count from public.email_outbox
  where dedupe_key = 'publication_notice:' || v_prof3::text;
  select * into v_notice from public.professional_information_notices
  where professional_id = v_prof3;
  perform pg_temp.record('gardes-contact', 're-clic sur profil public désabonné : ZÉRO e-mail, trace public_page_only',
    v_count = 0 and v_notice.channel = 'public_page_only',
    'outbox=' || v_count || ' canal=' || coalesce(v_notice.channel, 'aucun'));

  -- Adresse supprimée (hard bounce passé) : la branche idempotente refuse la
  -- RE-publication avec le motif du garde authoritatif — les deux branches
  -- partagent désormais UNE définition de l'éligibilité.
  update public.prospects set do_not_contact = false where id = v_p3;
  insert into public.prospect_suppressions (scope, value, reason)
  values ('email', 'qa-x2-prospect-trois@fadeup.test', 'hard_bounce')
  on conflict (scope, value) where value is not null do nothing;
  update public.professionals set is_public = false where id = v_prof3;

  begin
    perform public.publish_external_professional(v_p3, 'QA X2 suppressed_email');
    perform pg_temp.record('gardes-contact', 'adresse supprimée : la re-publication est refusée (définition unifiée)',
      false, 'la republication est passée');
  exception when others then
    perform pg_temp.record('gardes-contact', 'adresse supprimée : la re-publication est refusée (définition unifiée)',
      sqlstate = '42501' and sqlerrm like '%suppressed_email%', sqlerrm);
  end;

  -- Remettre prof3 public pour les tests de retrait plus bas.
  delete from public.prospect_suppressions
  where scope = 'email' and value = 'qa-x2-prospect-trois@fadeup.test' and reason = 'hard_bounce';
  perform public.publish_external_professional(v_p3, 'QA X2 re-publication propre');
  perform pg_temp.record('gardes-contact', 'suppression levée : la re-publication redevient possible',
    (select is_public from public.professionals where id = v_prof3));

  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('gardes-contact', 'parcours scénario A', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 1 — la demande de retrait publique
-- ===========================================================================

do $$
declare
  v_prof1 uuid; v_prof2 uuid;
  v_r record;
  v_row record;
  v_count integer;
  v_token text;
  v_claimed uuid;
begin
  select uuid_val into v_prof1 from x2_ctx where key = 'prof1';
  select uuid_val into v_prof2 from x2_ctx where key = 'prof2';

  if v_prof1 is null or v_prof2 is null then
    perform pg_temp.record('retrait', 'préalable : profils publiés', false,
      'la publication a échoué en amont — voir le chantier déclenchement');
    return;
  end if;

  -- Formulaire public, jeton absent ou invalide → canal public_form.
  select * into v_r from public.submit_marketplace_withdrawal_request(
    v_prof1, 'demandeur@example.test', 'Je ne souhaite pas figurer sur FadeUp.', 'jeton-invalide');
  select * into v_row from public.marketplace_withdrawal_requests where id = v_r.request_id;
  perform pg_temp.record('retrait', 'la demande publique entre dans le circuit B2',
    v_row.id is not null and v_row.requested_via = 'public_form'
    and v_row.status = 'pending' and not v_r.already_pending,
    'via=' || coalesce(v_row.requested_via, 'aucune'));
  perform pg_temp.record('retrait', 'échéance de 72 h posée',
    v_r.deadline_at between now() + interval '71 hours' and now() + interval '73 hours');
  perform pg_temp.record('retrait', 'l''adresse du demandeur est tracée',
    v_row.requester_email = 'demandeur@example.test');

  -- Re-soumission : une seule demande en cours, la même échéance rendue.
  select * into v_r from public.submit_marketplace_withdrawal_request(v_prof1);
  select count(*) into v_count from public.marketplace_withdrawal_requests
  where professional_id = v_prof1 and status = 'pending';
  perform pg_temp.record('retrait', 're-soumission : idempotente, une seule demande en cours',
    v_r.already_pending and v_count = 1, 'pending=' || v_count);

  -- Jeton valide → canal email_link (le contrôle de la boîte est prouvé).
  select pr.outreach_unsubscribe_token into v_token
  from public.prospects pr
  join public.prospect_professionals pp on pp.prospect_id = pr.id
  where pp.professional_id = v_prof2;
  select * into v_r from public.submit_marketplace_withdrawal_request(
    v_prof2, null, null, v_token);
  select * into v_row from public.marketplace_withdrawal_requests where id = v_r.request_id;
  perform pg_temp.record('retrait', 'le jeton de l''e-mail marque le canal email_link',
    v_row.requested_via = 'email_link', 'via=' || coalesce(v_row.requested_via, 'aucune'));

  -- Profil revendiqué : refus nommé, identique au chemin opérateur B2.
  select id into v_claimed from public.professionals
  where claim_state = 'claimed' limit 1;
  if v_claimed is null then
    perform pg_temp.record('retrait', 'profil revendiqué refusé (fadeup_withdrawal_refusal)',
      false, 'aucun profil revendiqué en base pour exercer le refus');
  else
    begin
      perform public.submit_marketplace_withdrawal_request(v_claimed);
      perform pg_temp.record('retrait', 'profil revendiqué refusé (fadeup_withdrawal_refusal)', false,
        'la demande est passée');
    exception when others then
      perform pg_temp.record('retrait', 'profil revendiqué refusé (fadeup_withdrawal_refusal)',
        sqlstate = '42501' and sqlerrm like '%claimed%');
    end;
  end if;

  -- Adresse invalide : refus nommé.
  begin
    perform public.submit_marketplace_withdrawal_request(v_prof1, 'pas-une-adresse');
    perform pg_temp.record('retrait', 'adresse invalide refusée', false, 'la demande est passée');
  exception when others then
    perform pg_temp.record('retrait', 'adresse invalide refusée', sqlstate = '22023');
  end;
exception when others then
  perform pg_temp.record('retrait', 'parcours de retrait public', false, sqlerrm);
end $$;

-- Durcissements revue X2 : le canal opérateur reste invisible au public.
do $$
declare
  v_admin uuid;
  v_prof3 uuid;
  v_r record;
  v_op record;
  v_count integer;
begin
  select user_id into v_admin from public.platform_members limit 1;
  select uuid_val into v_prof3 from x2_ctx where key = 'prof3';
  if v_prof3 is null then
    perform pg_temp.record('retrait', 'préalable : prof3 publié', false, 'scénario A en échec en amont');
    return;
  end if;

  -- L'opérateur enregistre une demande (canal 'phone').
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select * into v_op from public.request_marketplace_withdrawal(v_prof3, 'phone', 'appel du salon');
  perform set_config('request.jwt.claims', '', true);

  -- Le formulaire public sur la même fiche : il ne doit RIEN apprendre —
  -- ni already_pending, ni l'échéance réelle (plus proche), juste
  -- l'engagement générique de 72 h. Et aucune seconde ligne.
  select * into v_r from public.submit_marketplace_withdrawal_request(v_prof3);
  select count(*) into v_count from public.marketplace_withdrawal_requests
  where professional_id = v_prof3 and status = 'pending';
  perform pg_temp.record('retrait', 'demande opérateur existante : rien révélé au formulaire public',
    (not v_r.already_pending)
    and v_r.deadline_at between now() + interval '71 hours 55 minutes' and now() + interval '72 hours 5 minutes'
    and v_r.deadline_at >= v_op.deadline_at
    and v_count = 1,
    'already_pending=' || v_r.already_pending || ' pending=' || v_count);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('retrait', 'dissimulation du canal opérateur', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 3 — le traitement des événements Resend
-- ===========================================================================

do $$
declare
  v_prof1 uuid;
  v_outbox_id uuid;
  v_r record;
  v_row record;
  v_count integer;
begin
  select uuid_val into v_prof1 from x2_ctx where key = 'prof1';

  if v_prof1 is null then
    perform pg_temp.record('webhook', 'préalable : profil publié', false,
      'la publication a échoué en amont');
    return;
  end if;

  -- Simuler l'acceptation Resend du message d'information.
  update public.email_outbox
  set status = 'sent', provider_message_id = 'qa-x2-msg-0001', sent_at = now()
  where dedupe_key = 'publication_notice:' || v_prof1::text
  returning id into v_outbox_id;

  -- 1. Délivré.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-delivered', 'email.delivered', jsonb_build_object(
    'type', 'email.delivered', 'created_at', now()::text,
    'data', jsonb_build_object('email_id', 'qa-x2-msg-0001',
                               'to', jsonb_build_array('qa-x2-prospect-un@fadeup.test'))));
  select * into v_r from public.run_email_feedback_maintenance();
  select * into v_row from public.email_outbox where id = v_outbox_id;
  perform pg_temp.record('webhook', 'email.delivered → delivered_at posé',
    v_row.delivered_at is not null and v_r.events_processed = 1);
  perform pg_temp.record('webhook', 'la machine d''état B2 est intacte (sent reste sent)',
    v_row.status = 'sent');

  -- 2. Rejeu du même événement : clé primaire → non-événement, aucun double effet.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-delivered', 'email.delivered', '{}'::jsonb)
  on conflict (event_id) do nothing;
  select count(*) into v_count from public.resend_webhook_events
  where event_id = 'qa-x2-evt-delivered';
  select * into v_r from public.run_email_feedback_maintenance();
  perform pg_temp.record('webhook', 'rejeu : une seule ligne, zéro retraitement',
    v_count = 1 and v_r.events_processed = 0,
    'lignes=' || v_count || ' retraités=' || v_r.events_processed);

  -- 3. Rebond TRANSITOIRE : horodaté, PAS de suppression.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-soft', 'email.bounced', jsonb_build_object(
    'type', 'email.bounced', 'created_at', now()::text,
    'data', jsonb_build_object('email_id', 'qa-x2-msg-0001',
                               'bounce', jsonb_build_object('type', 'Transient'),
                               'to', jsonb_build_array('qa-x2-prospect-un@fadeup.test'))));
  select * into v_r from public.run_email_feedback_maintenance();
  select count(*) into v_count from public.prospect_suppressions
  where scope = 'email' and value = 'qa-x2-prospect-un@fadeup.test';
  perform pg_temp.record('webhook', 'rebond transitoire : aucune suppression',
    v_count = 0 and v_r.addresses_suppressed = 0);

  -- 4. Rebond DUR : suppression de l'adresse + do_not_contact sur le prospect.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-hard', 'email.bounced', jsonb_build_object(
    'type', 'email.bounced', 'created_at', now()::text,
    'data', jsonb_build_object('email_id', 'qa-x2-msg-0001',
                               'bounce', jsonb_build_object('type', 'Permanent'),
                               'to', jsonb_build_array('QA-X2-Prospect-Un@fadeup.test'))));
  select * into v_r from public.run_email_feedback_maintenance();
  select count(*) into v_count from public.prospect_suppressions
  where scope = 'email' and value = 'qa-x2-prospect-un@fadeup.test' and reason = 'hard_bounce';
  perform pg_temp.record('webhook', 'rebond dur : adresse supprimée (normalisée en minuscules)',
    v_count = 1 and v_r.addresses_suppressed >= 1);
  perform pg_temp.record('webhook', 'rebond dur : do_not_contact posé sur le prospect',
    (select do_not_contact from public.prospects
     where email = 'qa-x2-prospect-un@fadeup.test'));
  perform pg_temp.record('webhook', 'rebond dur : bounce_classification tracée',
    (select bounce_classification from public.email_outbox where id = v_outbox_id) = 'permanent');

  -- 5. Plainte : suppression, même sans correspondance outbox.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-complaint', 'email.complained', jsonb_build_object(
    'type', 'email.complained', 'created_at', now()::text,
    'data', jsonb_build_object('email_id', 'qa-x2-msg-inconnu',
                               'to', jsonb_build_array('qa-x2-plainte@fadeup.test'))));
  select * into v_r from public.run_email_feedback_maintenance();
  select count(*) into v_count from public.prospect_suppressions
  where scope = 'email' and value = 'qa-x2-plainte@fadeup.test' and reason = 'spam_complaint';
  perform pg_temp.record('webhook', 'plainte : adresse supprimée définitivement', v_count = 1);

  -- 6. Type inconnu : journalisé, marqué skipped, jamais failed.
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-unknown', 'email.sent', '{"type":"email.sent"}'::jsonb);
  select * into v_r from public.run_email_feedback_maintenance();
  perform pg_temp.record('webhook', 'type non traité → skipped',
    (select status from public.resend_webhook_events where event_id = 'qa-x2-evt-unknown') = 'skipped');

  -- 7. created_at malformé : l'horodatage est défensif, l'événement passe
  -- quand même (revue X2 — un cast qui lève aurait perdu un rebond dur).
  insert into public.resend_webhook_events (event_id, event_type, payload)
  values ('qa-x2-evt-badts', 'email.delivered', jsonb_build_object(
    'type', 'email.delivered', 'created_at', 'pas-une-date',
    'data', jsonb_build_object('email_id', 'qa-x2-msg-0001')));
  select * into v_r from public.run_email_feedback_maintenance();
  perform pg_temp.record('webhook', 'created_at malformé : traité, jamais failed',
    (select status from public.resend_webhook_events where event_id = 'qa-x2-evt-badts') = 'processed');

  -- 8. Un événement failed REVIENT (attempts < 5) — la première version le
  -- perdait pour toujours.
  insert into public.resend_webhook_events (event_id, event_type, payload, status, attempts)
  values ('qa-x2-evt-retry', 'email.delivered', jsonb_build_object(
    'type', 'email.delivered',
    'data', jsonb_build_object('email_id', 'qa-x2-msg-0001')), 'failed', 2);
  select * into v_r from public.run_email_feedback_maintenance();
  perform pg_temp.record('webhook', 'un failed est repris et aboutit',
    (select status from public.resend_webhook_events where event_id = 'qa-x2-evt-retry') = 'processed');
exception when others then
  perform pg_temp.record('webhook', 'parcours webhook', false, sqlerrm);
end $$;

-- ===========================================================================
-- Non-republication après retrait (le circuit complet B2 + garde X2)
-- ===========================================================================

do $$
declare
  v_admin uuid;
  v_p1 uuid; v_prof1 uuid;
  v_req uuid;
  v_result record;
begin
  select user_id into v_admin from public.platform_members limit 1;
  select uuid_val into v_p1 from x2_ctx where key = 'p1';
  select uuid_val into v_prof1 from x2_ctx where key = 'prof1';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- L'opérateur exécute la demande publique enregistrée plus haut.
  select id into v_req from public.marketplace_withdrawal_requests
  where professional_id = v_prof1 and status = 'pending';
  select * into v_result from public.complete_marketplace_withdrawal(v_req, 'QA X2');

  perform pg_temp.record('non-republication', 'le retrait dépublie',
    not (select is_public from public.professionals where id = v_prof1));

  -- Le clic Publier ne doit PAS annuler le retrait (garde X2 sur la branche
  -- idempotente — avant X2, ce chemin republiait sans consulter aucun garde).
  begin
    perform public.publish_external_professional(v_p1, 'QA X2 republication');
    perform pg_temp.record('non-republication', 'la republication d''un profil retiré est refusée',
      false, 'la republication est passée');
  exception when others then
    perform pg_temp.record('non-republication', 'la republication d''un profil retiré est refusée',
      sqlstate = '42501' and sqlerrm like '%do_not_contact%', sqlerrm);
  end;

  perform pg_temp.record('non-republication', 'le profil reste dépublié',
    not (select is_public from public.professionals where id = v_prof1));

  -- Revue X2 : une fiche non publiée n'a rien à retirer — le formulaire
  -- public la refuse (sinon : échéance 72 h factice dans l'écran opérateur).
  begin
    perform public.submit_marketplace_withdrawal_request(v_prof1);
    perform pg_temp.record('retrait', 'fiche non publiée : refus nommé profile_not_published',
      false, 'la demande est passée');
  exception when others then
    perform pg_temp.record('retrait', 'fiche non publiée : refus nommé profile_not_published',
      sqlstate = '42501' and sqlerrm like '%not published%');
  end;

  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('non-republication', 'parcours de retrait', false, sqlerrm);
end $$;

-- ===========================================================================
-- ACL et surface
-- ===========================================================================

do $$
begin
  perform pg_temp.record('acl', 'submit_marketplace_withdrawal_request exécutable par anon',
    has_function_privilege('anon',
      'public.submit_marketplace_withdrawal_request(uuid,text,text,text)'::regprocedure, 'execute'));
  perform pg_temp.record('acl', 'withdraw_external_professional PAS exécutable par anon',
    not has_function_privilege('anon',
      'public.withdraw_external_professional(uuid,text)'::regprocedure, 'execute'));
  perform pg_temp.record('acl', 'run_email_feedback_maintenance : scheduler oui, clients non',
    has_function_privilege('fadeup_scheduler',
      'public.run_email_feedback_maintenance()'::regprocedure, 'execute')
    and not has_function_privilege('anon',
      'public.run_email_feedback_maintenance()'::regprocedure, 'execute')
    and not has_function_privilege('authenticated',
      'public.run_email_feedback_maintenance()'::regprocedure, 'execute'));
  perform pg_temp.record('acl', 'apply_resend_webhook_feedback : aucun rôle client',
    not has_function_privilege('anon',
      'private.apply_resend_webhook_feedback(integer)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated',
      'private.apply_resend_webhook_feedback(integer)'::regprocedure, 'execute'));
  perform pg_temp.record('acl', 'resend_webhook_events : anon rien, authenticated lecture seule',
    not has_table_privilege('anon', 'public.resend_webhook_events', 'select')
    and has_table_privilege('authenticated', 'public.resend_webhook_events', 'select')
    and not has_table_privilege('authenticated', 'public.resend_webhook_events', 'insert')
    and has_table_privilege('service_role', 'public.resend_webhook_events', 'insert'));
  perform pg_temp.record('acl', 'professional_information_notices : anon rien, écriture aucune',
    not has_table_privilege('anon', 'public.professional_information_notices', 'select')
    and not has_table_privilege('authenticated', 'public.professional_information_notices', 'insert'));
  perform pg_temp.record('acl', 'enqueue_publication_information : aucun rôle client',
    not has_function_privilege('anon',
      'private.enqueue_publication_information(uuid)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated',
      'private.enqueue_publication_information(uuid)'::regprocedure, 'execute'));
end $$;

-- ===========================================================================
-- RÉSULTATS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from x2_results order by seq;

select verdict, count(*) from x2_results group by verdict order by verdict;

rollback;
