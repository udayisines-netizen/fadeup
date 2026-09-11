-- FadeUp — PLAT-2 (2/4) : l'écran modération.
--
-- À APPLIQUER EN postgres. Propriétaires vérifiés avant écriture :
-- `moderate_review`, `moderate_post`, `posts`, `reviews`, `review_reports`,
-- `professional_applications`, `professional_claims` appartiennent tous à
-- `postgres`.
--
-- `create or replace` et JAMAIS `drop` + `create` sur les deux fonctions
-- existantes : une signature inchangée conserve son ACL. Un DROP obligerait à
-- re-matérialiser les concessions, et c'est ainsi qu'on perd un droit sans
-- s'en apercevoir (le piège de P1PRO, rappelé par PLAT-1 §7).
--
-- CE QUE CE FICHIER CHANGE, ET POURQUOI
--
--   1. `posts` n'avait AUCUNE colonne de modération. Vérifié avant de créer :
--      B4 a posé `visibility = 'hidden'`, pas `hidden_at`/`hidden_by`. Un post
--      masqué était donc indiscernable d'un post que son auteur a lui-même
--      rendu privé. Trois colonnes le réparent.
--   2. MASQUER EXIGE UN MOTIF. Les deux RPC l'acceptaient facultatif ; elles
--      l'exigent désormais, pris dans un vocabulaire fermé — celui de
--      `reviews_moderation_reason_valid`. « La note est mauvaise » n'y est
--      pas, et c'est le point de la spec.
--   3. ANNULER EST UN GESTE D'ADMINISTRATEUR. Le modérateur masque ; il ne
--      défait pas. Nouveau droit `moderation.revert`, fondateur et admin
--      seulement. La garde est STRICTEMENT PLUS STRICTE qu'avant sur la
--      remise en ligne, et inchangée sur le masquage.
--   4. Aucune policy n'est élargie. Un modérateur ne voit toujours ni un avis
--      retiré ni un post masqué PAR LA TABLE ; il les voit par des RPC
--      SECURITY DEFINER gardées, dont le périmètre est écrit ici, en un seul
--      endroit, au lieu d'être la somme de plusieurs policies.
--
-- LA LEÇON DE PLAT-1 §12.7, APPLIQUÉE : changer la garde d'une RPC ne suffit
-- pas, il faut suivre ce qu'elle APPELLE. `moderate_review` et `moderate_post`
-- n'appellent aucun SECURITY DEFINER gardé — seulement des déclencheurs de la
-- table (`reviews_guard_immutable`, `set_updated_at`), qui ne reposent aucune
-- question d'autorisation. Vérifié sur `pg_proc.prosrc`.

begin;

