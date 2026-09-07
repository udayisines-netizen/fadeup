-- FadeUp — B4 chantier 4 (1/2) : RPC de lecture.
--
-- Toutes STABLE, security definer, search_path vide, droits d'exécution
-- explicites pour anon et authenticated. AUCUNE n'écrit — pas d'ensure_*,
-- pas d'insertion paresseuse : c'est le piège du 405 trouvé par B1 (une
-- fonction STABLE qui écrit est refusée dans la transaction lecture seule de
-- PostgREST). probe_public_rpcs.sh le re-vérifie en anon via HTTP.
--
-- LE FEED. get_feed pagine par CURSEUR TEMPOREL, jamais par offset. Une page
-- est une TRANCHE DE TEMPS contiguë : les p_limit posts visibles les plus
-- récents avant le curseur, sélectionnés par created_at, puis CLASSÉS par
-- score à l'intérieur de la page. C'est ce qui rend le curseur exact — aucun
-- post sauté, aucun doublon entre pages — tout en gardant un classement
-- algorithmique là où il compte, l'ordre de présentation. Un classement
-- global par score interdirait le curseur temporel demandé.
--
-- DÉDUPLICATION : structurelle. La requête sélectionne des POSTS, pas des
-- arêtes de suivi — un client qui suit un professionnel ET son salon produit
-- une seule ligne par post, parce qu'un post n'est qu'une ligne. feed_source
-- dit la meilleure raison de présence (professionnel suivi > salon suivi >
-- découverte).
--
-- LES POIDS VIVENT DANS public.feed_ranking_weights — pas dans le corps de
-- la fonction. Les valeurs semées sont des points de départ ASSUMÉS COMME
-- PROVISOIRES : la formule du score FadeUp est une décision fondateur en
-- attente (MASTER_SPEC §23.3) ; l'architecture est modulaire pour que la
-- décision soit un UPDATE, pas une migration. Les cinq signaux sont ceux de
-- MASTER_SPEC §11 : relation, proximité, fraîcheur, engagement, capacité à
-- être réservé.
--
-- Idempotent : sûr à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- Les poids du classement
-- ---------------------------------------------------------------------------

create table if not exists public.feed_ranking_weights (
  signal      text primary key,
  weight      numeric not null,
  description text,
  updated_at  timestamptz not null default now(),
  constraint feed_ranking_weights_signal_valid check (
    signal in ('relationship','proximity','freshness','engagement','bookability')
  ),
  constraint feed_ranking_weights_weight_sane check (weight >= 0 and weight <= 100)
);

comment on table public.feed_ranking_weights is
  'Poids des signaux de get_feed. La formule définitive du score FadeUp est une décision fondateur en attente (MASTER_SPEC §23.3) : ces lignes sont le point de réglage — la changer est un UPDATE, pas une migration. Aucun client n''y accède ; seule get_feed la lit.';

alter table public.feed_ranking_weights enable row level security;
alter table public.feed_ranking_weights force row level security;

revoke all on table public.feed_ranking_weights from anon, authenticated;

insert into public.feed_ranking_weights (signal, weight, description) values
  ('relationship', 3.0, 'Le lecteur suit l''auteur (professionnel ou salon).'),
  ('proximity',    1.5, 'Distance au point fourni par le client, décroissante.'),
  ('freshness',    2.0, 'Décroissance linéaire sur 7 jours.'),
  ('engagement',   1.0, 'like_count, saturé à 50.'),
  ('bookability',  1.5, 'Le post est lié à au moins un service réservable.')
on conflict (signal) do nothing;

-- ---------------------------------------------------------------------------
-- get_feed
-- ---------------------------------------------------------------------------

