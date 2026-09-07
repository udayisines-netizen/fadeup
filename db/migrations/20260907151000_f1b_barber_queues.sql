-- FadeUp — F1b chantier 1 : une file par barber, plus « premier disponible ».
--
-- Décisions (F1b §2, détaillées au rapport F1B) :
--
--   * Une entrée SANS barber choisi (« premier disponible ») constitue SA
--     PROPRE file — sa position se calcule parmi les entrées sans barber.
--     Elle n'est jamais comptée dans la file d'un barber nommé : elle ne
--     peut pas être dans une file et dans toutes à la fois.
--   * Doctrine de service : un barber sert d'abord SA file, puis « premier
--     disponible ». C'est ce qui rend la position dans une file de barber
--     honnête : le premier de la file d'Amine est bien le prochain
--     qu'Amine prend.
--   * Un barber peut ne pas avoir de file (apprenti, remplaçant) :
--     barbers.queue_enabled, géré par owner/manager. Un barber sans file
--     n'apparaît pas côté client et join_public_queue le refuse avec le
--     motif nommé barber_queue_disabled.
--   * Le déplacement d'un client entre files est ouvert au propriétaire, au
--     manager, au réceptionniste ET au barber (c'est lui qui dit « va chez
--     Amine ») — RPC move_queue_entry, tracé dans queue_entry_moves : qui,
--     quand, d'où, vers où. L'entrée déplacée GARDE son created_at : un
--     client déplacé par le salon conserve son ancienneté.
--
-- Appliquer en tant que POSTGRES.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- Le réglage par barber.
-- ---------------------------------------------------------------------------

alter table public.barbers
  add column queue_enabled boolean not null default true;

comment on column public.barbers.queue_enabled is
  'Ce barber expose-t-il une file d''attente ? true par défaut (tout barber réservable prend des walk-ins, comportement F1 inchangé). false : n''apparaît pas dans la liste des files côté client, join_public_queue refuse une entrée vers lui (barber_queue_disabled), un déplacement vers lui est refusé. Géré par owner/manager via set_barber_queue_enabled.';

create function public.set_barber_queue_enabled(p_barber_id uuid, p_enabled boolean)
returns public.barbers
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_row public.barbers;
begin
  if p_enabled is null then
    raise exception 'p_enabled is required' using errcode = '22023';
  end if;

  select b.organization_id into v_organization_id
  from public.barbers b where b.id = p_barber_id;

  if v_organization_id is null
     or not (select private.has_org_role(v_organization_id, array['owner', 'manager']::public.membership_role[])) then
    -- « C'est le propriétaire qui gère » (F1b §2) — manager inclus, comme
    -- pour tout réglage d'exploitation déléguable.
    raise exception 'not authorized to manage this barber''s queue'
      using errcode = '42501';
  end if;

  update public.barbers b
     set queue_enabled = p_enabled
   where b.id = p_barber_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_barber_queue_enabled(uuid, boolean) is
  'Owner/manager : active ou coupe la file d''un barber. Les clients DÉJÀ dans sa file ne sont pas touchés (même principe que la fermeture de file) — le comptoir les déplace ou les sert.';

-- ---------------------------------------------------------------------------
-- La position se calcule DANS la file du barber, pas sur tout le lieu.
-- Retour enrichi de barber_id (le client regroupe par file). DROP puis
-- CREATE : le type de retour change.
-- ---------------------------------------------------------------------------

drop function public.get_public_queue_status(text, uuid);

create function public.get_public_queue_status(p_organization_slug text, p_location_id uuid)
returns table(
  id uuid,
  display_name text,
  status public.queue_status,
  queue_position integer,
  barber_id uuid,
  barber_display_name text
)
  language sql stable security definer
  set search_path to ''
