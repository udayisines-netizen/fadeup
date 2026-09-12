-- Retour arrière de 20260912060000_b5_erasure_residuals.sql.
--
-- À APPLIQUER EN postgres.
--
-- Ce fichier REMET private.erase_customer_account dans l'état exact que
-- 20260911210000_b5_account_erasure_addendum.sql lui donne — corps copié
-- VERBATIM de ce fichier, commentaire compris. Il ne « défait » pas les deux
-- suppressions ajoutées : il restaure la version antérieure de la fonction,
-- qui ne les contenait pas.
--
-- IL NE RESSUSCITE RIEN. Les lignes email_outbox et auth.audit_log_entries
-- qu'un effacement aura supprimées entre-temps sont parties pour de bon :
-- c'était le but. Un retour arrière rend le CODE à son état antérieur, pas
-- les données à quelqu'un qui a demandé leur effacement.
--
-- ORDRE : ce down doit être joué AVANT celui de 20260911210000, qui
-- supprime la fonction ; l'ordre inverse des horodatages le donne
-- naturellement.

begin;

create or replace function private.erase_customer_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope jsonb := '{}'::jsonb;
  v_emails text[];
  v_sentinel text := private.erasure_display_sentinel();
  v_customer_ids uuid[];
  v_request_ids uuid[];
  v_review_ids uuid[];
  v_appointment_ids uuid[];
  v_queue_ids uuid[];
  v_ticket_ids uuid[];
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'private.erase_customer_account requires a user id'
      using errcode = '22023';
  end if;

  perform set_config('fadeup.account_erasure', 'on', true);

  select array_remove(array_agg(distinct lower(e)), null) into v_emails
  from (
    select u.email::text as e from auth.users u where u.id = p_user_id
    union all
    select cp.email from public.customer_profiles cp where cp.user_id = p_user_id
  ) s;

  select array_remove(array_agg(c.id), null) into v_customer_ids
  from public.customers c where c.user_id = p_user_id;

  -- 6.1 La fiche client du salon : elle RESTE (c'est sa comptabilité), elle
  --     ne nomme plus personne. `notes` est la colonne héritée qu'OS-2 a
  --     retirée du service : la mettre à NULL reste permis (la garde ne
  --     refuse qu'une ÉCRITURE non vide) et garantit qu'une ligne ancienne
  --     ne la porte plus.
  update public.customers c
     set name = v_sentinel, phone = null, email = null, notes = null
   where c.user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('customers_anonymised', v_n);

  -- 6.1bis La note du salon sur son client (OS-2) : supprimée.
  if v_customer_ids is not null and array_length(v_customer_ids, 1) > 0 then
    delete from public.customer_notes cn where cn.customer_id = any(v_customer_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('customer_notes_deleted', v_n);

  -- 6.2 Les rendez-vous. Les faits comptables restent intacts.
  select array_remove(array_agg(a.id), null) into v_appointment_ids
  from public.appointments a
  where a.booked_by_user_id = p_user_id
     or (v_customer_ids is not null and a.customer_id = any(v_customer_ids));

  update public.appointments a
     set customer_name = v_sentinel,
         customer_phone = null,
         customer_email = null,
         notes = null
   where a.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and a.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('appointments_anonymised', v_n);

  -- 6.3 Les files.
  select array_remove(array_agg(q.id), null) into v_queue_ids
  from public.queue_entries q
  where q.booked_by_user_id = p_user_id
     or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));

  update public.queue_entries q
     set customer_name = v_sentinel,
         customer_phone = null,
         notes = null
   where q.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('queue_entries_anonymised', v_n);

  -- 6.3bis Les billets de support (PLAT-2) : caviardés, jamais supprimés —
  --        le fil est en ajout seul et le reste.
  select array_remove(array_agg(st.id), null) into v_ticket_ids
  from public.support_tickets st
  where st.subject_user_id = p_user_id
     or st.opened_by = p_user_id
     or (v_appointment_ids is not null and st.appointment_id = any(v_appointment_ids))
     or (v_queue_ids is not null and st.queue_entry_id = any(v_queue_ids));

  if v_ticket_ids is not null and array_length(v_ticket_ids, 1) > 0 then
    update public.support_tickets st
       set subject = v_sentinel,
           body = v_sentinel,
           resolution = case when st.resolution is null then null else v_sentinel end
     where st.id = any(v_ticket_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('support_tickets_redacted', v_n);

    update public.support_ticket_messages sm
       set body = v_sentinel,
           author_user_id = null,
           metadata = '{}'::jsonb
     where sm.ticket_id = any(v_ticket_ids)
       and (sm.body is distinct from v_sentinel
            or sm.author_user_id is not null
            or sm.metadata is distinct from '{}'::jsonb);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('support_messages_redacted', v_n);
  else
    v_scope := v_scope || jsonb_build_object(
      'support_tickets_redacted', 0, 'support_messages_redacted', 0);
  end if;

  -- 6.4 Les listes d'attente.
  update public.waitlist_entries w
     set customer_name = v_sentinel,
         customer_phone = null,
         customer_email = null,
         notes = null
   where w.created_by = p_user_id
      or (v_customer_ids is not null and w.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('waitlist_entries_anonymised', v_n);

  -- 6.5 Les avis : ils restent publiés, leur auteur part. Les identifiants
  --     sont capturés AVANT l'anonymisation.
  select array_remove(array_agg(r.id), null) into v_review_ids
  from public.reviews r where r.customer_user_id = p_user_id;

  update public.reviews r
     set customer_user_id = null,
         reviewer_display_name = v_sentinel
   where r.customer_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('reviews_anonymised', v_n);

  -- 6.6 Les demandes d'intérêt (profils non revendiqués, F4).
  select array_remove(array_agg(pirc.request_id), null) into v_request_ids
  from public.professional_interest_request_contacts pirc
  where pirc.booked_by_user_id = p_user_id
     or (v_emails is not null and lower(pirc.customer_email) = any(v_emails));

  if v_request_ids is not null and array_length(v_request_ids, 1) > 0 then
    delete from public.professional_interest_request_contacts pirc
     where pirc.request_id = any(v_request_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('interest_contacts_deleted', v_n);

    update public.professional_interest_requests pir
       set customer_display_name = v_sentinel, notes = null
     where pir.id = any(v_request_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('interest_requests_anonymised', v_n);
  else
    v_scope := v_scope || jsonb_build_object(
      'interest_contacts_deleted', 0, 'interest_requests_anonymised', 0);
  end if;

  -- 6.7 Les photos d'avis : les objets de stockage sont DÉJÀ partis
  --     (précondition media_not_purged) ; les lignes partent avec.
  if v_review_ids is not null and array_length(v_review_ids, 1) > 0 then
    delete from public.review_photos rp where rp.review_id = any(v_review_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('review_photos_deleted', v_n);

  -- 6.7bis Les notifications reçues par le SALON (voir 20260911160200 §6.7bis).
  if v_appointment_ids is not null and array_length(v_appointment_ids, 1) > 0 then
    update public.notifications n
       set body = v_sentinel
     where n.appointment_id = any(v_appointment_ids)
       and n.body is not null
       and n.body <> v_sentinel;
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('shop_notifications_anonymised', v_n);

  delete from public.notifications n
   where n.dedupe_key like '%' || p_user_id::text || '%';
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('shop_notifications_deleted', v_n);

  -- 6.8 Les e-mails transactionnels.
  if v_emails is not null and array_length(v_emails, 1) > 0 then
    delete from public.email_outbox eo where lower(eo.to_email) = any(v_emails);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('email_outbox_deleted', v_n);

  -- 6.9 Le compte lui-même, et toutes ses cascades.
  delete from auth.users u where u.id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('auth_users_deleted', v_n);

  -- 6.10 Le journal analytique, EN DERNIER.
  update public.analytics_events ae
     set actor_user_id = null,
         actor_type = 'anonymous'
   where ae.actor_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('analytics_events_deidentified', v_n);

  update public.analytics_events ae
     set dedupe_key = null
   where ae.dedupe_key like '%' || p_user_id::text || '%';
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('analytics_dedupe_keys_cleared', v_n);

  return v_scope;
end;
$$;

comment on function private.erase_customer_account(uuid) is
  'L''effaceur. AUCUN grant : ni anon, ni authenticated, ni service_role ne peuvent l''appeler — c''est ce qui fait qu''un utilisateur ne peut pas effacer le compte d''un autre en contournant public.delete_my_account(). Ne vérifie AUCUN droit et ne doit jamais en vérifier : c''est son appelant public qui décide de qui il parle, et il ne parle que de son propre appelant. Suppose les préconditions déjà mesurées (private.account_erasure_blockers).';

commit;