-- ---------------------------------------------------------------------------
-- 1. Le droit d'annuler
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('moderation.revert', 'Annuler une décision de modération : remettre en ligne un avis retiré ou un post masqué.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key) values
  ('platform_owner', 'moderation.revert'),
  ('platform_admin', 'moderation.revert')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. La trace de modération sur les posts
-- ---------------------------------------------------------------------------

alter table public.posts
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users (id) on delete set null,
  add column if not exists hidden_reason text;

-- La contrainte ne dit PAS « visibility = hidden implique un tampon » : un
-- auteur a le droit de masquer son propre post, et ce n'est pas une décision
-- de modération. Elle dit qu'un tampon est COMPLET ou ABSENT — jamais un
-- masquage anonyme ou sans motif.
alter table public.posts
  drop constraint if exists posts_moderation_stamp_complete;
alter table public.posts
  add constraint posts_moderation_stamp_complete check (
    (hidden_at is null and hidden_by is null and hidden_reason is null)
    or (hidden_at is not null and hidden_reason is not null)
  );

alter table public.posts
  drop constraint if exists posts_hidden_reason_valid;
alter table public.posts
  add constraint posts_hidden_reason_valid check (
    hidden_reason is null
    or hidden_reason = any (array['fraud', 'abusive_content', 'personal_data', 'hate_speech', 'conflict_of_interest'])
  );

create index if not exists posts_moderated_idx on public.posts (hidden_at desc) where hidden_at is not null;

comment on column public.posts.hidden_reason is
  'PLAT-2 : le motif de modération, pris dans le MÊME vocabulaire fermé que reviews.moderation_reason. « La note est mauvaise » n''y est pas représentable.';

-- ---------------------------------------------------------------------------
-- 3. Les deux RPC de modération, durcies
-- ---------------------------------------------------------------------------

create or replace function public.moderate_review(p_review_id uuid, p_status text, p_reason text default null)
returns public.reviews
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_review public.reviews;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Le cas nul EXPLICITEMENT, même si platform_can rend un booléen strict.
  if v_actor is null or not (select private.platform_can('moderation.content')) then
    raise exception 'platform moderation only'
      using errcode = '42501', detail = 'fadeup_moderation_refusal=not_authorized';
  end if;
  if p_status not in ('published', 'under_review', 'removed') then
    raise exception 'invalid moderation status'
      using errcode = '22023', detail = 'fadeup_moderation_refusal=invalid_status';
  end if;

  -- ANNULER EST UN GESTE D'ADMINISTRATEUR. Le modérateur masque, il ne défait
  -- pas : sinon « réversible par un admin » ne veut rien dire de plus que
  -- « réversible ». Décision de ce lot, déclarée dans le rapport.
  if p_status = 'published' and not (select private.platform_can('moderation.revert')) then
    raise exception 'seul un administrateur annule une décision de modération'
      using errcode = '42501', detail = 'fadeup_moderation_refusal=revert_requires_admin';
  end if;

  -- UN MOTIF EST OBLIGATOIRE, et pris dans le vocabulaire fermé de la
  -- contrainte reviews_moderation_reason_valid. La contrainte l'aurait dit
  -- aussi, mais avec un message de violation de contrainte ; ici c'est un
  -- refus nommé, que l'interface peut traduire.
  if p_status <> 'published' then
    if v_reason is null then
      raise exception 'un masquage a besoin de son motif'
        using errcode = '22023', detail = 'fadeup_moderation_refusal=reason_required';
    end if;
    if v_reason not in ('fraud', 'abusive_content', 'personal_data', 'hate_speech', 'conflict_of_interest') then
      raise exception 'motif de modération hors vocabulaire'
        using errcode = '22023', detail = 'fadeup_moderation_refusal=reason_not_allowed';
    end if;
  end if;

  update public.reviews
     set status = p_status,
         moderation_reason = case when p_status = 'published' then null else v_reason end,
         moderated_at = case when p_status = 'published' then null else now() end,
         moderated_by = case when p_status = 'published' then null else v_actor end
   where id = p_review_id
  returning * into v_review;
  if not found then
    raise exception 'review not found' using errcode = '42704';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'review_moderated', 'reviews', v_review.id,
          jsonb_build_object('status', p_status, 'reason', v_reason,
                             'reverted', p_status = 'published'));

  return v_review;
end;
$function$;

create or replace function public.moderate_post(p_post_id uuid, p_visibility text, p_reason text default null)
returns public.posts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_post public.posts;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not (select private.platform_can('moderation.content')) then
    raise exception 'modération de contenu non autorisée'
      using errcode = '42501', detail = 'fadeup_platform_refusal=moderation_required';
  end if;

  if p_visibility not in ('public', 'followers', 'hidden') then
    raise exception 'visibilité invalide'
      using errcode = '22023', detail = 'fadeup_moderation_refusal=invalid_status';
  end if;

  if p_visibility <> 'hidden' and not (select private.platform_can('moderation.revert')) then
    raise exception 'seul un administrateur annule une décision de modération'
      using errcode = '42501', detail = 'fadeup_moderation_refusal=revert_requires_admin';
  end if;

  if p_visibility = 'hidden' then
    if v_reason is null then
      raise exception 'un masquage a besoin de son motif'
        using errcode = '22023', detail = 'fadeup_moderation_refusal=reason_required';
    end if;
    if v_reason not in ('fraud', 'abusive_content', 'personal_data', 'hate_speech', 'conflict_of_interest') then
      raise exception 'motif de modération hors vocabulaire'
        using errcode = '22023', detail = 'fadeup_moderation_refusal=reason_not_allowed';
    end if;
  end if;

  update public.posts
     set visibility = p_visibility,
         hidden_at = case when p_visibility = 'hidden' then now() else null end,
         hidden_by = case when p_visibility = 'hidden' then v_actor else null end,
         hidden_reason = case when p_visibility = 'hidden' then v_reason else null end,
         updated_at = now()
   where id = p_post_id
  returning * into v_post;

  if not found then
    raise exception 'post introuvable' using errcode = '42704';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'post_moderated', 'posts', v_post.id,
          jsonb_build_object('visibility', p_visibility, 'reason', v_reason,
                             'reverted', p_visibility <> 'hidden'));

  return v_post;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Les files de modération, en lecture