create or replace function public.get_feed(
  p_cursor    timestamptz default null,
  p_limit     integer default 20,
  p_latitude  double precision default null,
  p_longitude double precision default null
)
returns table (
  post_id uuid,
  author_kind text,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  professional_avatar_url text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  posted_at_organization_id uuid,
  posted_at_organization_name text,
  posted_at_organization_slug text,
  caption text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  media jsonb,
  services jsonb,
  feed_source text,
  score numeric
)
language sql stable security definer
set search_path to ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  w as (
    select
      coalesce((select fw.weight from public.feed_ranking_weights fw where fw.signal = 'relationship'), 0) as rel,
      coalesce((select fw.weight from public.feed_ranking_weights fw where fw.signal = 'proximity'),    0) as prox,
      coalesce((select fw.weight from public.feed_ranking_weights fw where fw.signal = 'freshness'),    0) as fresh,
      coalesce((select fw.weight from public.feed_ranking_weights fw where fw.signal = 'engagement'),   0) as eng,
      coalesce((select fw.weight from public.feed_ranking_weights fw where fw.signal = 'bookability'),  0) as book
  ),
  -- LA TRANCHE : les N posts visibles les plus récents avant le curseur.
  -- La visibilité de l'auteur est exigée aussi : un post public d'un profil
  -- retiré du public ne fuit pas par le feed.
  slice as (
    select p.*
    from public.posts p
    where p.created_at < coalesce(p_cursor, 'infinity'::timestamptz)
      and (
        (p.author_kind = 'professional'
         and exists (select 1 from public.professionals pr
                     where pr.id = p.professional_id and pr.is_public))
        or
        (p.author_kind = 'organization'
         and (exists (select 1 from public.organizations o
                      where o.id = p.organization_id and o.marketplace_visible)
              or exists (select 1 from public.organization_follows f, me
                         where f.organization_id = p.organization_id
                           and f.follower_user_id = me.uid and f.is_following)))
      )
      and (
        p.visibility = 'public'
        or (p.visibility = 'followers' and (
          (p.author_kind = 'professional' and exists (
            select 1 from public.professional_follows f, me
            where f.professional_id = p.professional_id
              and f.follower_user_id = me.uid and f.state = 'following'))
          or (p.author_kind = 'organization' and exists (
            select 1 from public.organization_follows f, me
            where f.organization_id = p.organization_id
              and f.follower_user_id = me.uid and f.is_following))
        ))
      )
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ),
  -- LES SIGNAUX, calculés une fois par post de la tranche.
  scored as (
    select
      s.*,
      case
        when s.author_kind = 'professional' and exists (
          select 1 from public.professional_follows f, me
          where f.professional_id = s.professional_id
            and f.follower_user_id = me.uid and f.state = 'following')
        then 'followed_professional'
        when exists (
          select 1 from public.organization_follows f, me
          where f.organization_id = coalesce(s.organization_id, s.posted_at_organization_id)
            and f.follower_user_id = me.uid and f.is_following)
        then 'followed_organization'
        else 'discovery'
      end as rel_source,
      greatest(0.0, 1.0 - extract(epoch from (now() - s.created_at)) / 604800.0) as sig_fresh,
      least(s.like_count, 50) / 50.0 as sig_eng,
      case when exists (select 1 from public.post_services ps where ps.post_id = s.id)
           then 1.0 else 0.0 end as sig_book,
      case
        when p_latitude is null or p_longitude is null then 0.0
        else coalesce((
          select max(1.0 / (1.0 + extensions.earth_distance(
                   extensions.ll_to_earth(p_latitude, p_longitude),
                   extensions.ll_to_earth(l.latitude, l.longitude)) / 10000.0))
          from public.locations l
          where l.organization_id = coalesce(s.organization_id, s.posted_at_organization_id)
            and l.latitude is not null and l.longitude is not null
        ), 0.0)
      end as sig_prox
    from slice s
  )
  select
    sc.id,
    sc.author_kind,
    sc.professional_id,
    pr.display_name,
    pr.handle,
    pr.avatar_url,
    sc.organization_id,
    ao.name,
    ao.slug,
    sc.posted_at_organization_id,
    po.name,
    po.slug,
    sc.caption,
    sc.created_at,
    sc.like_count,
    exists (select 1 from public.post_likes pl, me
            where pl.post_id = sc.id and pl.user_id = me.uid),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'storage_path', m.storage_path, 'media_type', m.media_type,
               'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms,
               'position', m.position)
             order by m.position, m.created_at)
      from public.post_media m where m.post_id = sc.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'price_cents', sv.price_cents,
               'duration_minutes', sv.duration_minutes, 'is_active', sv.is_active))
      from public.post_services ps
      join public.services sv on sv.id = ps.service_id
      where ps.post_id = sc.id
    ), '[]'::jsonb),
    sc.rel_source,
    round((
        (select rel   from w) * case when sc.rel_source <> 'discovery' then 1.0 else 0.0 end
      + (select prox  from w) * sc.sig_prox
      + (select fresh from w) * sc.sig_fresh
      + (select eng   from w) * sc.sig_eng
      + (select book  from w) * sc.sig_book
    )::numeric, 4)
  from scored sc
  left join public.professionals pr on pr.id = sc.professional_id
  left join public.organizations ao on ao.id = sc.organization_id
  left join public.organizations po on po.id = sc.posted_at_organization_id
  order by 20 desc, sc.created_at desc, sc.id desc;
