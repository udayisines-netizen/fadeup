-- FadeUp — B2, chantier 1b: envoyer une demande à un profil non revendiqué.
--
-- LE CUL-DE-SAC, ET POURQUOI IL NE SE LÈVE PAS AVEC `appointments`
--
-- B1 a publié un vrai prospect par le chemin opérateur, l'a lu en anon par
-- HTTP, puis l'a RETIRÉ, en écrivant pourquoi : un client arrivant sur ce
-- profil ne pouvait rien faire. B2 doit lever ce cul-de-sac.
--
-- La branche `pending` de 20260904180000 ne le lève pas, et ne peut pas :
-- `appointments` exige organization_id, location_id, barber_id et service_id,
-- tous NOT NULL. Un profil publié par le Worker n'a **aucun des quatre**, et
-- c'est délibéré. R1B l'a écrit dans le commentaire de la table
-- `professionals` : l'identité « carries no operational data — availability,
-- services, appointments and queue entries hang off barbers/organizations
-- only. That absence is what makes an unclaimed external profile structurally
-- incapable of implying FadeUp operational truth. »
--
-- Créer une organisation coquille pour chaque prospect publié détruirait
-- exactement cette garantie. Ce fichier ne le fait pas.
--
-- CE QUE C'EST, ET CE QUE CE N'EST PAS
--
-- Une DEMANDE D'INTÉRÊT. Elle exprime une envie, pas un rendez-vous :
--
--   - elle ne retient AUCUN créneau — il n'y a pas d'agenda à retenir ;
--   - elle ne prétend à AUCUNE disponibilité — personne n'a publié d'horaires ;
--   - `preferred_starts_at` est une PRÉFÉRENCE du client, jamais une offre du
--     professionnel. Le nom de la colonne le dit, et l'interface devra le dire
--     aussi.
--
-- C'est ce que MASTER_SPEC §5 décrit : « Un client y envoie une demande. Elle
-- sort en `pending`, un e-mail part au professionnel, et la demande en attente
-- est l'argument de vente. » Ce que le professionnel reçoit n'est pas un
-- planning : c'est la preuve qu'un vrai client l'a cherché.
--
-- POURQUOI DEUX TABLES
--
-- MASTER_SPEC §5, règle stricte : « Données personnelles avant vérification :
-- prénom ou initiale, service, horaire. JAMAIS le téléphone ni l'e-mail
-- complet. »
--
-- Un gabarit prudent ne suffit pas. B2 exige une garde technique qui rende la
-- fuite IMPOSSIBLE, pas improbable. La garde est ici, et elle est structurelle :
--
--   professional_interest_requests           ne CONTIENT PAS de contact.
--                                            Elle porte customer_display_name,
--                                            déjà réduit à l'écriture.
--   professional_interest_request_contacts   contient l'e-mail et le téléphone.
--
-- La fonction qui compose l'e-mail de prospection lit la première et n'a
-- aucune raison syntaxique de nommer la seconde. On ne lui demande pas de
-- résister à la tentation : la colonne n'existe pas dans la table qu'elle lit.
-- Un test de la suite B2 assert que sa définition ne mentionne jamais la table
-- de contacts, et échoue si quelqu'un l'y ajoute un jour.
--
-- La réduction elle-même se fait à l'écriture, dans
-- private.reduce_customer_display_name : « Karim Benali » devient « Karim B. ».
-- Stockée réduite, elle ne peut pas être « dé-réduite » plus tard par un
-- gabarit trop bavard.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Le cycle de vie
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'interest_request_status') then
    create type public.interest_request_status as enum ('pending', 'expired', 'withdrawn');
  end if;
end $$;

comment on type public.interest_request_status is
  'Cycle de vie d''une demande d''intérêt vers un profil NON REVENDIQUÉ. Trois états seulement, et pas d''état « acceptée » : accepter suppose un professionnel qui a revendiqué son profil, créé son organisation et son catalogue — c''est la conversion, elle appartient au flux de revendication et B2 ne la modélise pas plutôt que d''inventer un état inatteignable.';

-- ---------------------------------------------------------------------------
-- 2. La demande — sans une seule colonne de contact
-- ---------------------------------------------------------------------------

