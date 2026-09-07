-- FadeUp — B4 chantier 3 : avis natifs.
--
-- Rien n'existait (V8 du contrat de données, confirmé par grep et par
-- to_regclass). Tout est créé ici : reviews, review_photos, review_reports,
-- review_reputation, le bucket review-photos, les triggers d'éligibilité,
-- d'immuabilité et d'agrégation.
--
-- RÈGLES PRODUIT PORTÉES PAR LE SCHÉMA (MASTER_SPEC §12) :
--   - un avis n'existe qu'adossé à une prestation TERMINÉE, vérifiable, du
--     compte qui a lui-même réservé (booked_by_user_id — la seule
--     attribution de compte digne de confiance sur un appointment, voir le
--     commentaire de colonne de R1A) ;
--   - 1 à 5 étoiles, commentaire facultatif, note globale seule ;
--   - UN SEUL acte d'avis par prestation (unique appointment_id), qui
--     alimente la réputation du professionnel ET de l'organisation — pas
--     deux avis à écrire ;
--   - fenêtre de dépôt : 30 jours après completed_at ;
--   - réponse publique du professionnel : UNE seule, gravée par trigger ;
--   - modération : cinq motifs légitimes et aucun autre — « la note est
--     mauvaise » n'est pas un motif représentable ;
--   - les avis Google ne sont JAMAIS des avis FadeUp : source est contraint
--     à 'fadeup' et external_attribution à NULL. La place existe (élargir la
--     contrainte est une migration d'une ligne, le jour où une décision
--     l'exigera) ; l'utiliser aujourd'hui est impossible.
--
-- AGRÉGATION. review_reputation, maintenue PAR TRIGGER depuis les avis
-- publiés, une ligne par (sujet, id). Une entité SANS avis n'a PAS de ligne,
-- ou une ligne à count 0 — et l'exposition (chantier 4) rend NULL, jamais 0 :
-- le composant Rating de P1b affiche « Pas encore d'avis » sur NULL et ne
-- doit jamais montrer zéro étoile sur un profil neuf. Table séparée plutôt
-- que colonnes sur professionals/organizations : additive, sans ALTER de
-- tables existantes (B3 travaille en parallèle sur cette base).
--
-- PHOTO D'AVIS. Le client peut contribuer UNE photo en tant qu'avis
-- (MASTER_SPEC §11, formulation au singulier — unique review_id), avec
-- consentement de publication EXPLICITE à l'écriture (consent_publish doit
-- être true, contrainte). consent_social_reuse est l'accord DISTINCT pour
-- toute réutilisation sociale : default false, jamais posé par submit_review,
-- une photo d'avis ne devient jamais un post sans lui.
--
-- IDENTITÉ PUBLIQUE DU CLIENT. reviewer_display_name est réduit À L'ÉCRITURE
-- (« Prénom I. », motif B2) et la lecture publique ne joint jamais
-- customer_profiles : elle n'a rien à lire.
--
-- Idempotent : sûr à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid not null references public.appointments(id) on delete cascade,
  customer_user_id      uuid not null references auth.users(id) on delete cascade,
  professional_id       uuid not null references public.professionals(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  rating                smallint not null,
  comment               text,
  reviewer_display_name text not null,
  status                text not null default 'published',
  moderation_reason     text,
  moderated_at          timestamptz,
  moderated_by          uuid,
  reply_body            text,
  replied_at            timestamptz,
  replied_by_user_id    uuid references auth.users(id) on delete set null,
  source                text not null default 'fadeup',
  external_attribution  jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint reviews_appointment_unique unique (appointment_id),
  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_comment_length check (comment is null or char_length(comment) <= 2000),
  constraint reviews_reviewer_name_not_blank check (btrim(reviewer_display_name) <> ''),
  constraint reviews_status_valid check (status in ('published','under_review','removed')),
  constraint reviews_moderation_reason_valid check (
    moderation_reason is null or moderation_reason in
      ('fraud','abusive_content','personal_data','hate_speech','conflict_of_interest')
  ),
  constraint reviews_removed_needs_reason check (
    status <> 'removed' or moderation_reason is not null
  ),
  constraint reviews_moderation_stamped check (
    (status = 'published' and moderated_at is null and moderation_reason is null)
    or (status in ('under_review','removed') and moderated_at is not null)
  ),
  -- replied_by_user_id n'est pas exigé non nul : on delete set null — la
  -- disparition du compte répondant ne doit pas invalider la ligne.
  constraint reviews_reply_consistency check ((reply_body is null) = (replied_at is null)),
  constraint reviews_reply_length check (reply_body is null or char_length(reply_body) <= 1000),
  -- La place pour une source externe existe ; l'utiliser exige une décision
  -- (et une migration) explicite. Aujourd'hui : fadeup uniquement, sans
  -- attribution externe.
  constraint reviews_source_fadeup_only check (source = 'fadeup' and external_attribution is null)
);

