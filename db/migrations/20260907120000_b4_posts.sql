-- FadeUp — B4 chantier 1 : publications.
--
-- posts / post_media / post_services / post_likes. Rien d'autre — pas de
-- post_comments (décision produit MASTER_SPEC §11, verrouillée), pas de
-- hashtags, pas de publication client.
--
-- LE PRINCIPE QUI GOUVERNE CE MODULE : un post est réservable. post_services
-- relie une photo de coupe au service qui l'a produite, chez le professionnel
-- qui l'a faite. Sans ce lien, c'est du portfolio ; avec, conversion directe.
--
-- IDENTITÉ DE L'AUTEUR. Le modèle à trois couches de B1 est respecté et
-- AUCUNE table de rattachement supplémentaire n'est créée :
--   professionals  — identité publique portable (auteur possible)
--   organizations  — le salon (auteur possible pour sa galerie)
--   barbers        — le lien d'emploi COURANT, qui sert uniquement à valider
--                    posted_at_organization_id au moment de la publication.
--
-- RATTACHEMENT FIGÉ. posted_at_organization_id est l'organisation où le
-- travail a été fait, capturée à la publication et JAMAIS réécrite ensuite
-- (trigger posts_guard_immutable_author). Décision produit actée : quand un
-- professionnel quitte un salon, ses anciens posts restent sur le profil du
-- salon. Le rattachement courant vit dans barbers ; celui-ci est un fait
-- historique.
--
-- GARDES QUE CHECK NE PEUT PAS PORTER (elles interrogent une autre table) :
--   « au moins un média »  — trigger de contrainte DÉFÉRABLE, INITIALLY
--                            DEFERRED, sur posts : au commit, un post sans
--                            média est refusé. Différé pour que create_post
--                            puisse insérer le post puis ses médias dans la
--                            même transaction.
--   « dix médias maximum » — trigger immédiat sur post_media (le onzième
--                            INSERT échoue à l'instant même).
--   cohérence service/org  — check_post_services_consistency, sur le motif
--                            exact de check_barber_service_consistency.
-- Les mêmes gardes sont AUSSI portées par create_post : le trigger est la
-- vérité, la RPC est le message d'erreur propre.
--
-- like_count est maintenu PAR TRIGGER sur post_likes. Jamais écrit par un
-- client (aucun grant UPDATE ne couvre cette colonne — les updates clients
-- passent par une policy qui ne peut pas le protéger seule, donc un trigger
-- posts_guard_immutable_author gèle aussi like_count hors du chemin trigger).
-- Un compteur à zéro est un compteur à zéro : default 0, aucune valeur
-- fabriquée.
--
-- RLS ACTIVÉE ET FORCÉE sur les quatre tables. anon ne détient AUCUN grant —
-- la lecture publique passe par les RPC security definer du chantier 4
-- (convention du schéma : jamais d'exposition directe de table à anon).
-- authenticated reçoit exactement les verbes que ses policies gouvernent —
-- jamais TRUNCATE, TRIGGER ni REFERENCES (leçon B1/B2 : le grant par défaut
-- accordait TRUNCATE, qui n'est pas soumis à RLS).
--
-- Idempotent : sûr à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------

create table if not exists public.posts (
  id                        uuid primary key default gen_random_uuid(),
  author_kind               text not null,
  professional_id           uuid references public.professionals(id) on delete cascade,
  organization_id           uuid references public.organizations(id) on delete cascade,
  posted_at_organization_id uuid references public.organizations(id) on delete set null,
  caption                   text,
  visibility                text not null default 'public',
  like_count                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint posts_author_kind_valid check (author_kind in ('professional','organization')),
  constraint posts_visibility_valid check (visibility in ('public','followers','hidden')),
  constraint posts_caption_length check (caption is null or char_length(caption) <= 2200),
  constraint posts_like_count_nonnegative check (like_count >= 0),
  constraint posts_author_consistency check (
    (author_kind = 'professional' and professional_id is not null and organization_id is null)
    or (author_kind = 'organization' and organization_id is not null and professional_id is null)
  ),
  -- Le rattachement figé n'a de sens que pour un auteur professionnel : un
  -- post d'organisation EST déjà sur le profil de l'organisation, dupliquer
  -- l'ancre créerait deux chemins vers la même vérité.
  constraint posts_attachment_professional_only check (
    author_kind = 'professional' or posted_at_organization_id is null
  )
);

comment on table public.posts is
  'Publication d''un professionnel (identité portable) ou d''une organisation (galerie du lieu). Jamais d''un client — un client contribue une photo en tant qu''avis, avec consentement (review_photos). posted_at_organization_id est le salon où le travail a été fait, FIGÉ à la publication : un départ du salon ne retire pas les posts du profil du salon. like_count est maintenu par trigger depuis post_likes, jamais par un client.';

comment on column public.posts.posted_at_organization_id is
  'Rattachement au salon au moment de la publication, validé contre barbers à l''INSERT puis IMMUABLE (posts_guard_immutable_author). Distinct du rattachement courant qui vit dans barbers. on delete set null : la disparition du salon ne supprime pas le travail du professionnel.';

comment on column public.posts.visibility is
  'public = lisible de tous (y compris anon, via RPC) ; followers = réservé aux abonnés du profil auteur ; hidden = visible du seul auteur.';

alter table public.posts enable row level security;
alter table public.posts force row level security;

create index if not exists posts_professional_created_idx
  on public.posts (professional_id, created_at desc) where professional_id is not null;
create index if not exists posts_posted_at_org_created_idx
  on public.posts (posted_at_organization_id, created_at desc) where posted_at_organization_id is not null;
create index if not exists posts_organization_created_idx
  on public.posts (organization_id, created_at desc) where organization_id is not null;
-- Le feed lit « les posts publics récents » : l'index porte exactement ça.
create index if not exists posts_public_created_idx
  on public.posts (created_at desc) where visibility = 'public';

drop trigger if exists set_updated_at on public.posts;
create trigger set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- post_media
-- ---------------------------------------------------------------------------

create table if not exists public.post_media (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  media_type   text not null default 'image',
  width        integer,
  height       integer,
  duration_ms  integer,
  position     smallint not null default 0,
  created_at   timestamptz not null default now(),
  constraint post_media_type_valid check (media_type in ('image','video')),
  constraint post_media_storage_path_unique unique (storage_path),
  constraint post_media_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint post_media_dimensions_positive check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  -- Vidéo : durée obligatoire et 60 s maximum (MASTER_SPEC §11).
  -- Image : pas de durée du tout.
  constraint post_media_video_duration check (
    (media_type = 'video' and duration_ms is not null and duration_ms between 1 and 60000)
    or (media_type = 'image' and duration_ms is null)
  ),
  constraint post_media_position_nonnegative check (position >= 0)
);

comment on table public.post_media is
  'Médias d''une publication, 1 à 10 par post (triggers ci-dessous — un CHECK ne peut pas compter les lignes d''une autre table). storage_path pointe dans le bucket privé post-media, toujours sous {user_id}/… ; servi par URL signées uniquement.';

alter table public.post_media enable row level security;
alter table public.post_media force row level security;

create index if not exists post_media_post_position_idx
  on public.post_media (post_id, position);

-- ---------------------------------------------------------------------------
-- post_services — la raison d'être du module
-- ---------------------------------------------------------------------------

create table if not exists public.post_services (
  post_id    uuid not null references public.posts(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, service_id)
);

comment on table public.post_services is
  'Lien optionnel post → service réservable. Sans lien : portfolio. Avec lien : « réserver cette coupe ». Le service doit appartenir à l''organisation de rattachement du post (check_post_services_consistency) — jamais à une autre.';

alter table public.post_services enable row level security;
alter table public.post_services force row level security;

create index if not exists post_services_service_idx
  on public.post_services (service_id);

-- ---------------------------------------------------------------------------
-- post_likes
-- ---------------------------------------------------------------------------

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

comment on table public.post_likes is
  'Likes publics (MASTER_SPEC §11). Une ligne par (post, compte) ; like_count sur posts est l''agrégat maintenu par trigger. Écriture et retrait limités à auth.uid() — par policy ET par les RPC like_post/unlike_post.';

alter table public.post_likes enable row level security;
alter table public.post_likes force row level security;

create index if not exists post_likes_user_idx
  on public.post_likes (user_id);

-- ---------------------------------------------------------------------------
-- Helpers de visibilité et d'autorité — schéma private, security definer,
-- possédés par postgres (bypassrls), comme has_org_role / is_own_professional.
-- ---------------------------------------------------------------------------

create or replace function private.can_manage_post(p_post_id uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and (
        (p.author_kind = 'professional' and private.is_own_professional(p.professional_id))
        or (p.author_kind = 'organization'
            and private.has_org_role(p.organization_id, array['owner','manager']::public.membership_role[]))
      )
  );
$$;

comment on function private.can_manage_post(uuid) is
  'Autorité d''écriture sur un post : le professionnel auteur lui-même (résolu par auth.uid(), jamais par un id fourni), ou owner/manager de l''organisation autrice. Le propriétaire du salon ne gère PAS ici les posts des professionnels rattachés — question de galerie laissée à P4, retirer le travail d''autrui est une décision produit non tranchée.';

create or replace function private.can_view_post(p_post_id uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and (
        p.visibility = 'public'
        or private.can_manage_post(p.id)
        or (
          p.visibility = 'followers'
          and (
            (p.author_kind = 'professional' and exists (
              select 1 from public.professional_follows f
              where f.professional_id = p.professional_id
                and f.follower_user_id = (select auth.uid())
                and f.state = 'following'
            ))
            or (p.author_kind = 'organization' and exists (
              select 1 from public.organization_follows f
              where f.organization_id = p.organization_id
                and f.follower_user_id = (select auth.uid())
                and f.is_following
            ))
          )
        )
      )
  );
$$;

comment on function private.can_view_post(uuid) is
  'Visibilité d''un post pour l''appelant courant : public pour tous, followers pour un abonné au state following du profil auteur (professional_follows ou organization_follows selon author_kind), hidden pour le seul auteur. Utilisée par les policies de post_media, post_services et post_likes pour hériter de la visibilité du post.';

-- ---------------------------------------------------------------------------
-- Gardes trigger
-- ---------------------------------------------------------------------------

-- 1. Auteur validé à l'INSERT : un professionnel ne publie que sous sa propre
--    identité ; une organisation, que par owner/manager ; le rattachement
--    figé doit être un salon où le professionnel EST rattaché au moment de la
--    publication (barbers = le lien d'emploi courant).
create or replace function public.check_posts_consistency()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.author_kind = 'professional'
     and new.posted_at_organization_id is not null
     and not exists (
       select 1 from public.barbers b
       where b.professional_id = new.professional_id
         and b.organization_id = new.posted_at_organization_id
     ) then
    raise exception 'posts.posted_at_organization_id must be an organization where the professional currently holds a barbers row';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_check_consistency on public.posts;
create trigger posts_check_consistency
  before insert on public.posts
  for each row execute function public.check_posts_consistency();

-- 2. Identité et rattachement IMMUABLES, like_count gelé hors trigger.
--    Le rattachement figé ne vaut que s'il ne peut pas être réécrit après
--    coup ; et aucune policy UPDATE ne sait protéger une colonne seule.
create or replace function public.posts_guard_immutable_author()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.author_kind is distinct from old.author_kind
     or new.professional_id is distinct from old.professional_id
     or new.organization_id is distinct from old.organization_id
     or new.posted_at_organization_id is distinct from old.posted_at_organization_id then
    raise exception 'posts author identity and posted_at_organization_id are immutable';
  end if;
  if new.like_count is distinct from old.like_count
     and coalesce(current_setting('fadeup.like_count_maintenance', true), '') <> 'on' then
    raise exception 'posts.like_count is maintained by trigger only';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'posts.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_guard_immutable_author on public.posts;
create trigger posts_guard_immutable_author
  before update on public.posts
  for each row execute function public.posts_guard_immutable_author();

-- 3. Au moins un média — DÉFÉRÉ au commit, pour laisser create_post insérer
--    post puis médias dans la même transaction. Porté par un trigger de
--    contrainte sur posts (INSERT) et sur post_media (DELETE : retirer le
--    dernier média d'un post encore vivant est refusé ; la suppression du
--    post lui-même passe, le post n'existe plus au moment du contrôle).
create or replace function public.check_post_has_media()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_post_id uuid;
begin
  -- Deux IF, pas un CASE : sur posts (INSERT) le record OLD n'a pas de champ
  -- post_id et un CASE le résoudrait quand même à l'analyse.
  if tg_table_name = 'posts' then
    v_post_id := new.id;
  else
    v_post_id := old.post_id;
  end if;
  if exists (select 1 from public.posts p where p.id = v_post_id)
     and not exists (select 1 from public.post_media m where m.post_id = v_post_id) then
    raise exception 'a post must carry at least one media (post %)', v_post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists posts_require_media on public.posts;
create constraint trigger posts_require_media
  after insert on public.posts
  deferrable initially deferred
  for each row execute function public.check_post_has_media();

drop trigger if exists post_media_keep_last on public.post_media;
create constraint trigger post_media_keep_last
  after delete on public.post_media
  deferrable initially deferred
  for each row execute function public.check_post_has_media();

-- 4. Dix médias maximum — immédiat : le onzième INSERT échoue.
create or replace function public.check_post_media_limit()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (select count(*) from public.post_media m where m.post_id = new.post_id) > 10 then
    raise exception 'a post carries at most 10 media (post %)', new.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists post_media_limit on public.post_media;
create trigger post_media_limit
  after insert on public.post_media
  for each row execute function public.check_post_media_limit();

-- 5. Cohérence organisation du lien service — le motif exact de
--    check_barber_service_consistency. L'organisation de référence d'un post
--    est son auteur organisation, ou à défaut son rattachement figé.
create or replace function public.check_post_services_consistency()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_org uuid;
begin
  select coalesce(p.organization_id, p.posted_at_organization_id) into v_org
  from public.posts p where p.id = new.post_id;

  if v_org is null then
    raise exception 'post_services requires the post to be attached to an organization (services belong to organizations)';
  end if;

  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.organization_id = v_org
  ) then
    raise exception 'post_services.service_id must belong to the post''s organization';
  end if;
  return new;
end;
$$;

drop trigger if exists post_services_check_consistency on public.post_services;
create trigger post_services_check_consistency
  before insert on public.post_services
  for each row execute function public.check_post_services_consistency();

-- 6. like_count maintenu par trigger — la SEULE écriture légitime de la
--    colonne, signalée au gardien d'immuabilité par la variable locale.
create or replace function public.maintain_post_like_count()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  perform set_config('fadeup.like_count_maintenance', 'on', true);
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  perform set_config('fadeup.like_count_maintenance', '', true);
  return null;
end;
$$;

drop trigger if exists post_likes_maintain_count on public.post_likes;
create trigger post_likes_maintain_count
  after insert or delete on public.post_likes
  for each row execute function public.maintain_post_like_count();

-- ---------------------------------------------------------------------------
-- Grants — anon : rien. authenticated : exactement ce que les policies
-- gouvernent. Jamais TRUNCATE/TRIGGER/REFERENCES (non soumis à RLS).
-- ---------------------------------------------------------------------------

revoke all on table public.posts from anon, authenticated;
revoke all on table public.post_media from anon, authenticated;
revoke all on table public.post_services from anon, authenticated;
revoke all on table public.post_likes from anon, authenticated;

grant select, insert, update, delete on table public.posts to authenticated;
grant select, insert, delete on table public.post_media to authenticated;
grant select, insert, delete on table public.post_services to authenticated;
grant select, insert, delete on table public.post_likes to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

drop policy if exists posts_select_visible on public.posts;
create policy posts_select_visible on public.posts
  for select to authenticated
  using (private.can_view_post(id));

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (
    (author_kind = 'professional' and private.is_own_professional(professional_id))
    or (author_kind = 'organization'
        and private.has_org_role(organization_id, array['owner','manager']::public.membership_role[]))
  );

drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
  for update to authenticated
  using (private.can_manage_post(id))
  with check (private.can_manage_post(id));

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
  for delete to authenticated
  using (private.can_manage_post(id));

-- post_media / post_services héritent de la visibilité et de l'autorité du
-- post parent.

drop policy if exists post_media_select_visible on public.post_media;
create policy post_media_select_visible on public.post_media
  for select to authenticated
  using (private.can_view_post(post_id));

drop policy if exists post_media_insert_own on public.post_media;
create policy post_media_insert_own on public.post_media
  for insert to authenticated
  with check (private.can_manage_post(post_id));

drop policy if exists post_media_delete_own on public.post_media;
create policy post_media_delete_own on public.post_media
  for delete to authenticated
  using (private.can_manage_post(post_id));

drop policy if exists post_services_select_visible on public.post_services;
create policy post_services_select_visible on public.post_services
  for select to authenticated
  using (private.can_view_post(post_id));

drop policy if exists post_services_insert_own on public.post_services;
create policy post_services_insert_own on public.post_services
  for insert to authenticated
  with check (private.can_manage_post(post_id));

drop policy if exists post_services_delete_own on public.post_services;
create policy post_services_delete_own on public.post_services
  for delete to authenticated
  using (private.can_manage_post(post_id));

-- post_likes : lecture publique pour les agrégats (au sens authenticated —
-- anon lit les compteurs via les RPC), écriture et retrait limités à soi,
-- et seulement sur un post que l'on peut voir.

drop policy if exists post_likes_select_all on public.post_likes;
create policy post_likes_select_all on public.post_likes
  for select to authenticated
  using (true);

drop policy if exists post_likes_insert_self on public.post_likes;
create policy post_likes_insert_self on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));

drop policy if exists post_likes_delete_self on public.post_likes;
create policy post_likes_delete_self on public.post_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;