create table if not exists public.professional_interest_requests (
  id uuid primary key default gen_random_uuid(),

  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- Déjà réduit. C'est la SEULE forme du nom que cette table connaisse, et
  -- donc la seule que l'e-mail de prospection puisse citer.
  customer_display_name text not null,

  -- Ce que le client demande, dans ses mots : il n'y a pas de catalogue à
  -- choisir puisque le professionnel n'a rien publié.
  service_label text not null,

  -- UNE PRÉFÉRENCE, jamais une disponibilité. Aucun créneau n'est retenu.
  preferred_starts_at timestamptz not null,

  notes text,

  locale text not null default 'fr',

  status public.interest_request_status not null default 'pending',

  -- Même règle que le tunnel appointments : 24 h au plus, et jamais au-delà de
  -- l'heure demandée. Dérivé par trigger, pas par l'appelant.
  expires_at timestamptz not null,

  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_interest_requests_display_name_not_blank
    check (btrim(customer_display_name) <> ''),

  constraint professional_interest_requests_service_label_not_blank
    check (btrim(service_label) <> ''),

  constraint professional_interest_requests_locale_valid
    check (locale in ('fr', 'en')),

  -- L'échéance ne peut pas dépasser l'heure demandée : répondre à 10 h 05
  -- pour un créneau de 10 h n'est pas une réponse.
  constraint professional_interest_requests_expiry_not_after_start
    check (expires_at <= preferred_starts_at),

  -- Un état terminal est daté, un état en cours ne l'est pas.
  constraint professional_interest_requests_resolution_matches_status
    check ((status = 'pending') = (resolved_at is null))
);

comment on table public.professional_interest_requests is
  'Une demande envoyée par un client à un profil professionnel NON REVENDIQUÉ, publié par le Worker. Ce n''est pas un rendez-vous : aucun créneau n''est retenu, aucune disponibilité n''est affirmée, preferred_starts_at est la préférence du client. C''est l''amont de la boucle d''acquisition de MASTER_SPEC §5, et l''argument de vente montré au professionnel quand il revendique. NE CONTIENT AUCUN CONTACT CLIENT — voir professional_interest_request_contacts et l''en-tête de cette migration.';

comment on column public.professional_interest_requests.customer_display_name is
  'Prénom + initiale, réduit à l''ÉCRITURE par private.reduce_customer_display_name. MASTER_SPEC §5 limite ce qu''un professionnel non vérifié peut voir d''un client ; stocker la forme réduite plutôt que de la calculer à l''affichage rend la règle non contournable par un gabarit.';

comment on column public.professional_interest_requests.preferred_starts_at is
  'L''heure que le CLIENT souhaite. Jamais une heure que le professionnel a offerte — il n''a publié aucun horaire. Toute interface qui présente cette valeur comme un créneau confirmé ment.';

create index if not exists professional_interest_requests_professional_idx
  on public.professional_interest_requests (professional_id, created_at desc);

create index if not exists professional_interest_requests_pending_expiry_idx
  on public.professional_interest_requests (expires_at) where status = 'pending';

drop trigger if exists professional_interest_requests_set_updated_at on public.professional_interest_requests;
create trigger professional_interest_requests_set_updated_at
  before update on public.professional_interest_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Le contact, à part
-- ---------------------------------------------------------------------------

create table if not exists public.professional_interest_request_contacts (
  request_id uuid primary key
    references public.professional_interest_requests (id) on delete cascade,

  customer_email text,
  customer_phone text,

  -- Le compte, quand la demande a été envoyée par quelqu'un de connecté.
  booked_by_user_id uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sans au moins un canal, la demande ne peut pas recevoir de réponse.
  constraint professional_interest_request_contacts_reachable
    check (
      nullif(btrim(coalesce(customer_email, '')), '') is not null
      or nullif(btrim(coalesce(customer_phone, '')), '') is not null
    )
);

comment on table public.professional_interest_request_contacts is
  'Les coordonnées du client d''une demande d''intérêt, DÉLIBÉRÉMENT séparées de la demande elle-même. La séparation est la garde technique exigée par MASTER_SPEC §5 : la fonction qui compose l''e-mail de prospection lit professional_interest_requests, où ces colonnes n''existent pas. Elle ne se retient pas de les lire — elle ne peut pas.';

drop trigger if exists professional_interest_request_contacts_set_updated_at on public.professional_interest_request_contacts;
create trigger professional_interest_request_contacts_set_updated_at
  before update on public.professional_interest_request_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — activée sans exception, comme toute table de ce schéma
--
-- anon n'obtient RIEN : il écrit par la RPC `security definer` ci-dessous et
-- ne lit jamais la table. Un client connecté voit ses propres demandes. Le
-- personnel plateforme voit tout, parce que l'arbitrage des revendications et
-- le tunnel d'acquisition se pilotent depuis /platform.
--
-- Le PROFESSIONNEL, lui, n'a rien à voir ici tant qu'il n'a pas revendiqué :
-- avant revendication il n'a pas de compte, et après revendication la lecture
-- passera par la RPC de conversion que le flux de revendication apportera.
-- ---------------------------------------------------------------------------

alter table public.professional_interest_requests enable row level security;
alter table public.professional_interest_request_contacts enable row level security;

