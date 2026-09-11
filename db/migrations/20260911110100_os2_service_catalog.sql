-- FadeUp — OS-2 : le catalogue de services.
--
-- RÔLE D'APPLICATION : postgres (colonnes et fonctions NEUVES ; les objets
-- redéfinis — aucun — appartiendraient à postgres de toute façon).
--
-- CE QUE TRANCHE CE FICHIER
--
-- 1. LE PRIX EST RÉSERVÉ. Décision du fondateur : « catalogue par un barber,
--    oui, mais pas les prix ». La garde est SERVEUR et elle REFUSE, elle
--    n'ignore pas : `update_service` qui reçoit un `p_price_cents` non nul
--    d'un barber lève 42501 avec le motif
--    `fadeup_service_refusal=price_forbidden_for_role`. Le refus porte sur
--    la PRÉSENCE du champ, pas sur sa différence avec la valeur courante —
--    un barber qui renvoie le prix actuel est refusé lui aussi, sinon la
--    garde dépendrait d'une lecture concurrente.
--
-- 2. UN SERVICE CRÉÉ PAR UN BARBER N'A PAS DE PRIX — et `price_cents` est
--    NOT NULL depuis l'origine. Plutôt que de relâcher la contrainte (et de
--    répandre le null dans la réservation, la facturation et le public),
--    OS-2 ajoute `price_pending` : le service naît `is_active = false`,
--    `price_pending = true`, `price_cents = 0`. Il est donc INVISIBLE du
--    public exactement comme n'importe quel service désactivé — aucune
--    surface publique ne change — et l'écran pro le montre « en attente
--    d'un prix », ce qui est vrai. Le propriétaire fixe le prix, le service
--    s'active.
--
-- 3. ARCHIVER, JAMAIS SUPPRIMER. `archived_at` distingue « archivé » de
--    « inactif » et de « brouillon », que `is_active = false` confondait.
--    `delete_service` refuse dès qu'un historique existe — rendez-vous,
--    entrée de file, mesure de durée ou publication — et nomme le motif.
--    La clé étrangère `appointments_service_id_fkey ON DELETE RESTRICT`
--    couvrait déjà les rendez-vous ; elle ne couvrait NI les entrées de
--    file (SET NULL) NI les mesures de durée (CASCADE, donc effacement
--    silencieux de ce que FadeUp a appris). C'est le trou que cette RPC
--    ferme.
--
-- 4. UN SERVICE CRÉÉ EST RÉELLEMENT OFFERT. `service_locations` est la
--    jointure que TOUS les chemins de réservation exigent — tunnel public,
--    `get_available_slots`, `book_public_appointment`, l'agenda d'OS-1, la
--    découverte. Un service créé sans elle serait « actif » à l'écran et
--    réservable NULLE PART. `p_location_ids` à NULL signifie donc « tous les
--    établissements de l'organisation », pas « aucun » : le défaut sûr est
--    côté serveur, pour que l'oubli d'un appelant ne puisse plus produire un
--    service fantôme.
--
-- 5. L'EFFET D'UNE DURÉE DÉCLARÉE. `private.estimated_service_duration_
--    minutes` mélange déclaré et observé jusqu'à 20 mesures (poids
--    (n-4)/16). La RPC de liste rend `observed_minutes`, `sample_count` et
--    `declared_weight_percent` pour que l'écran puisse le DIRE au
--    professionnel au lieu de le lui cacher.
--
-- LE MOTIF NUL : chaque garde de rôle est une EXISTENCE
-- (`private.has_org_role`), chaque identifiant est testé `is null` avant
-- d'être utilisé dans un `if not`.

begin;

-- ---------------------------------------------------------------------------
-- 1. Deux colonnes
-- ---------------------------------------------------------------------------

alter table public.services
  add column if not exists archived_at timestamptz,
  add column if not exists price_pending boolean not null default false;

comment on column public.services.archived_at is
  'Date d''archivage. NULL = pas archivé. Archiver met aussi is_active à false ; la distinction permet de ne pas confondre « archivé » (retiré du catalogue, historique conservé) et « désactivé » (pause) ou « brouillon » (price_pending).';
comment on column public.services.price_pending is
  'Vrai pour un service créé par un barber, qui n''a pas le droit de fixer un prix. price_cents vaut alors 0 par défaut technique — ce n''est PAS un prix affichable. Le service reste is_active = false, donc absent de toute surface publique, jusqu''à ce qu''un owner/manager fixe le prix.';

create index if not exists services_org_active_idx
  on public.services (organization_id, is_active) where archived_at is null;

