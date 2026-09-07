-- FadeUp — B4 chantiers 4 (2/2) et 5 (2/2) : écritures et notifications.
--
-- RPC d'écriture : create_post, delete_post, like_post, unlike_post,
-- submit_review, reply_to_review, report_review, moderate_review,
-- resolve_review_report. Toutes security definer, possédées par postgres —
-- elles REFONT donc explicitement les vérifications d'autorité que RLS
-- aurait faites (une fonction definer ne consulte pas les policies de
-- l'appelant), en miroir exact des policies du chantier 1.
--
-- Les gardes métier (média 1..10, cohérence d'organisation, éligibilité
-- d'avis, fenêtre 30 jours, un avis par prestation) sont portées PAR LES
-- TRIGGERS des chantiers 1 et 3 — la vérité — et re-testées ici pour rendre
-- des erreurs propres. Aucun chemin d'écriture ne les contourne.
--
-- NOTIFICATIONS SOCIALES (chantier 5). Quatre triggers produisent les quatre
-- types ajoutés par 20260907120300. E-mails : par email_outbox et ses
-- gabarits en table, le mécanisme livré par B2 — AUCUN second système.
--   review_received → e-mail (rare, à forte valeur : la réputation du pro)
--   review_reply    → e-mail (rare, le client attend cette réponse)
--   new_follower    → in-app seulement (fréquent, faible urgence ; MASTER_SPEC
--                     §13 réserve l'e-mail au transactionnel et à l'important)
--   post_liked      → in-app seulement (le plus fréquent, le moins urgent —
--                     un e-mail par like serait du spam auto-infligé)
--
-- Idempotent : sûr à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- create_post
-- ---------------------------------------------------------------------------

create or replace function public.create_post(
  p_author_kind text,
  p_media jsonb,
  p_caption text default null,
  p_visibility text default 'public',
  p_organization_id uuid default null,
  p_posted_at_organization_id uuid default null,
  p_service_ids uuid[] default null
)
returns public.posts
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_professional_id uuid;
  v_organization_id uuid;
  v_posted_at uuid;
  v_post public.posts;
  v_item jsonb;
  v_count integer;
  v_path text;
  v_position smallint := 0;
  v_service uuid;
begin
  if v_uid is null then
    raise exception 'authentication required to publish' using errcode = '42501';
  end if;

  if p_author_kind = 'professional' then
    select p.id into v_professional_id
    from public.professionals p
    where p.user_id = v_uid;
    if v_professional_id is null then
      raise exception 'no professional identity is attached to this account' using errcode = '42501';
    end if;
    v_organization_id := null;

    if p_posted_at_organization_id is not null then
      v_posted_at := p_posted_at_organization_id; -- validé par posts_check_consistency
    else
      -- Rattachement courant : dérivé quand il est sans ambiguïté.
      select min(b.organization_id::text)::uuid into v_posted_at
      from public.barbers b
      where b.professional_id = v_professional_id
      having count(distinct b.organization_id) = 1;
    end if;

  elsif p_author_kind = 'organization' then
    if p_organization_id is null then
      raise exception 'p_organization_id is required for an organization post';
    end if;
    if not private.has_org_role(p_organization_id, array['owner','manager']::public.membership_role[]) then
      raise exception 'only an owner or manager publishes for an organization' using errcode = '42501';
    end if;
    v_organization_id := p_organization_id;
    v_posted_at := null;
  else
    raise exception 'author_kind must be professional or organization';
  end if;

  v_count := coalesce(jsonb_array_length(p_media), 0);
  if v_count < 1 then
    raise exception 'a post requires at least one media' using errcode = '23514';
  end if;
  if v_count > 10 then
    raise exception 'a post carries at most 10 media' using errcode = '23514';
  end if;

  insert into public.posts (author_kind, professional_id, organization_id,
                            posted_at_organization_id, caption, visibility)
  values (p_author_kind, v_professional_id, v_organization_id,
          v_posted_at, p_caption, coalesce(p_visibility, 'public'))
  returning * into v_post;

  for v_item in select * from jsonb_array_elements(p_media)
  loop
    v_path := v_item->>'storage_path';
    if v_path is null or left(v_path, length(v_uid::text) + 1) <> v_uid::text || '/' then
      -- Le chemin doit vivre dans le dossier de l'appelant : on ne publie pas
      -- le fichier d'un autre.
      raise exception 'media storage_path must live under the caller''s folder' using errcode = '42501';
    end if;
    insert into public.post_media (post_id, storage_path, media_type, width, height, duration_ms, position)
    values (
      v_post.id,
      v_path,
      coalesce(v_item->>'media_type', 'image'),
      nullif(v_item->>'width', '')::integer,
      nullif(v_item->>'height', '')::integer,
      nullif(v_item->>'duration_ms', '')::integer,
      v_position
    );
    v_position := v_position + 1;
  end loop;

  if p_service_ids is not null then
    foreach v_service in array p_service_ids
    loop
      insert into public.post_services (post_id, service_id)
      values (v_post.id, v_service)
      on conflict do nothing; -- la cohérence d'organisation est tranchée par trigger
    end loop;
  end if;

  return v_post;
end;
$$;

comment on function public.create_post(text, jsonb, text, text, uuid, uuid, uuid[]) is
  'Publie un post. Professionnel : identité résolue depuis auth.uid(), jamais depuis un id fourni ; rattachement au salon figé — explicite, ou dérivé quand le professionnel n''a qu''un seul employeur. Organisation : owner/manager seulement. Gardes : 1 à 10 médias, chemins dans le dossier de l''appelant, services de la même organisation (trigger). p_media : tableau de {storage_path, media_type, width, height, duration_ms}.';

revoke execute on function public.create_post(text, jsonb, text, text, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.create_post(text, jsonb, text, text, uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_post
-- ---------------------------------------------------------------------------

create or replace function public.delete_post(p_post_id uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  if not private.can_manage_post(p_post_id) then
    raise exception 'not authorized to delete this post' using errcode = '42501';
  end if;
  -- Les fichiers du bucket ne sont volontairement pas touchés ici : leur
  -- suppression passe par le Storage API sous l'identité de l'uploader
  -- (policy delete own-folder), pas par un DELETE SQL silencieux.
  delete from public.posts where id = p_post_id;
end;
$$;

revoke execute on function public.delete_post(uuid) from public, anon;
grant execute on function public.delete_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- like_post / unlike_post
-- ---------------------------------------------------------------------------

create or replace function public.like_post(p_post_id uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required to like' using errcode = '42501';
  end if;
  if not private.can_view_post(p_post_id) then
    raise exception 'post not found' using errcode = '42501';
  end if;
  insert into public.post_likes (post_id, user_id)
  values (p_post_id, v_uid)
  on conflict (post_id, user_id) do nothing;
end;
$$;

create or replace function public.unlike_post(p_post_id uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  delete from public.post_likes
  where post_id = p_post_id and user_id = (select auth.uid());
end;
$$;

revoke execute on function public.like_post(uuid) from public, anon;
grant execute on function public.like_post(uuid) to authenticated;
revoke execute on function public.unlike_post(uuid) from public, anon;
grant execute on function public.unlike_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_review
-- ---------------------------------------------------------------------------

create or replace function public.submit_review(
  p_appointment_id uuid,
  p_rating integer,
  p_comment text default null,
  p_photo_storage_path text default null,
  p_photo_consent_publish boolean default false
)
returns public.reviews
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_professional_id uuid;
  v_display text;
  v_reduced text;
  v_review public.reviews;
begin
  if v_uid is null then
    raise exception 'authentication required to review' using errcode = '42501';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id;
  if not found or v_appt.booked_by_user_id is distinct from v_uid then
    -- Même réponse que l'inexistence : ne pas confirmer à un tiers qu'un
    -- rendez-vous existe.
    raise exception 'appointment not found for this account' using errcode = '42501';
  end if;
  if v_appt.status <> 'completed' or v_appt.completed_at is null then
    raise exception 'only a completed service can be reviewed' using errcode = '23514';
  end if;
  if now() > v_appt.completed_at + interval '30 days' then
    raise exception 'the 30-day review window has closed' using errcode = '23514';
  end if;
  if exists (select 1 from public.reviews r where r.appointment_id = p_appointment_id) then
    raise exception 'this service has already been reviewed' using errcode = '23505';
  end if;

  select b.professional_id into v_professional_id
  from public.barbers b where b.id = v_appt.barber_id;
  if v_professional_id is null then
    raise exception 'no professional identity behind this appointment';
  end if;

  -- Nom public réduit À L'ÉCRITURE (« Prénom I. », motif B2) : la lecture
  -- publique n'aura jamais à joindre customer_profiles.
  select cp.display_name into v_display
  from public.customer_profiles cp where cp.user_id = v_uid;
  v_display := nullif(btrim(coalesce(v_display, '')), '');
  if v_display is null then
    v_reduced := 'Client';
  else
    v_reduced := split_part(v_display, ' ', 1)
                 || case when split_part(v_display, ' ', 2) <> ''
                         then ' ' || left(split_part(v_display, ' ', 2), 1) || '.'
                         else '' end;
  end if;

  if p_photo_storage_path is not null then
    if not p_photo_consent_publish then
      raise exception 'a review photo requires explicit publication consent' using errcode = '23514';
    end if;
    if left(p_photo_storage_path, length(v_uid::text) + 1) <> v_uid::text || '/' then
      raise exception 'photo storage_path must live under the caller''s folder' using errcode = '42501';
    end if;
  end if;

  insert into public.reviews (appointment_id, customer_user_id, professional_id,
                              organization_id, rating, comment, reviewer_display_name)
  values (p_appointment_id, v_uid, v_professional_id,
          v_appt.organization_id, p_rating, nullif(btrim(coalesce(p_comment, '')), ''), v_reduced)
  returning * into v_review;

  if p_photo_storage_path is not null then
    insert into public.review_photos (review_id, storage_path, consent_publish)
    values (v_review.id, p_photo_storage_path, true);
    -- consent_social_reuse reste false : c'est un accord DISTINCT, jamais
    -- déduit du consentement de publication.
  end if;

  return v_review;
end;
$$;

comment on function public.submit_review(uuid, integer, text, text, boolean) is
  'Dépose l''unique avis d''une prestation terminée : compte réservataire seulement, fenêtre de 30 jours, 1 à 5 étoiles, commentaire facultatif, photo facultative avec consentement de publication explicite. Alimente la réputation du professionnel ET de l''organisation (trigger). Les gardes sont aussi portées par check_reviews_consistency — aucune écriture ne les contourne.';

revoke execute on function public.submit_review(uuid, integer, text, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, integer, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- reply_to_review — une seule réponse publique
-- ---------------------------------------------------------------------------

create or replace function public.reply_to_review(p_review_id uuid, p_body text)
returns public.reviews
language plpgsql security definer
set search_path to ''
as $$
declare
  v_review public.reviews;
begin
  select * into v_review from public.reviews r where r.id = p_review_id;
  if not found then
    raise exception 'review not found' using errcode = '42501';
  end if;
  if not (private.is_own_professional(v_review.professional_id)
          or private.has_org_role(v_review.organization_id, array['owner','manager']::public.membership_role[])) then
    raise exception 'not authorized to reply to this review' using errcode = '42501';
  end if;
  if v_review.reply_body is not null then
    raise exception 'this review already has its public reply' using errcode = '23505';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'reply body must not be blank';
  end if;

  update public.reviews
     set reply_body = btrim(p_body),
         replied_at = now(),
         replied_by_user_id = (select auth.uid())
   where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function public.reply_to_review(uuid, text) from public, anon;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- report_review / moderate_review / resolve_review_report
-- ---------------------------------------------------------------------------

create or replace function public.report_review(
  p_review_id uuid,
  p_reason text,
  p_detail text default null
)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required to report' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reviews r where r.id = p_review_id) then
    raise exception 'review not found' using errcode = '42501';
  end if;
  insert into public.review_reports (review_id, reporter_user_id, reason, detail)
  values (p_review_id, v_uid, p_reason, nullif(btrim(coalesce(p_detail, '')), ''));
exception
  when unique_violation then
    raise exception 'you already reported this review' using errcode = '23505';
end;
$$;

revoke execute on function public.report_review(uuid, text, text) from public, anon;
grant execute on function public.report_review(uuid, text, text) to authenticated;

create or replace function public.moderate_review(
  p_review_id uuid,
  p_status text,
  p_reason text default null
)
returns public.reviews
language plpgsql security definer
set search_path to ''
as $$
declare
  v_review public.reviews;
begin
  if not private.is_platform_admin() then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('published','under_review','removed') then
    raise exception 'invalid moderation status';
  end if;
  -- « La note est mauvaise » n'est pas un motif : seuls les cinq motifs de
  -- la contrainte reviews_moderation_reason_valid sont représentables.
  update public.reviews
     set status = p_status,
         moderation_reason = case when p_status = 'published' then null else p_reason end,
         moderated_at = case when p_status = 'published' then null else now() end,
         moderated_by = case when p_status = 'published' then null else (select auth.uid()) end
   where id = p_review_id
  returning * into v_review;
  if not found then
    raise exception 'review not found';
  end if;
  return v_review;
end;
$$;

revoke execute on function public.moderate_review(uuid, text, text) from public, anon;
grant execute on function public.moderate_review(uuid, text, text) to authenticated;

create or replace function public.resolve_review_report(
  p_report_id uuid,
  p_status text
)
returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('reviewed','dismissed','actioned') then
    raise exception 'invalid report resolution';
  end if;
  update public.review_reports
     set status = p_status,
         resolved_at = now(),
         resolved_by = (select auth.uid())
   where id = p_report_id;
  if not found then
    raise exception 'report not found';
  end if;
end;
$$;

revoke execute on function public.resolve_review_report(uuid, text) from public, anon;
grant execute on function public.resolve_review_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications sociales — triggers producteurs
-- ---------------------------------------------------------------------------

create or replace function private.notify_social(
  p_user_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_organization_id uuid,
  p_dedupe_key text
) returns void
language sql security definer
set search_path to ''
as $$
  insert into public.notifications (user_id, type, title, body, organization_id, dedupe_key)
  values (p_user_id, p_type, p_title, p_body, p_organization_id, p_dedupe_key)
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.notify_professional_follow()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  v_target uuid;
begin
  if new.state <> 'following' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.state = 'following' then
    return null;
  end if;
  select p.user_id into v_target from public.professionals p where p.id = new.professional_id;
  if v_target is null or v_target = new.follower_user_id then
    return null;
  end if;
  perform private.notify_social(
    v_target, 'new_follower',
    'Nouveau follower',
    'Quelqu''un suit désormais votre profil.',
    null,
    'new_follower:professional:' || new.professional_id || ':' || new.follower_user_id
  );
  return null;
end;
$$;

drop trigger if exists professional_follows_notify on public.professional_follows;
create trigger professional_follows_notify
  after insert or update of state on public.professional_follows
  for each row execute function public.notify_professional_follow();

create or replace function public.notify_organization_follow()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  v_member record;
begin
  if not new.is_following then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.is_following then
    return null;
  end if;
  for v_member in
    select m.user_id from public.memberships m
    where m.organization_id = new.organization_id
      and m.role in ('owner','manager')
      and m.user_id <> new.follower_user_id
  loop
    perform private.notify_social(
      v_member.user_id, 'new_follower',
      'Nouveau follower',
      'Quelqu''un suit désormais votre établissement.',
      new.organization_id,
      'new_follower:organization:' || new.organization_id || ':' || new.follower_user_id || ':' || v_member.user_id
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists organization_follows_notify on public.organization_follows;
create trigger organization_follows_notify
  after insert or update of is_following on public.organization_follows
  for each row execute function public.notify_organization_follow();

create or replace function public.notify_post_like()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  v_post public.posts;
  v_target uuid;
begin
  select * into v_post from public.posts p where p.id = new.post_id;
  if not found then
    return null;
  end if;
  if v_post.author_kind = 'professional' then
    select p.user_id into v_target from public.professionals p where p.id = v_post.professional_id;
    if v_target is not null and v_target <> new.user_id then
      perform private.notify_social(
        v_target, 'post_liked',
        'Nouveau like',
        'Votre publication a été aimée.',
        v_post.posted_at_organization_id,
        'post_liked:' || new.post_id || ':' || new.user_id
      );
    end if;
  else
    -- Publication d'organisation : les owners sont prévenus, dédupliqué par
    -- destinataire.
    perform private.notify_social(
      m.user_id, 'post_liked',
      'Nouveau like',
      'La publication de votre établissement a été aimée.',
      v_post.organization_id,
      'post_liked:' || new.post_id || ':' || new.user_id || ':' || m.user_id
    )
    from public.memberships m
    where m.organization_id = v_post.organization_id
      and m.role = 'owner'
      and m.user_id <> new.user_id;
  end if;
  return null;
end;
$$;

drop trigger if exists post_likes_notify on public.post_likes;
create trigger post_likes_notify
  after insert on public.post_likes
  for each row execute function public.notify_post_like();

create or replace function public.notify_review_received()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  v_target uuid;
  v_email text;
  v_locale text;
  v_org_name text;
  v_pro_name text;
  v_member record;
begin
  select p.user_id, p.display_name into v_target, v_pro_name
  from public.professionals p where p.id = new.professional_id;
  select o.name into v_org_name from public.organizations o where o.id = new.organization_id;

  if v_target is not null then
    perform private.notify_social(
      v_target, 'review_received',
      'Nouvel avis reçu',
      new.reviewer_display_name || ' a laissé un avis ' || new.rating || '/5.',
      new.organization_id,
      'review_received:' || new.id || ':' || v_target
    );
    select u.email into v_email from auth.users u where u.id = v_target;
    select pr.locale into v_locale from public.profiles pr where pr.id = v_target;
    if v_email is not null then
      insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
      values (
        v_email, 'review_received',
        case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
        jsonb_build_object(
          'professional_name', coalesce(v_pro_name, ''),
          'organization_name', coalesce(v_org_name, ''),
          'reviewer_name', new.reviewer_display_name,
          'rating', new.rating,
          'comment_excerpt', left(coalesce(new.comment, ''), 300)
        ),
        'transactional',
        'review_received:' || new.id || ':' || v_target
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;

  -- Les owners de l'organisation : in-app seulement, sans doubler le
  -- professionnel quand c'est le même compte.
  for v_member in
    select m.user_id from public.memberships m
    where m.organization_id = new.organization_id
      and m.role = 'owner'
      and m.user_id is distinct from v_target
  loop
    perform private.notify_social(
      v_member.user_id, 'review_received',
      'Nouvel avis reçu',
      new.reviewer_display_name || ' a laissé un avis ' || new.rating || '/5 sur ' || coalesce(v_org_name, 'votre établissement') || '.',
      new.organization_id,
      'review_received:' || new.id || ':' || v_member.user_id
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists reviews_notify_received on public.reviews;
create trigger reviews_notify_received
  after insert on public.reviews
  for each row execute function public.notify_review_received();

create or replace function public.notify_review_reply()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  v_email text;
  v_locale text;
  v_pro_name text;
  v_org_name text;
begin
  if old.reply_body is not null or new.reply_body is null then
    return null;
  end if;
  select p.display_name into v_pro_name from public.professionals p where p.id = new.professional_id;
  select o.name into v_org_name from public.organizations o where o.id = new.organization_id;

  perform private.notify_social(
    new.customer_user_id, 'review_reply',
    'Réponse à votre avis',
    coalesce(v_pro_name, v_org_name, 'Le professionnel') || ' a répondu à votre avis.',
    new.organization_id,
    'review_reply:' || new.id
  );

  select u.email into v_email from auth.users u where u.id = new.customer_user_id;
  select pr.locale into v_locale from public.profiles pr where pr.id = new.customer_user_id;
  if v_email is not null then
    insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
    values (
      v_email, 'review_reply',
      case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
      jsonb_build_object(
        'professional_name', coalesce(v_pro_name, ''),
        'organization_name', coalesce(v_org_name, ''),
        'rating', new.rating,
        'reply_excerpt', left(new.reply_body, 300)
      ),
      'transactional',
      'review_reply:' || new.id
    )
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists reviews_notify_reply on public.reviews;
create trigger reviews_notify_reply
  after update of reply_body on public.reviews
  for each row execute function public.notify_review_reply();

-- ---------------------------------------------------------------------------
-- Gabarits e-mail — FR et EN, flux transactionnel, rendus par
-- private.render_email_template depuis le payload de la ligne d'outbox.
-- ---------------------------------------------------------------------------

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html) values
  ('review_received', 'fr', 'transactional',
   'Nouvel avis {{rating}}/5 — {{reviewer_name}}',
   'Bonjour {{professional_name}},' || chr(10) || chr(10) ||
   '{{reviewer_name}} vient de laisser un avis {{rating}}/5 chez {{organization_name}}.' || chr(10) || chr(10) ||
   '{{comment_excerpt}}' || chr(10) || chr(10) ||
   'Vous pouvez y répondre publiquement depuis votre espace FadeUp — une seule réponse, visible de tous.' || chr(10) || chr(10) ||
   'FadeUp',
   '<p>Bonjour {{professional_name}},</p><p><strong>{{reviewer_name}}</strong> vient de laisser un avis <strong>{{rating}}/5</strong> chez {{organization_name}}.</p><blockquote>{{comment_excerpt}}</blockquote><p>Vous pouvez y répondre publiquement depuis votre espace FadeUp — une seule réponse, visible de tous.</p><p>FadeUp</p>'),
  ('review_received', 'en', 'transactional',
   'New {{rating}}/5 review — {{reviewer_name}}',
   'Hello {{professional_name}},' || chr(10) || chr(10) ||
   '{{reviewer_name}} just left a {{rating}}/5 review at {{organization_name}}.' || chr(10) || chr(10) ||
   '{{comment_excerpt}}' || chr(10) || chr(10) ||
   'You can post one public reply from your FadeUp workspace.' || chr(10) || chr(10) ||
   'FadeUp',
   '<p>Hello {{professional_name}},</p><p><strong>{{reviewer_name}}</strong> just left a <strong>{{rating}}/5</strong> review at {{organization_name}}.</p><blockquote>{{comment_excerpt}}</blockquote><p>You can post one public reply from your FadeUp workspace.</p><p>FadeUp</p>'),
  ('review_reply', 'fr', 'transactional',
   'Réponse à votre avis chez {{organization_name}}',
   'Bonjour,' || chr(10) || chr(10) ||
   '{{professional_name}} a répondu à votre avis {{rating}}/5 :' || chr(10) || chr(10) ||
   '{{reply_excerpt}}' || chr(10) || chr(10) ||
   'FadeUp',
   '<p>Bonjour,</p><p><strong>{{professional_name}}</strong> a répondu à votre avis {{rating}}/5 :</p><blockquote>{{reply_excerpt}}</blockquote><p>FadeUp</p>'),
  ('review_reply', 'en', 'transactional',
   'A reply to your review at {{organization_name}}',
   'Hello,' || chr(10) || chr(10) ||
   '{{professional_name}} replied to your {{rating}}/5 review:' || chr(10) || chr(10) ||
   '{{reply_excerpt}}' || chr(10) || chr(10) ||
   'FadeUp',
   '<p>Hello,</p><p><strong>{{professional_name}}</strong> replied to your {{rating}}/5 review:</p><blockquote>{{reply_excerpt}}</blockquote><p>FadeUp</p>')
on conflict (template_key, locale) do nothing;

commit;
