-- FadeUp — F1b chantiers 3 et 4 (+ le volet client du chantier 1) :
-- quitter la file, suivre sa propre entrée avec échéance, changer de barber.
--
-- MODÈLE D'AUTORISATION (F1b §4, le modèle du claim_token de B2) :
-- l'identifiant d'entrée est un uuid non devinable retourné AU SEUL CRÉATEUR
-- par join_public_queue — il fait office de capacité pour le client anonyme
-- du mode kiosque. Pour une entrée rattachée à un compte
-- (booked_by_user_id NOT NULL), la capacité ne suffit pas : la session doit
-- correspondre. « Quitter/consulter celle d'un autre » est donc refusé pour
-- toute entrée de compte, et statistiquement impossible pour une entrée
-- anonyme (l'uuid n'est communiqué à personne d'autre).
--
-- CAS « DÉJÀ APPELÉ » (tranché, F1b §4) : oui, un client appelé peut encore
-- quitter — partir sans prévenir est pire que prévenir. L'interface exige
-- une confirmation explicite ; la base l'accepte. Au fauteuil : refusé.
--
-- COMPTE À REBOURS (F1b §5) : l'option retenue est la RPC DÉDIÉE
-- get_queue_entry_tracking(p_entry_id) plutôt que l'extension de
-- get_my_queue_status — elle couvre aussi le client anonyme du mode kiosque,
-- qui est exactement celui qui n'a pas d'autre canal. Elle renvoie
-- l'ÉCHÉANCE ABSOLUE UTC (called_deadline_at), calculée serveur — JAMAIS la
-- durée de grâce brute : un client n'a pas à connaître le réglage du salon.
--
-- CHANGER DE BARBER (F1b §2) : à l'initiative du client uniquement — aucune
-- proposition automatique. Le changement ANNULE l'entrée et en RÉINSÈRE une
-- en fin de nouvelle file (perte de place assumée et annoncée avant
-- confirmation) : created_at reste un fait de création, jamais muté.
--
-- Appliquer en tant que POSTGRES.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- La règle d'accès client, partagée par les trois RPC.
-- ---------------------------------------------------------------------------

create function private.queue_entry_client_access(p_entry public.queue_entries)
returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select case
    -- Entrée de compte : la session fait foi, la capacité ne suffit pas.
    -- COALESCE obligatoire : pour un appelant ANONYME auth.uid() est NULL,
    -- et « uuid = NULL » vaut NULL — que « if not ... » ne lève PAS. Sans le
    -- coalesce, un anonyme muni de l'uuid pouvait agir sur une entrée de
    -- compte (défaut attrapé par la suite e2e F1b, corrigé ici).
    when p_entry.booked_by_user_id is not null
      then coalesce(p_entry.booked_by_user_id = (select auth.uid()), false)
    -- Entrée anonyme (kiosque, comptoir) : posséder l'uuid EST la capacité.
    else true
  end;
$$;

comment on function private.queue_entry_client_access(public.queue_entries) is
  'La règle d''accès client aux RPC d''entrée de file (F1b §4) : une entrée de compte exige la session de son créateur ; une entrée anonyme est gouvernée par la possession de son uuid (modèle claim_token B2, retourné au seul créateur).';

revoke execute on function private.queue_entry_client_access(public.queue_entries) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quitter la file.
-- ---------------------------------------------------------------------------

create function public.leave_public_queue(p_entry_id uuid)
returns table(id uuid, status public.queue_status)
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_entry public.queue_entries;
begin
  select qe.* into v_entry
  from public.queue_entries qe
  where qe.id = p_entry_id
  for update;

  if not found then
    raise exception 'queue entry not found'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_not_found';
  end if;

  if not private.queue_entry_client_access(v_entry) then
    raise exception 'this queue entry belongs to another account'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=not_entry_owner';
  end if;

  if v_entry.status in ('completed', 'cancelled', 'no_show') then
    -- Jamais de transition depuis un état terminal — et un « déjà sorti »
    -- n'est pas une erreur dramatique côté client, juste un fait.
    raise exception 'this queue entry is already closed'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_already_closed';
  end if;

  if v_entry.status = 'in_service' then
    raise exception 'a service in progress cannot be left through the app'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_in_service';
  end if;

  -- waiting OU called -> cancelled. Le cas « appelé » est accepté : partir
  -- en prévenant vaut mieux que partir sans rien dire (décision F1b §4).
  update public.queue_entries qe
     set status = 'cancelled'
   where qe.id = p_entry_id
  returning qe.* into v_entry;

  return query select v_entry.id, v_entry.status;
end;
$$;

comment on function public.leave_public_queue(uuid) is
  'Anon-callable. Le client sort de la file lui-même (F1b §3) : l''uuid d''entrée fait capacité pour l''anonyme, la session fait foi pour une entrée de compte. waiting et called -> cancelled uniquement ; au fauteuil ou déjà clos : refus nommé. Refus via DETAIL fadeup_queue_refusal=<code> : entry_not_found, not_entry_owner, entry_already_closed, entry_in_service.';

revoke execute on function public.leave_public_queue(uuid) from public;
grant execute on function public.leave_public_queue(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Suivre sa propre entrée : position dans SA file, échéance d'appel,
-- estimation, et la nature d'une éventuelle sortie.
-- ---------------------------------------------------------------------------

create function public.get_queue_entry_tracking(p_entry_id uuid)
returns table(
  id uuid,
  status public.queue_status,
  barber_id uuid,
  barber_display_name text,
  queue_position integer,
  people_ahead integer,
  called_deadline_at timestamp with time zone,
  estimated_wait_minutes integer,
  removed_automatically boolean
)
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  v_entry public.queue_entries;
  v_position integer;
  v_grace integer;
begin
  select qe.* into v_entry from public.queue_entries qe where qe.id = p_entry_id;

  if not found then
    raise exception 'queue entry not found'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_not_found';
  end if;

  if not private.queue_entry_client_access(v_entry) then
    raise exception 'this queue entry belongs to another account'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=not_entry_owner';
  end if;

  if v_entry.status = 'waiting' then
    select count(*)::integer + 1 into v_position
    from public.queue_entries qe
    where qe.location_id = v_entry.location_id
      and qe.status = 'waiting'
      and qe.barber_id is not distinct from v_entry.barber_id
      and qe.created_at < v_entry.created_at;
  end if;

  if v_entry.status = 'called' and v_entry.called_at is not null then
    select s.queue_call_grace_minutes into v_grace
    from public.location_service_settings s
    where s.location_id = v_entry.location_id;
  end if;

  return query
  select
    v_entry.id,
    v_entry.status,
    v_entry.barber_id,
    sp.display_name,
    v_position,
    case when v_position is not null then v_position - 1 else null end,
    -- L'échéance ABSOLUE, en UTC — jamais la durée de grâce brute (F1b §5).
    case when v_entry.status = 'called' and v_entry.called_at is not null and v_grace is not null
         then v_entry.called_at + make_interval(mins => v_grace)
         else null end,
    case when v_entry.status = 'waiting'
         then private.queue_wait_minutes(v_entry.location_id, v_entry.barber_id, v_entry.created_at)
         else null end,
    v_entry.auto_marked_no_show_at is not null
  from (select 1) one
  left join public.barbers b on b.id = v_entry.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id;
end;
$$;

comment on function public.get_queue_entry_tracking(uuid) is
  'Anon-callable, gouvernée par la possession de l''uuid d''entrée (et la session pour une entrée de compte) : LA vue « votre place » du client — position dans SA file (F1b §2), personnes devant, échéance d''appel absolue UTC calculée serveur (jamais la durée de grâce brute), estimation d''attente (NULL = rien d''affichable), et removed_automatically pour distinguer un balayage de grâce d''un retrait par le salon. Un tiers sans l''uuid n''obtient rien ; un compte tiers est refusé (not_entry_owner).';

revoke execute on function public.get_queue_entry_tracking(uuid) from public;
grant execute on function public.get_queue_entry_tracking(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Changer de barber, à l'initiative du client.
-- ---------------------------------------------------------------------------

create function public.change_queue_entry_barber(p_entry_id uuid, p_to_barber_id uuid default null)
returns table(id uuid, status public.queue_status, created_at timestamp with time zone, barber_id uuid)
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_entry public.queue_entries;
  v_new public.queue_entries;
  v_waiting integer;
  v_capacity integer;
begin
  select qe.* into v_entry
  from public.queue_entries qe
  where qe.id = p_entry_id
  for update;

  if not found then
    raise exception 'queue entry not found'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_not_found';
  end if;

  if not private.queue_entry_client_access(v_entry) then
    raise exception 'this queue entry belongs to another account'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=not_entry_owner';
  end if;

  if v_entry.status <> 'waiting' then
    -- Un appelé ne « change » pas de barber : il est attendu. Il peut
    -- quitter (leave_public_queue) puis revenir par la porte normale.
    raise exception 'only a waiting entry can change queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=entry_not_waiting';
  end if;

  if p_to_barber_id is not distinct from v_entry.barber_id then
    raise exception 'this entry is already in that queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_that_queue';
  end if;

  if p_to_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_to_barber_id
      and b.organization_id = v_entry.organization_id
      and b.is_bookable and b.queue_enabled
      and sp.is_active and sp.is_public
  ) then
    raise exception 'this barber does not take a walk-in queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=barber_queue_disabled';
  end if;

  -- Toutes les portes AVANT d'annuler quoi que ce soit : si l'une refuse,
  -- l'entrée d'origine reste intacte (et de toute façon la transaction est
  -- atomique — un échec d'insertion annule aussi l'annulation).
  if not private.queue_admission_allowed(v_entry.organization_id, v_entry.location_id, p_to_barber_id) then
    raise exception 'this queue is not accepting new entries right now'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_closed';
  end if;

  v_waiting  := private.queue_waiting_count(v_entry.location_id, p_to_barber_id);
  v_capacity := private.queue_capacity(v_entry.location_id, p_to_barber_id);
  if v_capacity is not null and v_waiting >= v_capacity then
    raise exception 'this queue is full'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_full';
  end if;

  update public.queue_entries qe
     set status = 'cancelled'
   where qe.id = p_entry_id;

  -- Réinsertion EN FIN de la nouvelle file : nouveau created_at, donc
  -- dernière position — la perte de place est le contrat, annoncé au client
  -- AVANT confirmation (F1b §2). La présence a été prouvée au join
  -- d'origine ; on ne redemande ni QR ni position pour un simple changement
  -- de file dans le même salon.
  insert into public.queue_entries
    (organization_id, location_id, barber_id, service_id, customer_id,
     customer_name, customer_phone, status, created_by, booked_by_user_id)
  values
    (v_entry.organization_id, v_entry.location_id, p_to_barber_id, v_entry.service_id,
     v_entry.customer_id, v_entry.customer_name, v_entry.customer_phone,
     'waiting', v_entry.created_by, v_entry.booked_by_user_id)
  returning * into v_new;

  insert into public.queue_entry_moves
    (organization_id, location_id, entry_id, new_entry_id, from_barber_id, to_barber_id, kind, moved_by)
  values
    (v_entry.organization_id, v_entry.location_id, v_entry.id, v_new.id,
     v_entry.barber_id, p_to_barber_id, 'customer_change', (select auth.uid()));

  return query select v_new.id, v_new.status, v_new.created_at, v_new.barber_id;
end;
$$;

comment on function public.change_queue_entry_barber(uuid, uuid) is
  'Anon-callable, même capacité que leave_public_queue. Le client change de file À SON INITIATIVE (jamais de proposition automatique, F1b §2) : son entrée est annulée et une nouvelle est créée EN FIN de la file visée — il perd sa place, et l''interface le lui dit avant confirmation. Présence non redemandée : elle a été prouvée au join d''origine, dans le même salon. Tracé dans queue_entry_moves (customer_change). Refus nommés : entry_not_found, not_entry_owner, entry_not_waiting, already_in_that_queue, barber_queue_disabled, queue_closed, queue_full.';

revoke execute on function public.change_queue_entry_barber(uuid, uuid) from public;
grant execute on function public.change_queue_entry_barber(uuid, uuid) to anon, authenticated, service_role;

commit;
