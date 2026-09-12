-- B5 — retour arrière de l'addendum du chantier 1.
--
-- À APPLIQUER EN postgres. Ce down ramène erase_customer_account() et
-- export_my_data() à leur version 20260911160200 (sans customer_notes, sans
-- support_tickets, sans shop_notes) et REND les grants par défaut de
-- public.account_erasure_log — ce qui est le comportement d'une table neuve
-- avant cet addendum, pas un élargissement décidé ici.
--
-- Il ne se lance jamais seul : le down de 20260911160200 supprime les deux
-- fonctions et la table. L'ordre inverse (300 puis 200) est le seul correct.

begin;

grant select, insert, update, delete on public.account_erasure_log to anon;
grant select, insert, update, delete on public.account_erasure_log to authenticated;

-- La garde d'ajout seul des messages de support revient à sa version PLAT-2,
-- copiée VERBATIM (md5 comparé après down dans le bac d'essai fidèle).
create or replace function public.reject_support_ticket_message_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'support_ticket_messages est en ajout seul : % n''est pas permis', tg_op
    using errcode = '42501';
end;
$$;

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

  update public.customers c
     set name = v_sentinel, phone = null, email = null, notes = null
   where c.user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('customers_anonymised', v_n);

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

  update public.queue_entries q
     set customer_name = v_sentinel,
         customer_phone = null,
         notes = null
   where q.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('queue_entries_anonymised', v_n);

  update public.waitlist_entries w
     set customer_name = v_sentinel,
         customer_phone = null,
         customer_email = null,
         notes = null
   where w.created_by = p_user_id
      or (v_customer_ids is not null and w.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('waitlist_entries_anonymised', v_n);

  select array_remove(array_agg(r.id), null) into v_review_ids
  from public.reviews r where r.customer_user_id = p_user_id;

  update public.reviews r
     set customer_user_id = null,
         reviewer_display_name = v_sentinel
   where r.customer_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('reviews_anonymised', v_n);

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

  if v_review_ids is not null and array_length(v_review_ids, 1) > 0 then
    delete from public.review_photos rp where rp.review_id = any(v_review_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('review_photos_deleted', v_n);

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

  if v_emails is not null and array_length(v_emails, 1) > 0 then
    delete from public.email_outbox eo where lower(eo.to_email) = any(v_emails);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('email_outbox_deleted', v_n);

  delete from auth.users u where u.id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('auth_users_deleted', v_n);

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

commit;