comment on table public.reviews is
  'Avis natifs FadeUp. Un par prestation terminée (unique appointment_id), déposé par le compte qui a lui-même réservé, dans les 30 jours suivant completed_at (check_reviews_consistency). Alimente la réputation du professionnel ET de l''organisation via review_reputation. Jamais supprimé parce que la note est mauvaise : les seuls motifs de retrait sont fraud/abusive_content/personal_data/hate_speech/conflict_of_interest. Les avis Google ne sont jamais intégrés ici (reviews_source_fadeup_only).';

comment on column public.reviews.reviewer_display_name is
  'Nom public du client, RÉDUIT À L''ÉCRITURE (« Prénom I. », motif B2) : la lecture publique n''a jamais à joindre customer_profiles.';

alter table public.reviews enable row level security;
alter table public.reviews force row level security;

create index if not exists reviews_professional_created_idx
  on public.reviews (professional_id, created_at desc);
create index if not exists reviews_organization_created_idx
  on public.reviews (organization_id, created_at desc);
create index if not exists reviews_customer_idx
  on public.reviews (customer_user_id);

drop trigger if exists set_updated_at on public.reviews;
create trigger set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Garde d'éligibilité — vérité du trigger, quel que soit le chemin d'écriture
-- ---------------------------------------------------------------------------

create or replace function public.check_reviews_consistency()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments a where a.id = new.appointment_id;

  if not found then
    raise exception 'reviews.appointment_id must reference an existing appointment';
  end if;
  if v_appt.status <> 'completed' or v_appt.completed_at is null then
    -- Un completed_at NULL est un « terminé à date inconnue » pré-R1A : sans
    -- horodatage fiable, la fenêtre de 30 jours est invérifiable, donc
    -- l'avis est refusé plutôt que fondé sur une date inventée.
    raise exception 'a review requires a completed appointment with a trustworthy completion time'
      using errcode = '23514';
  end if;
  if v_appt.booked_by_user_id is null or v_appt.booked_by_user_id <> new.customer_user_id then
    raise exception 'a review can only be left by the account that itself booked the appointment'
      using errcode = '42501';
  end if;
  if now() > v_appt.completed_at + interval '30 days' then
    raise exception 'the 30-day review window for this appointment has closed'
      using errcode = '23514';
  end if;
  if new.organization_id <> v_appt.organization_id then
    raise exception 'reviews.organization_id must match the appointment''s organization';
  end if;
  if not exists (
    select 1 from public.barbers b
    where b.id = v_appt.barber_id and b.professional_id = new.professional_id
  ) then
    raise exception 'reviews.professional_id must be the professional behind the appointment''s barber';
  end if;
  -- Corroboration par la vérité matérialisée des prestations réelles.
  if not exists (
    select 1 from public.customer_professional_relationships r
    where r.customer_user_id = new.customer_user_id
      and r.professional_id = new.professional_id
      and r.organization_id = new.organization_id
      and r.completed_interaction_count > 0
  ) then
    raise exception 'no verifiable completed relationship between this customer and this professional'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_check_consistency on public.reviews;
create trigger reviews_check_consistency
  before insert on public.reviews
  for each row execute function public.check_reviews_consistency();

-- ---------------------------------------------------------------------------
-- Immuabilité — l'acte d'avis est gravé ; la réponse s'écrit une fois ;
-- seule la modération fait bouger status.
-- ---------------------------------------------------------------------------