$$;

comment on function public.get_feed(timestamptz, integer, double precision, double precision) is
  'Feed social : abonnements et découverte locale entremêlés. Une page est une tranche de temps (curseur temporel exact, jamais d''offset), classée par score à l''intérieur. Un post n''apparaît qu''une fois même quand le lecteur suit le professionnel ET son salon — la sélection porte sur les posts, pas sur les arêtes de suivi. Les poids vivent dans feed_ranking_weights. Le curseur de la page suivante est le plus petit created_at retourné. p_latitude/p_longitude sont optionnels et n''alimentent que le signal de proximité. Anonyme : découverte publique seule. Ne fabrique rien : un feed vide est un feed vide.';

revoke execute on function public.get_feed(timestamptz, integer, double precision, double precision) from public;
grant execute on function public.get_feed(timestamptz, integer, double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Portfolio d'un profil professionnel — par handle (l'adresse publique) et
-- par id (les identités antérieures à R6/R7 n'ont pas de handle : sans la
-- variante par id, leur portfolio serait structurellement inaccessible).
-- Un post de professionnel rattaché apparaît ICI et sur le profil du salon.
-- ---------------------------------------------------------------------------

create or replace function private.professional_posts_page(
  p_professional_id uuid,
  p_cursor timestamptz,
  p_limit integer
)
returns table (
  post_id uuid,
  caption text,
  visibility text,
  posted_at_organization_id uuid,
  posted_at_organization_name text,
  posted_at_organization_slug text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  media jsonb,
  services jsonb
)
language sql stable security definer
set search_path to ''
as $$
  select
    p.id,
    p.caption,
    p.visibility,
    p.posted_at_organization_id,
    po.name,
    po.slug,
    p.created_at,
    p.like_count,
    exists (select 1 from public.post_likes pl
            where pl.post_id = p.id and pl.user_id = (select auth.uid())),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'storage_path', m.storage_path, 'media_type', m.media_type,
               'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms,
               'position', m.position)
             order by m.position, m.created_at)
      from public.post_media m where m.post_id = p.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'price_cents', sv.price_cents,
               'duration_minutes', sv.duration_minutes, 'is_active', sv.is_active))
      from public.post_services ps
      join public.services sv on sv.id = ps.service_id
      where ps.post_id = p.id
    ), '[]'::jsonb)
  from public.posts p
  left join public.organizations po on po.id = p.posted_at_organization_id
  where p.professional_id = p_professional_id
    and p.created_at < coalesce(p_cursor, 'infinity'::timestamptz)
    and private.can_view_post(p.id)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