drop policy if exists professional_interest_requests_select on public.professional_interest_requests;
create policy professional_interest_requests_select
  on public.professional_interest_requests
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or exists (
      select 1 from public.professional_interest_request_contacts c
      where c.request_id = professional_interest_requests.id
        and c.booked_by_user_id = (select auth.uid())
    )
  );

drop policy if exists professional_interest_request_contacts_select on public.professional_interest_request_contacts;
create policy professional_interest_request_contacts_select
  on public.professional_interest_request_contacts
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or booked_by_user_id = (select auth.uid())
  );

-- Aucune policy d'écriture, pour aucun rôle client : ces tables ne se
-- remplissent que par les RPC `security definer` de ce fichier.

revoke all on table public.professional_interest_requests from anon, authenticated;
revoke all on table public.professional_interest_request_contacts from anon, authenticated;
grant select on table public.professional_interest_requests to authenticated;
grant select on table public.professional_interest_request_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- 5. La réduction du nom
-- ---------------------------------------------------------------------------

create or replace function private.reduce_customer_display_name(p_full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_full_name, '')) = '' then ''
    when position(' ' in btrim(regexp_replace(p_full_name, '\s+', ' ', 'g'))) = 0
      -- Un seul mot : c'est déjà un prénom, on le garde tel quel.
      then btrim(regexp_replace(p_full_name, '\s+', ' ', 'g'))
    else
      split_part(btrim(regexp_replace(p_full_name, '\s+', ' ', 'g')), ' ', 1)
      || ' '
      || upper(left(split_part(btrim(regexp_replace(p_full_name, '\s+', ' ', 'g')), ' ', 2), 1))
      || '.'
  end;
$$;

comment on function private.reduce_customer_display_name(text) is
  'MASTER_SPEC §5 : « prénom ou initiale ». « Karim Benali » -> « Karim B. ». Appliquée à l''ÉCRITURE, jamais à l''affichage : une réduction faite au rendu peut être oubliée par le gabarit suivant, une réduction faite au stockage ne peut plus être défaite.';

revoke all on function private.reduce_customer_display_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. L'échéance, dérivée et plafonnée — jamais fournie par l'appelant
-- ---------------------------------------------------------------------------

create or replace function public.set_interest_request_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    if new.expires_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'pending') then
      new.expires_at := now() + interval '24 hours';
    end if;
    -- La même règle que le tunnel appointments, pour la même raison.
    new.expires_at := least(new.expires_at, new.preferred_starts_at);
  end if;
  return new;
end;
$$;

drop trigger if exists professional_interest_requests_set_expiry on public.professional_interest_requests;
create trigger professional_interest_requests_set_expiry
  before insert or update on public.professional_interest_requests
  for each row execute function public.set_interest_request_expiry();

-- ---------------------------------------------------------------------------
-- 7. Envoyer une demande — le geste public
-- ---------------------------------------------------------------------------