create or replace function public.reviews_guard_immutable()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.appointment_id  is distinct from old.appointment_id
     or new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id  is distinct from old.professional_id
     or new.organization_id  is distinct from old.organization_id
     or new.rating           is distinct from old.rating
     or new.comment          is distinct from old.comment
     or new.reviewer_display_name is distinct from old.reviewer_display_name
     or new.source           is distinct from old.source
     or new.external_attribution is distinct from old.external_attribution
     or new.created_at       is distinct from old.created_at then
    raise exception 'review core fields are immutable once submitted';
  end if;
  if old.reply_body is not null
     and (new.reply_body is distinct from old.reply_body
          or new.replied_at is distinct from old.replied_at
          or new.replied_by_user_id is distinct from old.replied_by_user_id) then
    raise exception 'a review reply is written once — one public reply per review';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_guard_immutable on public.reviews;
create trigger reviews_guard_immutable
  before update on public.reviews
  for each row execute function public.reviews_guard_immutable();

-- ---------------------------------------------------------------------------
-- review_reputation — l'agrégat, maintenu par trigger, jamais recalculé à la
-- lecture, jamais écrit par un client.
-- ---------------------------------------------------------------------------

create table if not exists public.review_reputation (
  subject_kind text not null,
  subject_id   uuid not null,
  rating_sum   integer not null default 0,
  rating_count integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (subject_kind, subject_id),
  constraint review_reputation_kind_valid check (subject_kind in ('professional','organization')),
  constraint review_reputation_nonnegative check (rating_sum >= 0 and rating_count >= 0),
  constraint review_reputation_sum_bounded check (rating_sum <= rating_count * 5)
);

comment on table public.review_reputation is
  'Réputation agrégée par sujet, maintenue par maintain_review_reputation depuis les seuls avis status=published. rating_count = 0 (ou absence de ligne) signifie « pas encore d''avis » et DOIT être exposé comme note NULL, jamais 0 : un profil neuf n''est pas un profil mal noté. L''exposition passe par get_public_reputation, qui rend null quand le compte est nul.';

alter table public.review_reputation enable row level security;
alter table public.review_reputation force row level security;

create or replace function private.apply_reputation_delta(
  p_kind text, p_id uuid, p_sum_delta integer, p_count_delta integer
) returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  insert into public.review_reputation as rr (subject_kind, subject_id, rating_sum, rating_count)
  values (p_kind, p_id, greatest(p_sum_delta, 0), greatest(p_count_delta, 0))
  on conflict (subject_kind, subject_id) do update
    set rating_sum   = greatest(rr.rating_sum + p_sum_delta, 0),
        rating_count = greatest(rr.rating_count + p_count_delta, 0),
        updated_at   = now();
end;
$$;

create or replace function public.maintain_review_reputation()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  -- Un avis ne compte que publié. Les deux sujets bougent ensemble : le même
  -- acte d'avis alimente le professionnel ET l'organisation.
  if tg_op in ('UPDATE','DELETE') and old.status = 'published' then
    perform private.apply_reputation_delta('professional', old.professional_id, -old.rating, -1);
    perform private.apply_reputation_delta('organization', old.organization_id, -old.rating, -1);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.status = 'published' then
    perform private.apply_reputation_delta('professional', new.professional_id, new.rating, 1);
    perform private.apply_reputation_delta('organization', new.organization_id, new.rating, 1);
  end if;
  return null;
end;
$$;

-- rating et sujets sont immuables (reviews_guard_immutable) : seuls INSERT,
-- DELETE et les transitions de status peuvent déplacer l'agrégat. La pose
-- d'une réponse ne le recalcule pas.
drop trigger if exists reviews_maintain_reputation on public.reviews;
create trigger reviews_maintain_reputation
  after insert or delete or update of status on public.reviews
  for each row execute function public.maintain_review_reputation();

-- ---------------------------------------------------------------------------
-- review_photos — une photo, en tant qu'avis, avec consentements explicites
-- ---------------------------------------------------------------------------

create table if not exists public.review_photos (
  id                   uuid primary key default gen_random_uuid(),
  review_id            uuid not null references public.reviews(id) on delete cascade,
  storage_path         text not null,
  consent_publish      boolean not null,
  consent_social_reuse boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint review_photos_review_unique unique (review_id),
  constraint review_photos_storage_path_unique unique (storage_path),
  constraint review_photos_storage_path_not_blank check (btrim(storage_path) <> ''),
  -- Pas de photo sans consentement de publication explicite. Le refus n'est
  -- pas une ligne à false : c'est l'absence de ligne.
  constraint review_photos_consent_required check (consent_publish)
);

