-- Retour arrière de 20260911200100_plat2_moderation.sql — À APPLIQUER EN postgres.
--
-- CE QU'IL DÉTRUIT : les trois colonnes de trace de modération sur `posts`,
-- donc QUI a masqué un post, QUAND et POURQUOI. Les posts masqués restent
-- masqués (`visibility` n'est pas touchée) mais redeviennent indiscernables
-- d'un masquage par l'auteur — l'état d'avant PLAT-2.
--
-- Les deux RPC reprennent LEUR CORPS D'AVANT, verbatim depuis la production du
-- 2026-09-11 : motif facultatif, aucune garde d'annulation. Le retour arrière
-- est donc STRICTEMENT MOINS STRICT que l'état après ce lot — c'est le sens
-- d'un retour arrière, et c'est écrit pour qu'on le sache avant de l'ordonner.

begin;

drop function if exists public.list_professional_claims_queue(boolean, integer);
drop function if exists public.list_professional_applications_queue(public.professional_application_status, integer);
drop function if exists public.list_moderation_review_reports(boolean, integer);
drop function if exists public.list_moderation_posts(text, integer);
drop function if exists public.list_moderation_reviews(text, integer);

create or replace function public.moderate_post(p_post_id uuid, p_visibility text, p_reason text default null)
returns public.posts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_post public.posts;
begin
  if v_actor is null or not (select private.platform_can('moderation.content')) then
    raise exception 'modération de contenu non autorisée'
      using errcode = '42501', detail = 'fadeup_platform_refusal=moderation_required';
  end if;

  if p_visibility not in ('public', 'followers', 'hidden') then
    raise exception 'visibilité invalide' using errcode = '22023';
  end if;

  update public.posts set visibility = p_visibility, updated_at = now()
  where id = p_post_id
  returning * into v_post;

  if not found then
    raise exception 'post introuvable' using errcode = '42704';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'post_moderated', 'posts', v_post.id,
          jsonb_build_object('visibility', p_visibility, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_post;
end;
$function$;

create or replace function public.moderate_review(p_review_id uuid, p_status text, p_reason text default null)
returns public.reviews
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_review public.reviews;
begin
  if (select auth.uid()) is null or not private.platform_can('moderation.content') then
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
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'review_moderated', 'reviews', v_review.id,
          jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_review;
end;
$function$;

drop index if exists public.posts_moderated_idx;
alter table public.posts drop constraint if exists posts_hidden_reason_valid;
alter table public.posts drop constraint if exists posts_moderation_stamp_complete;
alter table public.posts
  drop column if exists hidden_reason,
  drop column if exists hidden_by,
  drop column if exists hidden_at;

delete from public.platform_role_permissions where permission_key = 'moderation.revert';
delete from public.platform_permissions where key = 'moderation.revert';

commit;