create or replace function public.create_professional_interest_request(
  p_professional_id uuid,
  p_customer_name text,
  p_service_label text,
  p_preferred_starts_at timestamptz,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_notes text default null,
  p_locale text default 'fr'
)
returns table (
  id uuid,
  status public.interest_request_status,
  preferred_starts_at timestamptz,
  expires_at timestamptz,
  professional_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional public.professionals;
  v_request public.professional_interest_requests;
  v_user_id uuid;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  if btrim(coalesce(p_service_label, '')) = '' then
    raise exception 'service_label is required';
  end if;

  if coalesce(btrim(p_customer_email), '') = '' and coalesce(btrim(p_customer_phone), '') = '' then
    raise exception 'at least one of customer_email or customer_phone is required'
      using detail = 'fadeup_interest_refusal=no_contact_channel';
  end if;

  if p_preferred_starts_at <= now() then
    raise exception 'preferred_starts_at must be in the future'
      using detail = 'fadeup_interest_refusal=past_time';
  end if;

  -- Jusqu'à 90 jours à l'avance, la même fenêtre que la réservation
  -- (MASTER_SPEC §6). Au-delà, ce n'est plus une intention, c'est du bruit.
  if p_preferred_starts_at > now() + interval '90 days' then
    raise exception 'preferred_starts_at is too far in the future'
      using detail = 'fadeup_interest_refusal=too_far_ahead';
  end if;

  select p.* into v_professional
  from public.professionals p
  where p.id = p_professional_id;

  if not found or not v_professional.is_public then
    -- Même refus pour « inexistant » et « non publié » : un refus distinct
    -- laisserait sonder quelles identités existent.
    raise exception 'this profile is not open to requests'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=profile_not_public';
  end if;

  -- Un profil REVENDIQUÉ n'a rien à faire ici : son propriétaire a un compte,
  -- une organisation et un agenda, et la demande doit passer par
  -- book_public_appointment, qui vérifie une disponibilité réelle. Envoyer une
  -- demande d'intérêt à quelqu'un qui a un vrai agenda serait lui faire
  -- retaper à la main ce que la base sait déjà.
  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional is on FadeUp; book a real slot instead'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=professional_is_claimed';
  end if;

  -- Un profil retiré de la marketplace ou marqué do_not_contact ne reçoit
  -- plus rien. La garde vit ici, à la porte d'entrée, en plus de celle des
  -- relances : une demande créée après un retrait produirait un e-mail que la
  -- relance refuserait ensuite d'envoyer, donc une demande morte-née.
  if exists (
    select 1
    from public.prospect_professionals pp
    join public.prospects pr on pr.id = pp.prospect_id
    where pp.professional_id = p_professional_id
      and pr.do_not_contact
  ) then
    raise exception 'this profile is not open to requests'
      using errcode = '42501',
            detail = 'fadeup_interest_refusal=profile_withdrawn';
  end if;

  v_user_id := (select auth.uid());

  insert into public.professional_interest_requests (
    professional_id, customer_display_name, service_label,
    preferred_starts_at, notes, locale, status, expires_at
  )
  values (
    p_professional_id,
    private.reduce_customer_display_name(p_customer_name),
    btrim(p_service_label),
    p_preferred_starts_at,
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when lower(coalesce(p_locale, 'fr')) = 'en' then 'en' else 'fr' end,
    'pending',
    -- Valeur provisoire : le trigger la dérive et la plafonne. La colonne est
    -- NOT NULL, il faut bien poser quelque chose.
    p_preferred_starts_at
  )
  returning * into v_request;

  insert into public.professional_interest_request_contacts (
    request_id, customer_email, customer_phone, booked_by_user_id
  )
  values (
    v_request.id,
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    v_user_id
  );

  return query select
    v_request.id,
    v_request.status,
    v_request.preferred_starts_at,
    v_request.expires_at,
    v_professional.display_name;
end;
$$;

comment on function public.create_professional_interest_request(uuid, text, text, timestamptz, text, text, text, text) is
'Anon-callable. Envoie une demande à un profil professionnel NON REVENDIQUÉ publié par le Worker — le geste qui lève le cul-de-sac que B1 avait constaté et documenté.

Ce n''est PAS une réservation et la RPC ne prétend pas le contraire : elle ne retourne ni ends_at, ni barbier, ni lieu, parce qu''aucun de ces faits n''existe. preferred_starts_at est ce que le client souhaite.

Refuse, avec un motif nommé dans DETAIL fadeup_interest_refusal=<code> : profile_not_public, professional_is_claimed (réserve un vrai créneau), profile_withdrawn, no_contact_channel, past_time, too_far_ahead.

Le nom du client est réduit à « Prénom I. » AVANT stockage, et ses coordonnées vont dans une table séparée que la composition d''e-mail ne lit pas.';

revoke all on function public.create_professional_interest_request(uuid, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public.create_professional_interest_request(uuid, text, text, timestamptz, text, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Le balayage des demandes échues
-- ---------------------------------------------------------------------------

create or replace function public.expire_interest_requests(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select r.id from public.professional_interest_requests r
    where r.status = 'pending' and r.expires_at <= now()
    order by r.expires_at
    limit greatest(p_limit, 0)
    for update skip locked
  loop
    update public.professional_interest_requests
      set status = 'expired', resolved_at = now()
      where id = v_id and status = 'pending';
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.expire_interest_requests(integer) is
  'Passe en `expired` les demandes d''intérêt dont l''échéance est atteinte. Appelée par le conteneur fadeup-scheduler, jamais par un client. FOR UPDATE SKIP LOCKED et re-vérification du statut sous verrou, comme expire_pending_appointments.';

revoke all on function public.expire_interest_requests(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Ce que le client voit de ses propres demandes
-- ---------------------------------------------------------------------------

create or replace function public.get_my_interest_requests()
returns table (
  id uuid,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  service_label text,
  preferred_starts_at timestamptz,
  status public.interest_request_status,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.professional_id, p.display_name, p.handle,
         r.service_label, r.preferred_starts_at, r.status, r.expires_at, r.created_at
  from public.professional_interest_requests r
  join public.professional_interest_request_contacts c on c.request_id = r.id
  join public.professionals p on p.id = r.professional_id
  where c.booked_by_user_id = (select auth.uid())
    and (select auth.uid()) is not null
  order by r.created_at desc;
$$;

comment on function public.get_my_interest_requests() is
  'Les demandes d''intérêt du client connecté. Ne retourne rien à un appelant anonyme : sans compte il n''y a rien à rattacher, et l''écran « demande envoyée » de P2 lui montre le retour de create_professional_interest_request.';

revoke all on function public.get_my_interest_requests() from public, anon;
grant execute on function public.get_my_interest_requests() to authenticated, service_role;

commit;