as $$
  select
    q.id,
    btrim(split_part(q.customer_name, ' ', 1))
      || case when position(' ' in btrim(q.customer_name)) > 0
              then ' ' || left(split_part(q.customer_name, ' ', 2), 1) || '.'
              else '' end as display_name,
    q.status,
    case when q.status = 'waiting' then
      -- LA correction F1b : partition PAR FILE. Le sentinelle uuid zéro tient
      -- lieu de « premier disponible » (aucun barber ne porte cet id).
      row_number() over (
        partition by (q.status = 'waiting'), coalesce(q.barber_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by q.created_at
      )::integer
    else null end as queue_position,
    q.barber_id,
    sp.display_name as barber_display_name
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where o.slug = p_organization_slug
    and q.location_id = p_location_id
    and q.status in ('waiting', 'called', 'in_service')
  order by
    case q.status when 'in_service' then 0 when 'called' then 1 else 2 end,
    q.created_at;
$$;

comment on function public.get_public_queue_status(text, uuid) is
  'Anon-callable : le tableau public de la file d''un lieu — prénom + initiale, état, et position calculée DANS LA FILE DU BARBER (les entrées « premier disponible » forment leur propre file, F1b §2). Jamais d''identité complète.';

-- Le DROP a détruit l'ACL ; l'ACL par défaut du schéma la recrée à
-- l'identique (anon + authenticated + service_role), on la fixe
-- explicitement pour ne pas dépendre du défaut.
revoke execute on function public.get_public_queue_status(text, uuid) from public;
grant execute on function public.get_public_queue_status(text, uuid) to anon, authenticated, service_role;

-- Même correction de partition pour la file du client connecté (signature
-- inchangée : CREATE OR REPLACE suffit, l'ACL est conservée).
create or replace function public.get_my_queue_status()
returns table(
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  status public.queue_status,
  queue_position integer,
  barber_display_name text,
  created_at timestamp with time zone
)
  language sql stable security definer
  set search_path to ''
as $$
  with waiting_positions as (
    select qe.id,
           row_number() over (
             partition by qe.location_id,
                          coalesce(qe.barber_id, '00000000-0000-0000-0000-000000000000'::uuid)
             order by qe.created_at
           ) as position
    from public.queue_entries qe
    where qe.status = 'waiting'
  )
  select
    q.id,
    q.organization_id,
    o.name,
    o.slug,
    q.location_id,
    l.name,
    q.status,
    case when q.status = 'waiting' then wp.position::integer else null end,
    sp.display_name,
    q.created_at
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  join public.locations l on l.id = q.location_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join waiting_positions wp on wp.id = q.id
  where q.status in ('waiting', 'called', 'in_service')
    and q.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  order by q.created_at;
$$;

-- ---------------------------------------------------------------------------
-- La liste publique des files d'un établissement : « premier disponible »
-- EN TÊTE, puis les barbers du plus court au plus long.
-- ---------------------------------------------------------------------------

create function public.list_public_queues(p_organization_slug text, p_location_id uuid)
returns table(
  barber_id uuid,
  display_name text,
  avatar_url text,
  waiting_count integer,
  busy boolean,
  estimated_wait_minutes integer
)
  language sql stable security definer
  set search_path to ''
as $$
  with org as (
    select o.id from public.organizations o where o.slug = p_organization_slug
  ),
  loc as (
    select l.id from public.locations l
    join org on org.id = l.organization_id
    where l.id = p_location_id and l.is_active and l.kind = 'physical_address'
  ),
  barbers as (
    select b.id, sp.display_name, sp.avatar_url
    from public.barbers b
    join org on org.id = b.organization_id
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join loc on loc.id = sp.location_id
    where b.is_bookable and b.queue_enabled and sp.is_active and sp.is_public
  ),
  counts as (
    select coalesce(qe.barber_id, '00000000-0000-0000-0000-000000000000'::uuid) as file_key,
           count(*) filter (where qe.status = 'waiting')::integer as waiting,
           bool_or(qe.status = 'in_service') as busy
    from public.queue_entries qe
    join loc on loc.id = qe.location_id
    where qe.status in ('waiting', 'called', 'in_service')
    group by 1
  )
  select q.barber_id, q.display_name, q.avatar_url, q.waiting_count, q.busy, q.estimated_wait_minutes
  from (
    -- « Premier disponible » en tête : beaucoup de clients veulent juste
    -- être servis — le choix du barber est une possibilité, pas une
    -- obligation.
    select
      0 as tier,
      null::uuid as barber_id,
      null::text as display_name,
      null::text as avatar_url,
      coalesce(c.waiting, 0) as waiting_count,
      coalesce(c.busy, false) as busy,
      private.queue_wait_minutes(loc.id, null) as estimated_wait_minutes
    from loc
    left join counts c on c.file_key = '00000000-0000-0000-0000-000000000000'::uuid
    union all
    select
      1,
      b.id,
      b.display_name,
      b.avatar_url,
      coalesce(c.waiting, 0),
      coalesce(c.busy, false),
      private.queue_wait_minutes((select loc.id from loc), b.id)
    from barbers b
    left join counts c on c.file_key = b.id
  ) q
  -- Tri : nombre de personnes en attente, du plus court au plus long ; un
  -- barber sans attente ET sans client au fauteuil passe devant.
  order by q.tier asc, q.waiting_count asc, q.busy asc, q.display_name asc;
$$;

comment on function public.list_public_queues(text, uuid) is
  'Anon-callable : les files d''un établissement — « premier disponible » en tête, puis chaque barber à file active (queue_enabled + réservable + public), triés par nombre de personnes EN ATTENTE (un fait, pas une prédiction). estimated_wait_minutes vient de l''estimateur F1b et vaut NULL tant qu''il n''est pas fiable — dont la file « premier disponible » d''un salon à plusieurs barbers. Zéro ligne si le lieu n''existe pas, est inactif ou est une zone de service.';

revoke execute on function public.list_public_queues(text, uuid) from public;
grant execute on function public.list_public_queues(text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- join_public_queue : refus nommé pour un barber sans file. Corps identique
-- à B1 pour tout le reste — seule la garde barber change.
-- ---------------------------------------------------------------------------

create or replace function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null,
  p_check_in_token text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns table(id uuid, status public.queue_status, created_at timestamp with time zone)
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
  v_user_id uuid;
  v_customer_id uuid;
  v_location public.locations;
  v_geofence_meters integer;
  v_distance_meters double precision;
  v_waiting integer;
  v_capacity integer;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.* into v_location
  from public.locations l
  where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;

  if not found then
    raise exception 'location is not available';
  end if;

  -- (a) A zone has no queue. Decided and explained in this file's header.
  if v_location.kind = 'service_area' then
    raise exception 'this professional works in a service area and has no live queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=service_area_has_no_queue',
            hint = 'A live queue is a line of people at an address. Book a slot instead.';
  end if;

  -- (b) The QR token. Compared against THIS establishment's value, so a token
  -- scanned in one shop cannot be replayed against another.
  if nullif(btrim(coalesce(p_check_in_token, '')), '') is null
     or lower(btrim(p_check_in_token)) <> v_location.queue_check_in_token then
    raise exception 'the check-in code for this establishment is missing or invalid'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=invalid_check_in_token',
            hint = 'Scan the QR code displayed in the shop.';
  end if;

  -- (c) The geofence, measured here and nowhere else. A client that computes
  -- its own distance and sends a verdict is a client that can send true.
  if v_location.latitude is null or v_location.longitude is null then
    raise exception 'this establishment has not published its position, so presence cannot be verified'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=location_not_geolocated',
            hint = 'The establishment must set its coordinates before the live queue can admit anyone.';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'your position is required to join the queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=position_required',
            hint = 'Joining a live queue requires being at the shop.';
  end if;

  select s.queue_geofence_meters into v_geofence_meters
  from public.location_service_settings s
  where s.location_id = p_location_id;
  v_geofence_meters := coalesce(v_geofence_meters, 150);

  v_distance_meters := private.point_distance_km(
    p_latitude, p_longitude, v_location.latitude, v_location.longitude
  ) * 1000.0;

  if v_distance_meters is null or v_distance_meters > v_geofence_meters then
    raise exception 'you are too far from this establishment to join its queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=too_far',
            hint = format('The live queue admits customers within %s m.', v_geofence_meters);
  end if;

  if p_barber_id is not null then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      where b.id = p_barber_id
        and b.organization_id = v_organization_id
        and b.is_bookable
        and sp.is_active
        and sp.is_public
    ) then
      raise exception 'requested barber is not available';
    end if;

    -- F1b : un barber peut ne pas avoir de file. Motif DISTINCT — ce n'est
    -- ni « file fermée » (le salon en a d'autres) ni « barber inconnu ».
    if not exists (
      select 1 from public.barbers b
      where b.id = p_barber_id and b.queue_enabled
    ) then
      raise exception 'this barber does not take a walk-in queue'
        using errcode = '42501',
              detail = 'fadeup_queue_refusal=barber_queue_disabled',
              hint = 'Join the first-available queue or pick another barber.';
    end if;
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  -- (d) Is the line open at all. The enforce_queue_service_mode trigger checks
  -- this too and is the guarantee; asking here turns its generic refusal into
  -- one of the named codes P2 can branch on.
  if not private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id) then
    raise exception 'this queue is not accepting new entries right now'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_closed';
  end if;

  -- (e) Capacity.
  v_waiting  := private.queue_waiting_count(p_location_id, p_barber_id);
  v_capacity := private.queue_capacity(p_location_id, p_barber_id);
  if v_capacity is not null and v_waiting >= v_capacity then
    raise exception 'this queue is full'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_full',
            hint = format('%s people are already waiting.', v_waiting);
  end if;

  v_user_id := (select auth.uid());

  -- (f) One line at a time. A signed-in customer is matched on their account,
  -- which is exact. An anonymous kiosk check-in can only be matched on the
  -- phone number they typed, at this establishment — weaker, and honestly so:
  -- an anonymous customer who gives a different number each time is not
  -- detectable here, and the QR plus the geofence are what stand in the way.
  if v_user_id is not null and exists (
    select 1 from public.queue_entries qe
    where qe.booked_by_user_id = v_user_id
      and qe.status in ('waiting', 'called', 'in_service')
  ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  if v_user_id is null
     and nullif(btrim(coalesce(p_customer_phone, '')), '') is not null
     and exists (
       select 1 from public.queue_entries qe
       where qe.location_id = p_location_id
         and qe.customer_phone = btrim(p_customer_phone)
         and qe.status in ('waiting', 'called', 'in_service')
     ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision) is
  'Anon-callable. Joins the live queue of an establishment, and since B1 requires PROOF OF PRESENCE to do it: the QR token displayed in the shop plus coordinates within the establishment''s geofence (150 m by default, per-salon). Both are verified on the server, so calling the REST API directly is exactly as constrained as using the app. Both are also defeatable by a determined person — a photographed QR, a spoofed position — and nothing downstream should treat a queue entry as evidence that someone was physically present. Refusals carry DETAIL fadeup_queue_refusal=<code>: service_area_has_no_queue, invalid_check_in_token, location_not_geolocated, position_required, too_far, barber_queue_disabled (F1b), queue_closed, queue_full, already_in_queue.';

-- ---------------------------------------------------------------------------
-- La trace des déplacements : qui, quand, d'où, vers où.
-- ---------------------------------------------------------------------------

create table public.queue_entry_moves (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  entry_id uuid not null references public.queue_entries(id) on delete cascade,
  -- Renseigné pour un changement à l'initiative du client (F1b : annulation
  -- + réinsertion en fin de nouvelle file) : l'entrée qui remplace.
  new_entry_id uuid references public.queue_entries(id) on delete set null,
  from_barber_id uuid references public.barbers(id) on delete set null,
  to_barber_id uuid references public.barbers(id) on delete set null,
  kind text not null,
  moved_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint queue_entry_moves_kind_valid check (kind in ('staff_move', 'customer_change'))
);

comment on table public.queue_entry_moves is
  'Trace d''audit des déplacements entre files (F1b §2) : qui (moved_by, NULL = client anonyme), quand, d''où (from_barber_id, NULL = premier disponible), vers où. kind = staff_move (le salon déplace, l''entrée garde son ancienneté) ou customer_change (le client change, son entrée est annulée et réinsérée en fin de nouvelle file — new_entry_id). Jamais écrite par un client : RPC seulement.';

create index queue_entry_moves_entry_idx on public.queue_entry_moves (entry_id);
create index queue_entry_moves_location_idx on public.queue_entry_moves (location_id, created_at desc);

alter table public.queue_entry_moves enable row level security;
alter table public.queue_entry_moves force row level security;

create policy queue_entry_moves_select on public.queue_entry_moves
  for select using ((select private.is_org_member(organization_id)));

revoke all on table public.queue_entry_moves from anon;
revoke all on table public.queue_entry_moves from authenticated;
grant select on table public.queue_entry_moves to authenticated;

-- ---------------------------------------------------------------------------
-- Le barber de l'organisation, quel qu'il soit : le droit de déplacer.
-- ---------------------------------------------------------------------------

create function private.is_org_barber(p_organization_id uuid) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.organization_id = p_organization_id
      and sp.user_id = (select auth.uid())
      and sp.is_active
  );
$$;

comment on function private.is_org_barber(uuid) is
  'L''appelant est-il un barber ACTIF de cette organisation ? Résolu depuis auth.uid(), jamais depuis un id fourni. Fonde le droit de déplacement F1b : en pratique c''est le barber qui dit « va chez Amine, il est libre » — un droit réservé au patron serait ignoré.';

revoke execute on function private.is_org_barber(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Le déplacement côté salon.
-- ---------------------------------------------------------------------------

create function public.move_queue_entry(p_entry_id uuid, p_to_barber_id uuid default null)
returns table(id uuid, status public.queue_status, barber_id uuid)
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_entry public.queue_entries;
  v_from_barber_id uuid;
begin
  select qe.* into v_entry from public.queue_entries qe where qe.id = p_entry_id;

  if not found then
    raise exception 'queue entry not found' using errcode = '42501';
  end if;

  v_from_barber_id := v_entry.barber_id;

  if not (
    (select private.has_org_role(v_entry.organization_id,
       array['owner', 'manager', 'receptionist']::public.membership_role[]))
    or (select private.is_org_barber(v_entry.organization_id))
  ) then
    raise exception 'not authorized to move queue entries for this organization'
      using errcode = '42501';
  end if;

  if v_entry.status <> 'waiting' then
    -- Un client appelé ou au fauteuil est déjà engagé avec un barber ; le
    -- déplacer serait réécrire l'histoire. Décision F1b, documentée.
    raise exception 'only a waiting entry can be moved to another queue'
      using errcode = '22023';
  end if;

  if p_to_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_to_barber_id
      and b.organization_id = v_entry.organization_id
      and b.is_bookable and b.queue_enabled
      and sp.is_active
  ) then
    raise exception 'target barber does not take a walk-in queue'
      using errcode = '22023';
  end if;

  if p_to_barber_id is not distinct from v_entry.barber_id then
    return query select v_entry.id, v_entry.status, v_entry.barber_id;
    return;
  end if;

  -- Le trigger restrict_queue_entry_self_update interdit à un barber de
  -- changer barber_id en direct ; ce drapeau transaction-local dit « la RPC
  -- a déjà autorisé » (même motif que fadeup.appointment_reschedule).
  perform set_config('fadeup.queue_move', '1', true);

  update public.queue_entries qe
     set barber_id = p_to_barber_id
   where qe.id = p_entry_id
  returning * into v_entry;

  insert into public.queue_entry_moves
    (organization_id, location_id, entry_id, from_barber_id, to_barber_id, kind, moved_by)
  values
    (v_entry.organization_id, v_entry.location_id, v_entry.id,
     v_from_barber_id, p_to_barber_id, 'staff_move', (select auth.uid()));

  return query select v_entry.id, v_entry.status, v_entry.barber_id;
end;
$$;

comment on function public.move_queue_entry(uuid, uuid) is
  'Owner, manager, réceptionniste OU barber de l''organisation : déplace une entrée EN ATTENTE vers la file d''un autre barber (NULL = premier disponible). L''entrée garde son created_at — un client déplacé par le salon conserve son ancienneté dans la nouvelle file. Tracé dans queue_entry_moves. Un client appelé ou au fauteuil ne se déplace pas.';

revoke execute on function public.move_queue_entry(uuid, uuid) from public, anon;
grant execute on function public.move_queue_entry(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_barber_queue_enabled(uuid, boolean) to authenticated, service_role;
revoke execute on function public.set_barber_queue_enabled(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Le trigger de restriction apprend le drapeau du déplacement.
-- ---------------------------------------------------------------------------

create or replace function public.restrict_queue_entry_self_update() returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  -- Une RPC de déplacement F1b (move_queue_entry) a déjà vérifié le droit —
  -- y compris pour un barber qui déplace vers un CONFRÈRE, ce que la règle
  -- ci-dessous interdit à raison en accès direct.
  if coalesce(current_setting('fadeup.queue_move', true), '') = '1' then
    return new;
  end if;

  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$$;

commit;