comment on table public.review_photos is
  'Photo contribuée par le client EN TANT QU''AVIS (MASTER_SPEC §11), une par avis. consent_publish : consentement explicite à la publication avec l''avis, exigé par contrainte. consent_social_reuse : accord DISTINCT — default false, jamais posé par submit_review — sans lequel une photo d''avis ne devient jamais matière à post.';

alter table public.review_photos enable row level security;
alter table public.review_photos force row level security;

-- ---------------------------------------------------------------------------
-- review_reports — signalement
-- ---------------------------------------------------------------------------

create table if not exists public.review_reports (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null references public.reviews(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason           text not null,
  detail           text,
  status           text not null default 'open',
  resolved_at      timestamptz,
  resolved_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint review_reports_reason_valid check (
    reason in ('fraud','abusive_content','personal_data','hate_speech','conflict_of_interest','other')
  ),
  constraint review_reports_detail_length check (detail is null or char_length(detail) <= 1000),
  constraint review_reports_status_valid check (status in ('open','reviewed','dismissed','actioned')),
  constraint review_reports_resolution_stamped check (
    (status = 'open' and resolved_at is null) or (status <> 'open' and resolved_at is not null)
  ),
  constraint review_reports_reporter_unique unique (review_id, reporter_user_id)
);

comment on table public.review_reports is
  'Signalement d''un avis pour modération. Les motifs sont ceux de la modération plus ''other'' pour le tout-venant — le tri se fait à la résolution. Un signalement par (avis, compte).';

alter table public.review_reports enable row level security;
alter table public.review_reports force row level security;

create index if not exists review_reports_open_idx
  on public.review_reports (created_at) where status = 'open';

drop trigger if exists set_updated_at on public.review_reports;
create trigger set_updated_at
  before update on public.review_reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Bucket review-photos — même modèle que passport-photos/post-media.
-- Images seulement : une photo d'avis est une photo. 8 Mo.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 8388608,
        array['image/jpeg', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg', 'image/webp', 'image/avif'];

create or replace function private.can_view_review_photo_path(p_name text)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.review_photos rp
    join public.reviews r on r.id = rp.review_id
    where rp.storage_path = p_name
      and (r.status = 'published' or r.customer_user_id = (select auth.uid()))
  );
$$;

revoke execute on function private.can_view_review_photo_path(text) from public;
grant execute on function private.can_view_review_photo_path(text) to anon, authenticated;

drop policy if exists review_photos_objects_insert_own on storage.objects;
create policy review_photos_objects_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists review_photos_objects_delete_own on storage.objects;
create policy review_photos_objects_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists review_photos_objects_select_own on storage.objects;
create policy review_photos_objects_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'review-photos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists review_photos_objects_select_visible on storage.objects;
create policy review_photos_objects_select_visible
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'review-photos'
         and private.can_view_review_photo_path(name));

-- ---------------------------------------------------------------------------
-- Grants et policies — écritures par RPC uniquement (security definer,
-- possédées par postgres). authenticated lit ; anon ne détient rien et lit
-- via get_public_reviews.
-- ---------------------------------------------------------------------------

revoke all on table public.reviews from anon, authenticated;
revoke all on table public.review_photos from anon, authenticated;
revoke all on table public.review_reports from anon, authenticated;
revoke all on table public.review_reputation from anon, authenticated;

grant select on table public.reviews to authenticated;
grant select on table public.review_photos to authenticated;
grant select on table public.review_reports to authenticated;
grant select on table public.review_reputation to authenticated;

drop policy if exists reviews_select_visible on public.reviews;
create policy reviews_select_visible on public.reviews
  for select to authenticated
  using (
    status = 'published'
    or customer_user_id = (select auth.uid())
    or private.is_own_professional(professional_id)
    or private.has_org_role(organization_id, array['owner','manager']::public.membership_role[])
  );

drop policy if exists review_photos_select_visible on public.review_photos;
create policy review_photos_select_visible on public.review_photos
  for select to authenticated
  using (exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (r.status = 'published' or r.customer_user_id = (select auth.uid()))
  ));

drop policy if exists review_reports_select_own on public.review_reports;
create policy review_reports_select_own on public.review_reports
  for select to authenticated
  using (reporter_user_id = (select auth.uid()));

drop policy if exists review_reputation_select_all on public.review_reputation;
create policy review_reputation_select_all on public.review_reputation
  for select to authenticated
  using (true);

commit;