create or replace function public.get_professional_posts(
  p_handle text,
  p_cursor timestamptz default null,
  p_limit integer default 30
)
returns table (
  post_id uuid,
  caption text,
  visibility text,
  posted_at_organization_id uuid,
  posted_at_organization_name text,
  posted_at_organization_slug text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  media jsonb,
  services jsonb
)
language sql stable security definer
set search_path to ''
as $$
  select pp.*
  from public.professionals pr
  cross join lateral private.professional_posts_page(pr.id, p_cursor, p_limit) pp
  where pr.handle = p_handle
    and pr.is_public;
$$;

comment on function public.get_professional_posts(text, timestamptz, integer) is
  'Portfolio public d''un professionnel par handle. Première tranche de 30 (MASTER_SPEC §9), curseur temporel. Posts followers inclus pour un abonné, posts hidden pour le seul auteur — via can_view_post. Profil non public : zéro ligne.';

revoke execute on function public.get_professional_posts(text, timestamptz, integer) from public;
grant execute on function public.get_professional_posts(text, timestamptz, integer) to anon, authenticated;

create or replace function public.get_professional_posts_by_id(
  p_professional_id uuid,
  p_cursor timestamptz default null,
  p_limit integer default 30
)
returns table (
  post_id uuid,
  caption text,
  visibility text,
  posted_at_organization_id uuid,
  posted_at_organization_name text,
  posted_at_organization_slug text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  media jsonb,
  services jsonb
)
language sql stable security definer
set search_path to ''
as $$
  select pp.*
  from public.professionals pr
  cross join lateral private.professional_posts_page(pr.id, p_cursor, p_limit) pp
  where pr.id = p_professional_id
    and pr.is_public;
$$;

comment on function public.get_professional_posts_by_id(uuid, timestamptz, integer) is
  'Même contrat que get_professional_posts, par id — parce que handle est nullable (non rétro-rempli, décision R2) et qu''un portfolio ne doit pas dépendre d''un handle qui n''existe pas encore. Miroir du couple get_public_professional / _by_handle.';

revoke execute on function public.get_professional_posts_by_id(uuid, timestamptz, integer) from public;
grant execute on function public.get_professional_posts_by_id(uuid, timestamptz, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Réalisations d'un salon : ses propres posts ET les posts des
-- professionnels faits chez lui (rattachement figé) — y compris ceux d'un
-- professionnel parti depuis, décision produit actée.
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_posts(
  p_slug text,
  p_cursor timestamptz default null,
  p_limit integer default 30
)
returns table (
  post_id uuid,
  author_kind text,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  professional_avatar_url text,
  caption text,
  visibility text,
  created_at timestamptz,
  like_count integer,
  liked_by_me boolean,
  media jsonb,
  services jsonb
)
language sql stable security definer
set search_path to ''
as $$
  select
    p.id,
    p.author_kind,
    p.professional_id,
    pr.display_name,
    pr.handle,
    pr.avatar_url,
    p.caption,
    p.visibility,
    p.created_at,
    p.like_count,
    exists (select 1 from public.post_likes pl
            where pl.post_id = p.id and pl.user_id = (select auth.uid())),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'storage_path', m.storage_path, 'media_type', m.media_type,
               'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms,
               'position', m.position)
             order by m.position, m.created_at)
      from public.post_media m where m.post_id = p.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'price_cents', sv.price_cents,
               'duration_minutes', sv.duration_minutes, 'is_active', sv.is_active))
      from public.post_services ps
      join public.services sv on sv.id = ps.service_id
      where ps.post_id = p.id
    ), '[]'::jsonb)
  from public.organizations o
  join public.posts p
    on (p.organization_id = o.id or p.posted_at_organization_id = o.id)
  left join public.professionals pr on pr.id = p.professional_id
  where o.slug = p_slug
    and p.created_at < coalesce(p_cursor, 'infinity'::timestamptz)
    and (p.author_kind = 'organization'
         or (pr.id is not null and pr.is_public))
    and private.can_view_post(p.id)
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;