-- ---------------------------------------------------------------------------

create or replace function public.list_moderation_reviews(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  rating smallint,
  comment text,
  reviewer_display_name text,
  status text,
  moderation_reason text,
  moderated_at timestamptz,
  moderated_by_email text,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  organization_id uuid,
  organization_name text,
  open_report_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    r.id, r.rating, r.comment, r.reviewer_display_name,
    r.status, r.moderation_reason, r.moderated_at,
    (select u.email::text from auth.users u where u.id = r.moderated_by),
    r.professional_id, pr.display_name, pr.handle,
    r.organization_id, o.name,
    (select count(*)::integer from public.review_reports rr
      where rr.review_id = r.id and rr.status = 'open'),
    r.created_at
  from public.reviews r
  join public.professionals pr on pr.id = r.professional_id
  join public.organizations o on o.id = r.organization_id
  where (select private.platform_can('moderation.content'))
    and (p_status is null or r.status = p_status)
  -- Ce qui est signalé d'abord : une file de modération triée par date fait
  -- lire ce qui va bien avant ce qui va mal.
  order by
    (select count(*) from public.review_reports rr where rr.review_id = r.id and rr.status = 'open') desc,
    r.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

create or replace function public.list_moderation_posts(
  p_visibility text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  author_kind text,
  author_label text,
  author_handle text,
  caption text,
  visibility text,
  hidden_at timestamptz,
  hidden_by_email text,
  hidden_reason text,
  media_count integer,
  like_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    p.id, p.author_kind,
    coalesce(pr.display_name, o.name),
    coalesce(pr.handle, o.slug),
    p.caption, p.visibility,
    p.hidden_at,
    (select u.email::text from auth.users u where u.id = p.hidden_by),
    p.hidden_reason,
    (select count(*)::integer from public.post_media pm where pm.post_id = p.id),
    p.like_count, p.created_at
  from public.posts p
  left join public.professionals pr on pr.id = p.professional_id
  left join public.organizations o on o.id = p.organization_id
  where (select private.platform_can('moderation.content'))
    and (p_visibility is null or p.visibility = p_visibility)
  order by p.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

create or replace function public.list_moderation_review_reports(
  p_include_resolved boolean default false,
  p_limit integer default 100
)
returns table (
  id uuid,
  review_id uuid,
  reason text,
  detail text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz,
  resolved_by_email text,
  review_rating smallint,
  review_comment text,
  review_status text,
  professional_display_name text,
  organization_name text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    rr.id, rr.review_id, rr.reason, rr.detail, rr.status, rr.created_at,
    rr.resolved_at,
    (select u.email::text from auth.users u where u.id = rr.resolved_by),
    r.rating, r.comment, r.status,
    pr.display_name, o.name
  from public.review_reports rr
  join public.reviews r on r.id = rr.review_id
  join public.professionals pr on pr.id = r.professional_id
  join public.organizations o on o.id = r.organization_id
  where (select private.platform_can('moderation.content'))
    and (p_include_resolved or rr.status = 'open')
  order by (rr.status = 'open') desc, rr.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

-- ---------------------------------------------------------------------------
-- 5. Onboardings et revendications : les deux files que PERSONNE ne voyait
-- ---------------------------------------------------------------------------
--
-- LE DÉFAUT QUE CE LOT RÉPARE. `onboarding.review` est porté par le
-- fondateur, l'admin, LE COMMERCIAL et LE MODÉRATEUR — mais
-- `professional_applications_select` et `professional_claims_select` exigent
-- `is_platform_admin()`. Autrement dit : depuis PLAT-1, un modérateur et un
-- commercial pouvaient VALIDER une candidature qu'ils ne pouvaient pas LIRE.
-- Une garde d'entrée qui dit oui sur une file invisible est le même défaut
-- que PLAT-1 §12.7, dans l'autre sens.
--
-- Réparé par deux RPC gardées, PAS en élargissant les policies : la lecture
-- reste bornée aux colonnes nécessaires à la décision.

create or replace function public.list_professional_applications_queue(
  p_status public.professional_application_status default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  status public.professional_application_status,
  first_name text,
  last_name text,
  email text,
  phone text,
  business_name text,
  professional_type public.professional_type,
  city text,
  postal_code text,
  country text,
  staff_count integer,
  website text,
  instagram text,
  business_identifier text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_email text,
  rejection_reason text,
  internal_note text,
  organization_id uuid
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    a.id, a.status, a.first_name, a.last_name, a.email, a.phone,
    a.business_name, a.professional_type, a.city, a.postal_code, a.country,
    a.staff_count, a.website, a.instagram, a.business_identifier,
    a.submitted_at, a.reviewed_at,
    (select u.email::text from auth.users u where u.id = a.reviewed_by),
    a.rejection_reason, a.internal_note, a.organization_id
  from public.professional_applications a
  where (select private.platform_can('onboarding.review'))
    and (p_status is null or a.status = p_status)
  order by (a.status = 'pending_review') desc, a.submitted_at
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

-- L'ARBITRAGE DE REVENDICATIONS CONCURRENTES ne demande pas de RPC de plus :
-- `review_professional_claim` verrouille l'IDENTITÉ et ferme les autres
-- demandes en attente quand elle en approuve une (lu et vérifié avant
-- d'écrire). Ce qui manquait était de VOIR le conflit : `competing_pending`
-- compte les autres demandes vivantes sur le même profil, et l'écran refuse
-- de traiter une revendication contestée sans montrer sa rivale.
create or replace function public.list_professional_claims_queue(
  p_include_decided boolean default false,
  p_limit integer default 100
)
returns table (
  id uuid,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  professional_claim_state public.professional_claim_state,
  claimant_user_id uuid,
  claimant_email text,
  state public.professional_claim_status,
  evidence text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by_email text,
  decision_note text,
  competing_pending integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    c.id, c.professional_id, pr.display_name, pr.handle, pr.claim_state,
    c.claimant_user_id,
    (select u.email::text from auth.users u where u.id = c.claimant_user_id),
    c.state, c.evidence, c.submitted_at, c.decided_at,
    (select u.email::text from auth.users u where u.id = c.decided_by),
    c.decision_note,
    (select count(*)::integer from public.professional_claims c2
      where c2.professional_id = c.professional_id
        and c2.state = 'pending'
        and c2.id <> c.id)
  from public.professional_claims c
  join public.professionals pr on pr.id = c.professional_id
  where (select private.platform_can('onboarding.review'))
    and (p_include_decided or c.state = 'pending')
  -- Les revendications CONTESTÉES en tête : c'est là qu'un humain doit
  -- trancher, et c'est ce qu'une file triée par date enterre.
  order by
    (select count(*) from public.professional_claims c2
      where c2.professional_id = c.professional_id and c2.state = 'pending') desc,
    c.submitted_at
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

-- ---------------------------------------------------------------------------
-- 6. Les concessions, EXPLICITES
-- ---------------------------------------------------------------------------
-- Les deux fonctions REDÉFINIES conservent leur ACL (create or replace).
-- Les cinq fonctions NEUVES la reçoivent ici : le défaut est durci depuis X3,
-- une fonction neuve de `public` ne naît plus exécutable.

revoke all on function public.list_moderation_reviews(text, integer) from public, anon;
grant execute on function public.list_moderation_reviews(text, integer) to authenticated;

revoke all on function public.list_moderation_posts(text, integer) from public, anon;
grant execute on function public.list_moderation_posts(text, integer) to authenticated;

revoke all on function public.list_moderation_review_reports(boolean, integer) from public, anon;
grant execute on function public.list_moderation_review_reports(boolean, integer) to authenticated;

revoke all on function public.list_professional_applications_queue(public.professional_application_status, integer) from public, anon;
grant execute on function public.list_professional_applications_queue(public.professional_application_status, integer) to authenticated;

revoke all on function public.list_professional_claims_queue(boolean, integer) from public, anon;
grant execute on function public.list_professional_claims_queue(boolean, integer) to authenticated;

commit;