-- Un service en attente de prix ne peut pas être actif : la loi est en base,
-- pas seulement dans la RPC.
alter table public.services
  drop constraint if exists services_pending_price_not_active;
alter table public.services
  add constraint services_pending_price_not_active
  check (not (price_pending and is_active));

-- ---------------------------------------------------------------------------
-- 2. Lire le catalogue
-- ---------------------------------------------------------------------------

create or replace function public.list_organization_services(
  p_organization_id uuid,
  p_include_archived boolean default false
)
returns table (
  id uuid,
  name text,
  description text,
  category_id uuid,
  category_name text,
  duration_minutes integer,
  price_cents integer,
  price_pending boolean,
  is_active boolean,
  archived_at timestamptz,
  status text,
  barber_count integer,
  assigned_barber_ids uuid[],
  observed_minutes numeric,
  sample_count integer,
  declared_weight_percent integer,
  has_history boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not (select private.is_org_member(p_organization_id)) then
    raise exception 'not authorized to read this catalogue'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  return query
  select
    s.id,
    s.name,
    s.description,
    s.category_id,
    c.name,
    s.duration_minutes,
    s.price_cents,
    s.price_pending,
    s.is_active,
    s.archived_at,
    case
      when s.archived_at is not null then 'archived'
      when s.price_pending then 'draft'
      when s.is_active then 'active'
      else 'inactive'
    end,
    coalesce(bs.barber_count, 0),
    coalesce(bs.barber_ids, array[]::uuid[]),
    o.observed_minutes,
    o.sample_count,
    -- Part du DÉCLARÉ dans l'estimation montrée au client, en pourcentage :
    -- 100 % tant qu'il y a moins de 5 mesures, puis décroissante jusqu'à
    -- 0 % à 20 mesures. C'est ce nombre qui permet de dire honnêtement au
    -- professionnel si changer la durée déclarée change encore quelque chose.
    case
      when coalesce(o.sample_count, 0) < 5 or o.observed_minutes is null then 100
      else greatest(0, 100 - least(100, round(((o.sample_count - 4)::numeric / 16.0) * 100)))::integer
    end,
    exists (select 1 from public.appointments a where a.service_id = s.id)
      or exists (select 1 from public.queue_entries q where q.service_id = s.id)
      or exists (select 1 from public.service_duration_samples d where d.service_id = s.id)
      or exists (select 1 from public.post_services ps where ps.service_id = s.id),
    s.created_at
  from public.services s
  left join public.service_categories c on c.id = s.category_id
  left join lateral (
    select count(*)::integer as barber_count,
           array_agg(b.barber_id order by b.barber_id) as barber_ids
    from public.barber_services b where b.service_id = s.id
  ) bs on true
  cross join lateral private.observed_service_duration(s.id, null, null) o
  where s.organization_id = p_organization_id
    and (p_include_archived or s.archived_at is null)
  order by s.archived_at nulls first, s.name;
end;
$$;

comment on function public.list_organization_services(uuid, boolean) is
  'Le catalogue d''une organisation pour l''écran pro : état réel (active/draft/inactive/archived), affectations barber, durée observée contre durée déclarée, et présence d''un historique (qui interdit la suppression). Tout membre de l''organisation lit ; les écritures ont leurs propres gardes.';

revoke all on function public.list_organization_services(uuid, boolean) from public, anon;
grant execute on function public.list_organization_services(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La garde de rôle du catalogue
-- ---------------------------------------------------------------------------

create or replace function private.assert_catalog_author(
  p_organization_id uuid,
  p_price_cents integer,
  out can_price boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_manager boolean;
  v_is_barber boolean;
begin
  if p_organization_id is null then
    raise exception 'not authorized to change this catalogue'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  v_is_manager := (select private.has_org_role(p_organization_id,
                     array['owner', 'manager']::public.membership_role[]));
  v_is_barber  := (select private.has_org_role(p_organization_id,
                     array['barber']::public.membership_role[]));

  -- Le réceptionniste n'édite pas le catalogue : ce n'est pas son métier, et
  -- « ce qui n'est pas permis n'est pas rendu » (P1PRO §0bis) le lui cache.
  if not v_is_manager and not v_is_barber then
    raise exception 'not authorized to change this catalogue'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  -- LA GARDE DU PRIX. Elle REFUSE, elle n'ignore pas : un barber qui envoie
  -- un prix reçoit un motif, pas un succès silencieux qui lui ferait croire
  -- que son tarif est passé.
  if p_price_cents is not null and not v_is_manager then
    raise exception 'a barber may edit a service but never its price'
      using errcode = '42501',
            detail = 'fadeup_service_refusal=price_forbidden_for_role',
            hint = 'Le prix est réservé au propriétaire et au manager. Renvoyez la demande sans le champ prix.';
  end if;

  can_price := v_is_manager;
end;
$$;

comment on function private.assert_catalog_author(uuid, integer) is
  'Garde commune du catalogue : owner/manager écrivent tout, un barber écrit tout SAUF le prix (refus nommé, jamais un champ ignoré), le réceptionniste n''écrit rien. Rend can_price pour que l''appelant sache s''il peut activer un service.';

revoke all on function private.assert_catalog_author(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Créer, modifier, tarifer
-- ---------------------------------------------------------------------------

create or replace function public.create_service(
  p_organization_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_price_cents integer default null,
  p_description text default null,
  p_category_id uuid default null,
  p_location_ids uuid[] default null
)
returns public.services
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_can_price boolean;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.services;
  v_location_id uuid;
begin
  select ac.can_price into v_can_price
  from private.assert_catalog_author(p_organization_id, p_price_cents) ac;

  if v_name is null then
    raise exception 'a service needs a name'
      using errcode = '22023', detail = 'fadeup_service_refusal=name_required';
  end if;

  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'a service needs a positive duration'
      using errcode = '22023', detail = 'fadeup_service_refusal=duration_required';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.service_categories c
    where c.id = p_category_id and c.organization_id = p_organization_id
  ) then
    raise exception 'category does not belong to this organization'
      using errcode = '22023', detail = 'fadeup_service_refusal=category_foreign';
  end if;

  if v_can_price and p_price_cents is null then
    raise exception 'a service created by an owner or manager needs a price'
      using errcode = '22023', detail = 'fadeup_service_refusal=price_required';
  end if;

  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'a price cannot be negative'
      using errcode = '22023', detail = 'fadeup_service_refusal=price_negative';
  end if;

  insert into public.services (
    organization_id, name, description, category_id,
    duration_minutes, price_cents, is_active, price_pending
  )
  values (
    p_organization_id, v_name, nullif(btrim(coalesce(p_description, '')), ''), p_category_id,
    p_duration_minutes,
    coalesce(p_price_cents, 0),
    v_can_price,              -- un brouillon de barber naît inactif
    not v_can_price
  )
  returning * into v_row;

  -- SANS ligne service_locations, le service n'est réservable nulle part :
  -- ni le tunnel public, ni get_available_slots, ni l'agenda ne le voient.
  -- NULL vaut donc « partout », jamais « nulle part ».
  if p_location_ids is null then
    insert into public.service_locations (organization_id, service_id, location_id)
    select p_organization_id, v_row.id, l.id
    from public.locations l
    where l.organization_id = p_organization_id
    on conflict do nothing;
  else
    if exists (
      select 1 from unnest(p_location_ids) as requested(location_id)
      where not exists (
        select 1 from public.locations l
        where l.id = requested.location_id and l.organization_id = p_organization_id
      )
    ) then
      raise exception 'every location must belong to this organization'
        using errcode = '22023', detail = 'fadeup_service_refusal=location_foreign';
    end if;
    foreach v_location_id in array p_location_ids loop
      insert into public.service_locations (organization_id, service_id, location_id)
      values (p_organization_id, v_row.id, v_location_id)
      on conflict do nothing;
    end loop;
  end if;

  return v_row;
end;
$$;

comment on function public.create_service(uuid, text, integer, integer, text, uuid, uuid[]) is
  'Crée un service. owner/manager : prix obligatoire, service actif. barber : AUCUN prix accepté (refus nommé si le champ est présent), le service naît brouillon — inactif, price_pending — donc absent de toute surface publique jusqu''à ce qu''un gestionnaire le tarife. p_location_ids à NULL = TOUS les établissements : sans ligne service_locations un service n''est réservable nulle part, et ce défaut évite le service fantôme.';

revoke all on function public.create_service(uuid, text, integer, integer, text, uuid, uuid[]) from public, anon;
grant execute on function public.create_service(uuid, text, integer, integer, text, uuid, uuid[]) to authenticated;


create or replace function public.update_service(
  p_service_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_description text default null,
  p_category_id uuid default null,
  p_price_cents integer default null
)
returns public.services
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_can_price boolean;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.services;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null then
    raise exception 'not authorized to change this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  select ac.can_price into v_can_price
  from private.assert_catalog_author(v_service.organization_id, p_price_cents) ac;

  if v_service.archived_at is not null then
    raise exception 'an archived service cannot be edited; restore it first'
      using errcode = '22023', detail = 'fadeup_service_refusal=archived';
  end if;

  if v_name is null then
    raise exception 'a service needs a name'
      using errcode = '22023', detail = 'fadeup_service_refusal=name_required';
  end if;

  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'a service needs a positive duration'
      using errcode = '22023', detail = 'fadeup_service_refusal=duration_required';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.service_categories c
    where c.id = p_category_id and c.organization_id = v_service.organization_id
  ) then
    raise exception 'category does not belong to this organization'
      using errcode = '22023', detail = 'fadeup_service_refusal=category_foreign';
  end if;

  if p_price_cents is not null and p_price_cents < 0 then
    raise exception 'a price cannot be negative'
      using errcode = '22023', detail = 'fadeup_service_refusal=price_negative';
  end if;

  update public.services s
     set name = v_name,
         duration_minutes = p_duration_minutes,
         description = nullif(btrim(coalesce(p_description, '')), ''),
         category_id = p_category_id,
         -- Le prix ne bouge QUE si l'appelant avait le droit de l'envoyer.
         price_cents = case when p_price_cents is not null then p_price_cents else s.price_cents end,
         price_pending = case when p_price_cents is not null then false else s.price_pending end
   where s.id = p_service_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_service(uuid, text, integer, text, uuid, integer) is
  'Modifie un service. `p_description` et `p_category_id` sont APPLIQUÉS tels quels (null efface). `p_price_cents` est optionnel : absent = prix inchangé ; présent chez un barber = REFUS nommé (fadeup_service_refusal=price_forbidden_for_role), jamais un champ ignoré en silence.';

revoke all on function public.update_service(uuid, text, integer, text, uuid, integer) from public, anon;
grant execute on function public.update_service(uuid, text, integer, text, uuid, integer) to authenticated;


create or replace function public.set_service_price(p_service_id uuid, p_price_cents integer)
returns public.services
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_row public.services;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null then
    raise exception 'not authorized to price this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'a price of zero or more is required'
      using errcode = '22023', detail = 'fadeup_service_refusal=price_required';
  end if;

  -- La même garde : un barber qui appelle CETTE RPC envoie forcément un prix,
  -- donc il est refusé par le même motif que sur update_service.
  perform private.assert_catalog_author(v_service.organization_id, p_price_cents);

  update public.services s
     set price_cents = p_price_cents,
         price_pending = false,
         -- Tarifer un brouillon le rend publiable ; un service archivé le
         -- reste (on ne ressuscite pas par un prix).
         is_active = case when s.archived_at is null and s.price_pending then true else s.is_active end
   where s.id = p_service_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_service_price(uuid, integer) is
  'Fixe le prix d''un service. Propriétaire et manager seulement. Tarifer un brouillon de barber l''active — c''est le geste qui termine la création à deux mains.';

revoke all on function public.set_service_price(uuid, integer) from public, anon;
grant execute on function public.set_service_price(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Archiver, restaurer, supprimer
-- ---------------------------------------------------------------------------

create or replace function public.archive_service(p_service_id uuid)
returns public.services
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_row public.services;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null
     or not (select private.has_org_role(v_service.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to archive this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  update public.services s
     set is_active = false, archived_at = coalesce(s.archived_at, now())
   where s.id = p_service_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.archive_service(uuid) is
  'Archive un service : il sort du catalogue et de toute surface publique, son historique reste intact. C''est le geste qui remplace la suppression.';

revoke all on function public.archive_service(uuid) from public, anon;
grant execute on function public.archive_service(uuid) to authenticated;


create or replace function public.restore_service(p_service_id uuid)
returns public.services
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_row public.services;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null
     or not (select private.has_org_role(v_service.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to restore this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  update public.services s
     set archived_at = null,
         -- Un brouillon restauré reste un brouillon : il lui manque toujours
         -- un prix.
         is_active = not s.price_pending
   where s.id = p_service_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.restore_service(uuid) is
  'Sort un service de l''archive. Un service sans prix (price_pending) reste inactif : il lui manque toujours un prix.';

revoke all on function public.restore_service(uuid) from public, anon;
grant execute on function public.restore_service(uuid) to authenticated;


create or replace function public.delete_service(p_service_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_appointments integer;
  v_queue integer;
  v_samples integer;
  v_posts integer;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null
     or not (select private.has_org_role(v_service.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to delete this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  select count(*) into v_appointments from public.appointments a where a.service_id = p_service_id;
  select count(*) into v_queue       from public.queue_entries q where q.service_id = p_service_id;
  select count(*) into v_samples     from public.service_duration_samples d where d.service_id = p_service_id;
  select count(*) into v_posts       from public.post_services ps where ps.service_id = p_service_id;

  -- La clé étrangère des rendez-vous est déjà en RESTRICT ; les entrées de
  -- file sont en SET NULL et les mesures de durée en CASCADE. Sans ce refus,
  -- supprimer un service effacerait en silence ce que FadeUp a appris de sa
  -- durée réelle, et détacherait un passage de file de sa prestation.
  if v_appointments + v_queue + v_samples + v_posts > 0 then
    raise exception 'this service has history and cannot be deleted; archive it instead'
      using errcode = '23503',
            detail = format('fadeup_service_refusal=has_history appointments=%s queue=%s samples=%s posts=%s',
                            v_appointments, v_queue, v_samples, v_posts),
            hint = 'Archivez le service : un rendez-vous passé doit garder sa prestation.';
  end if;

  delete from public.services s where s.id = p_service_id;
end;
$$;

comment on function public.delete_service(uuid) is
  'Supprime définitivement un service NEUF, sans aucun historique. Dès qu''un rendez-vous, un passage de file, une mesure de durée ou une publication le référence, la RPC refuse en le disant et renvoie vers l''archivage.';

revoke all on function public.delete_service(uuid) from public, anon;
grant execute on function public.delete_service(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Qui fait quoi — l'affectation aux barbers
-- ---------------------------------------------------------------------------

create or replace function public.set_service_barbers(p_service_id uuid, p_barber_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_ids uuid[] := coalesce(p_barber_ids, array[]::uuid[]);
  v_foreign integer;
  v_count integer;
begin
  select * into v_service from public.services s where s.id = p_service_id;

  if v_service.id is null
     or not (select private.has_org_role(v_service.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to assign this service'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  select count(*) into v_foreign
  from unnest(v_ids) as requested(barber_id)
  where not exists (
    select 1 from public.barbers b
    where b.id = requested.barber_id and b.organization_id = v_service.organization_id
  );

  if v_foreign > 0 then
    raise exception 'every barber must belong to this organization'
      using errcode = '22023', detail = 'fadeup_service_refusal=barber_foreign';
  end if;

  delete from public.barber_services bs
   where bs.service_id = p_service_id
     and not (bs.barber_id = any (v_ids));

  insert into public.barber_services (organization_id, barber_id, service_id)
  select v_service.organization_id, requested.barber_id, p_service_id
  from unnest(v_ids) as requested(barber_id)
  on conflict do nothing;

  select count(*)::integer into v_count
  from public.barber_services bs where bs.service_id = p_service_id;

  return v_count;
end;
$$;

comment on function public.set_service_barbers(uuid, uuid[]) is
  'Remplace la liste des barbers qui exécutent un service. Propriétaire et manager. Une liste vide signifie « tout le monde » côté disponibilité (barber_services vide = pas de restriction), et c''est dit dans l''interface.';

revoke all on function public.set_service_barbers(uuid, uuid[]) from public, anon;
grant execute on function public.set_service_barbers(uuid, uuid[]) to authenticated;


create or replace function public.create_service_category(p_organization_id uuid, p_name text)
returns public.service_categories
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_row public.service_categories;
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to change this catalogue'
      using errcode = '42501', detail = 'fadeup_service_refusal=not_authorized';
  end if;

  if v_name is null then
    raise exception 'a category needs a name'
      using errcode = '22023', detail = 'fadeup_service_refusal=name_required';
  end if;

  select * into v_row
  from public.service_categories c
  where c.organization_id = p_organization_id
    and lower(btrim(c.name)) = lower(v_name)
  limit 1;

  if v_row.id is not null then
    return v_row;      -- idempotent : deux clics ne font pas deux catégories
  end if;

  insert into public.service_categories (organization_id, name, display_order)
  values (p_organization_id, v_name,
          coalesce((select max(c.display_order) + 1 from public.service_categories c
                    where c.organization_id = p_organization_id), 0))
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_service_category(uuid, text) is
  'Crée (ou retrouve) une catégorie de services. Idempotent sur le nom, insensible à la casse : deux clics ne font pas deux catégories.';

revoke all on function public.create_service_category(uuid, text) from public, anon;
grant execute on function public.create_service_category(uuid, text) to authenticated;

commit;