comment on function public.get_organization_posts(text, timestamptz, integer) is
  'Réalisations du profil salon : posts de l''organisation ET posts des professionnels rattachés au moment de leur publication (posted_at_organization_id, figé). Un post apparaît donc sur les deux profils, et le départ du professionnel ne vide pas la galerie du salon. Un post par ligne : jointure sur OR, jamais d''union dupliquante.';

revoke execute on function public.get_organization_posts(text, timestamptz, integer) from public;
grant execute on function public.get_organization_posts(text, timestamptz, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Avis publics et réputation
-- ---------------------------------------------------------------------------

create or replace function public.get_public_reviews(
  p_professional_id uuid default null,
  p_organization_id uuid default null,
  p_cursor timestamptz default null,
  p_limit integer default 20
)
returns table (
  review_id uuid,
  rating smallint,
  comment text,
  reviewer_display_name text,
  created_at timestamptz,
  reply_body text,
  replied_at timestamptz,
  photo_storage_path text,
  professional_id uuid,
  organization_id uuid
)
language plpgsql stable security definer
set search_path to ''
as $$
begin
  if (p_professional_id is null) = (p_organization_id is null) then
    raise exception 'get_public_reviews expects exactly one of p_professional_id, p_organization_id';
  end if;

  return query
  select
    r.id,
    r.rating,
    r.comment,
    r.reviewer_display_name,
    r.created_at,
    r.reply_body,
    r.replied_at,
    rp.storage_path,
    r.professional_id,
    r.organization_id
  from public.reviews r
  left join public.review_photos rp on rp.review_id = r.id
  where r.status = 'published'
    and (p_professional_id is null or r.professional_id = p_professional_id)
    and (p_organization_id is null or r.organization_id = p_organization_id)
    and r.created_at < coalesce(p_cursor, 'infinity'::timestamptz)
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.get_public_reviews(uuid, uuid, timestamptz, integer) is
  'Avis publiés d''un professionnel OU d''une organisation, paginés au curseur temporel. Le nom du client est la forme réduite gravée à l''écriture — cette fonction ne joint jamais customer_profiles. La photo n''apparaît que si elle existe (consentement de publication exigé par contrainte à l''écriture).';

revoke execute on function public.get_public_reviews(uuid, uuid, timestamptz, integer) from public;
grant execute on function public.get_public_reviews(uuid, uuid, timestamptz, integer) to anon, authenticated;

create or replace function public.get_public_reputation(
  p_professional_id uuid default null,
  p_organization_id uuid default null
)
returns table (
  rating_average numeric,
  rating_count integer
)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if (p_professional_id is null) = (p_organization_id is null) then
    raise exception 'get_public_reputation expects exactly one of p_professional_id, p_organization_id';
  end if;

  if p_professional_id is not null then
    v_kind := 'professional'; v_id := p_professional_id;
  else
    v_kind := 'organization'; v_id := p_organization_id;
  end if;

  -- NULL et 0 ne veulent pas dire la même chose : une entité sans avis rend
  -- rating_average NULL (« Pas encore d''avis »), jamais zéro étoile.
  return query
  select
    case when coalesce(rr.rating_count, 0) > 0
         then round(rr.rating_sum::numeric / rr.rating_count, 2)
         else null::numeric end,
    coalesce(rr.rating_count, 0)
  from (select 1) as one
  left join public.review_reputation rr
    on rr.subject_kind = v_kind and rr.subject_id = v_id;
end;
$$;

comment on function public.get_public_reputation(uuid, uuid) is
  'Réputation agrégée, maintenue par trigger — jamais recalculée ici. rating_average est NULL tant qu''aucun avis publié n''existe : le composant Rating affiche « Pas encore d''avis », jamais zéro étoile. rating_count vaut alors 0, et c''est un vrai zéro, pas une invention.';

revoke execute on function public.get_public_reputation(uuid, uuid) from public;
grant execute on function public.get_public_reputation(uuid, uuid) to anon, authenticated;

commit;
