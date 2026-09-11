-- FadeUp — OS-1 (2/2) : l'agenda professionnel — forçage de chevauchement
-- TRACÉ, réservation manuelle, permission de revenu par barber, agenda
-- fenêtré enrichi.
--
-- CE QUE LA BASE REFUSAIT : deux rendez-vous d'un même barber ne peuvent pas
-- se chevaucher — `appointments_barber_no_overlap` (exclusion GiST) est
-- l'arbitre, `reschedule_appointment` et `book_public_appointment` s'y
-- remettent. Aucun chemin de forçage n'existait (vérifié, 2026-09-11 :
-- aucun paramètre, aucun GUC, aucune exception dans les deux RPC).
--
-- LA DÉCISION DU FONDATEUR : « avertissement, mais on peut forcer ». Le
-- forçage passe par un PARAMÈTRE EXPLICITE (`p_force`), jamais par un
-- contournement de la garde, il est TRACÉ (qui, quand, pourquoi — sur la
-- ligne ET dans un journal append-only) et RÉSERVÉ aux rôles owner et
-- manager (le réceptionniste crée mais ne force pas — tranché ici, voir
-- OS1_RAPPORT §2).
--
-- LE MÉCANISME. Une contrainte d'exclusion est symétrique : si A peut
-- chevaucher B, B peut chevaucher A. Un « forçage » asymétrique (le forcé
-- chevauche, mais personne ne vient chevaucher le forcé) se construit donc
-- en deux temps :
--   1. le prédicat de la contrainte EXCLUT les lignes forcées
--      (`overlap_forced_at is null`) : une ligne forcée sort de l'index et
--      peut recouvrir n'importe quoi ; les lignes ordinaires restent
--      arbitrées entre elles exactement comme avant ;
--   2. un trigger BEFORE refuse à toute ligne ORDINAIRE de venir se poser
--      sur une ligne FORCÉE du même barber (sinon un créneau forcé serait
--      une brèche : hors index, il ne protégerait plus personne).
-- Un forçage sans conflit réel n'est pas un forçage : la RPC ne pose la
-- trace que si un chevauchement existe VRAIMENT au moment de l'écriture.
-- Un déplacement ORDINAIRE d'une ligne forcée efface la trace : la ligne
-- rentre dans l'index et la contrainte arbitre sa destination.
--
-- LA PERMISSION DE REVENU vit sur `memberships.can_view_revenue` (défaut
-- FALSE — un barber ne découvre pas le chiffre d'affaires par accident). Le
-- rôle owner/manager voit toujours ; le réglage ne concerne que le rôle
-- barber (contrat P1PRO §8 : le réceptionniste ne voit pas les montants).
-- Seul l'OWNER le règle (`set_membership_revenue_visibility`). Côté
-- lecture, `get_calendar_appointments` renvoie `price_cents` NULL à qui ne
-- voit pas le revenu : le masquage n'est pas qu'à l'écran.
--
-- LA COLLECTE DES DURÉES (F1b) est déjà alimentée par « terminé » :
-- `enforce_appointment_transition` horodate `completed_at` côté serveur et
-- `record_appointment_duration_sample` enregistre starts_at → completed_at.
-- Vérifié, rien à ajouter ici (verify_os1 O7 le prouve).
--
-- À APPLIQUER EN postgres — tous les objets touchés lui appartiennent
-- (vérifié : appointments, memberships, reschedule_appointment,
-- get_calendar_appointments). `time_blocks` (supabase_admin) est traité à
-- part, dans 20260911100000.
--
-- Invariant X3 (règle 4) : grants EXPLICITES sur toute RPC neuve ou
-- recréée ; les fonctions recréées re-matérialisent leur ACL d'origine
-- (postgres propriétaire, authenticated + service_role).

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. La trace du forçage — sur la ligne
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column overlap_forced_at timestamptz,
  add column overlap_forced_by uuid references auth.users(id) on delete set null,
  add column overlap_forced_reason text,
  add constraint appointments_overlap_forced_reason_length
    check (overlap_forced_reason is null or char_length(overlap_forced_reason) <= 200),
  add constraint appointments_overlap_forced_consistent
    check ((overlap_forced_at is null) = (overlap_forced_reason is null));

comment on column public.appointments.overlap_forced_at is
  'OS-1 — posé quand un rôle habilité (owner/manager) a FORCÉ ce rendez-vous sur un créneau déjà pris. Tant qu''il est posé, la ligne est hors de l''exclusion appointments_barber_no_overlap ; un déplacement ordinaire le remet à NULL et la ligne redevient arbitrée.';
comment on column public.appointments.overlap_forced_by is
  'OS-1 — qui a forcé (auth.users). Journal complet : appointment_overlap_forces.';
comment on column public.appointments.overlap_forced_reason is
  'OS-1 — pourquoi (obligatoire pour forcer, 200 caractères max).';

-- ---------------------------------------------------------------------------
-- 2. Les contraintes d'exclusion — les lignes forcées en sortent
-- ---------------------------------------------------------------------------

alter table public.appointments
  drop constraint appointments_barber_no_overlap,
  add constraint appointments_barber_no_overlap
    exclude using gist (barber_id with =, blocked_range with &&)
    where (status not in ('cancelled', 'no_show') and overlap_forced_at is null);

alter table public.appointments
  drop constraint appointments_chair_no_overlap,
  add constraint appointments_chair_no_overlap
    exclude using gist (chair_id with =, blocked_range with &&)
    where (status not in ('cancelled', 'no_show') and overlap_forced_at is null);

-- ---------------------------------------------------------------------------
-- 3. Le trigger d'asymétrie — rien d'ordinaire ne se pose sur du forcé
-- ---------------------------------------------------------------------------

create function public.check_appointment_forced_overlap() returns trigger
  language plpgsql
  set search_path to ''
as $$
declare
  v_range tstzrange;
begin
  -- Une annulation ou une absence libère : jamais bloquée.
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  -- Une ligne FORCÉE peut recouvrir n'importe quoi : c'est le sens du geste.
  if new.overlap_forced_at is not null then
    return new;
  end if;

  -- Une mise à jour qui ne déplace pas la ligne (statut, note, décision) et
  -- qui n'était pas forcée avant n'a rien à vérifier — la ligne est déjà là.
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and new.barber_id is not distinct from old.barber_id
     and new.buffer_before_minutes = old.buffer_before_minutes
     and new.buffer_after_minutes = old.buffer_after_minutes
     and old.overlap_forced_at is null then
    return new;
  end if;

  -- Ce trigger passe AVANT set_appointment_blocked_range (ordre alphabétique
  -- des triggers BEFORE) : la plage se calcule ici, tampons compris, comme
  -- la contrainte la verra.
  v_range := tstzrange(
    new.starts_at - make_interval(mins => new.buffer_before_minutes),
    new.ends_at + make_interval(mins => new.buffer_after_minutes),
    '[)'
  );

  if exists (
    select 1
    from public.appointments a
    where a.barber_id = new.barber_id
      and a.id <> new.id
      and a.status not in ('cancelled', 'no_show')
      and a.overlap_forced_at is not null
      and a.blocked_range && v_range
  ) then
    -- Même SQLSTATE et même motif nommé que la contrainte : pour le client,
    -- c'est le même fait — ce créneau n'est pas libre.
    raise exception 'that time is already taken by a forced appointment'
      using errcode = '23P01',
            detail = 'fadeup_booking_refusal=slot_conflict';
  end if;

  return new;
end;
$$;

comment on function public.check_appointment_forced_overlap() is
  'OS-1 — BEFORE INSERT/UPDATE sur appointments : une ligne ORDINAIRE ne peut pas se poser sur une ligne FORCÉE du même barber (les lignes forcées sont hors de l''exclusion GiST ; sans ce trigger un créneau forcé serait une brèche). Une ligne forcée passe toujours.';

revoke all on function public.check_appointment_forced_overlap() from public, anon, authenticated;

create trigger appointments_check_forced_overlap
  before insert or update on public.appointments
  for each row execute function public.check_appointment_forced_overlap();

-- ---------------------------------------------------------------------------
-- 4. Le journal des forçages — append-only côté client
-- ---------------------------------------------------------------------------

create table public.appointment_overlap_forces (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,
  action text not null,
  forced_by uuid references auth.users(id) on delete set null,
  forced_at timestamptz not null default now(),
  reason text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  conflicting_appointment_ids uuid[] not null,
  constraint appointment_overlap_forces_action_valid check (action in ('create', 'reschedule')),
  constraint appointment_overlap_forces_reason_length check (char_length(reason) between 1 and 200)
);

comment on table public.appointment_overlap_forces is
  'OS-1 — journal des chevauchements FORCÉS : qui, quand, pourquoi, sur quel créneau, contre quels rendez-vous. Écrit uniquement par create_appointment_as_business / reschedule_appointment (postgres, BYPASSRLS). Lisible par les rôles gestionnaires de l''organisation. Aucune écriture client.';

create index appointment_overlap_forces_org_idx
  on public.appointment_overlap_forces (organization_id, forced_at desc);
create index appointment_overlap_forces_appointment_idx
  on public.appointment_overlap_forces (appointment_id);

alter table public.appointment_overlap_forces enable row level security;
alter table public.appointment_overlap_forces force row level security;

create policy appointment_overlap_forces_select on public.appointment_overlap_forces
  for select to authenticated
  using ((select private.can_manage_appointments(organization_id)));

-- ACL par défaut durcies par X3 (rien pour anon/authenticated) — rendu
-- explicite quand même : le seul verbe client est SELECT, filtré par RLS.
revoke all on table public.appointment_overlap_forces from public, anon, authenticated;
grant select on table public.appointment_overlap_forces to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Les deux règles d'accès de ce lot
-- ---------------------------------------------------------------------------

-- Forcer un chevauchement : owner et manager. Le réceptionniste crée et
-- déplace, mais surcharger un barber est une décision de direction.
create function private.can_force_overlap(p_organization_id uuid) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select (select private.has_org_role(
    p_organization_id,
    array['owner', 'manager']::public.membership_role[]
  ));
$$;

revoke all on function private.can_force_overlap(uuid) from public, anon, authenticated;

-- La permission de revenu.
alter table public.memberships
  add column can_view_revenue boolean not null default false;

comment on column public.memberships.can_view_revenue is
  'OS-1 — le patron décide, barber par barber, si ce membre voit les montants (prix des prestations à l''agenda, revenu calculé). Défaut FALSE. N''a d''effet que pour le rôle barber : owner/manager voient toujours, receptionist jamais (contrat P1PRO §8). Réglé par set_membership_revenue_visibility (owner seulement).';

-- Voir le revenu : owner/manager toujours ; un barber si son membership le
-- dit. Le réceptionniste, jamais (contrat P1PRO §8).
create function private.can_view_revenue(p_organization_id uuid) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and (m.role in ('owner', 'manager') or (m.role = 'barber' and m.can_view_revenue))
  );
$$;

revoke all on function private.can_view_revenue(uuid) from public, anon, authenticated;

create function public.set_membership_revenue_visibility(p_membership_id uuid, p_visible boolean)
returns public.memberships
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_membership public.memberships;
begin
  select * into v_membership from public.memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'membership not found' using errcode = '42704';
  end if;

  -- L'OWNER seul — pas le manager : c'est le chiffre d'affaires du patron.
  if not (select private.has_org_role(v_membership.organization_id, array['owner']::public.membership_role[])) then
    raise exception 'only the owner can change who sees revenue' using errcode = '42501';
  end if;

  if v_membership.role <> 'barber' then
    raise exception 'the revenue setting only applies to the barber role' using errcode = '22023';
  end if;

  if p_visible is null then
    raise exception 'p_visible is required' using errcode = '22023';
  end if;

  update public.memberships
    set can_view_revenue = p_visible
    where id = p_membership_id
    returning * into v_membership;

  return v_membership;
end;
$$;

comment on function public.set_membership_revenue_visibility(uuid, boolean) is
  'OS-1 — le propriétaire règle, barber par barber, la visibilité du revenu (memberships.can_view_revenue). Refuse tout autre rôle (42501) et toute cible qui n''est pas un barber (22023).';

revoke all on function public.set_membership_revenue_visibility(uuid, boolean) from public, anon;
grant execute on function public.set_membership_revenue_visibility(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. reschedule_appointment — le paramètre de forçage explicite
-- ---------------------------------------------------------------------------
-- DROP + CREATE : la signature change (deux paramètres à défaut). Une
-- surcharge laisserait PostgREST hésiter entre deux candidates sur un appel
-- à deux arguments. L'ACL est re-matérialisée à l'identique en fin de bloc.

drop function public.reschedule_appointment(uuid, timestamptz, uuid);

create function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_barber_id uuid default null,
  p_force boolean default false,
  p_force_reason text default null
) returns public.appointments
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_appointment public.appointments;
  v_is_business boolean;
  v_is_customer boolean;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_timezone text;
  v_force boolean := coalesce(p_force, false);
  v_reason text := nullif(btrim(coalesce(p_force_reason, '')), '');
  v_range tstzrange;
  v_conflicts uuid[];
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found'
      using errcode = '42704',
            detail = 'fadeup_booking_refusal=appointment_not_found';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  -- X3 : coalesce anti-NULL — un rendez-vous walk-in (customer_id NULL) rendait
  -- la comparaison IN NULL, et « if not (false or NULL) » ne levait pas.
  v_is_customer := coalesce(v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  ), false);

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  -- OS-1 : forcer est un paramètre EXPLICITE, réservé à owner/manager.
  -- Un client ne force jamais ; un réceptionniste non plus (tranché OS-1).
  if v_force then
    if not v_is_business or not (select private.can_force_overlap(v_appointment.organization_id)) then
      raise exception 'not authorized to force an overlap'
        using errcode = '42501',
              detail = 'fadeup_booking_refusal=force_not_allowed';
    end if;
    if v_reason is null then
      raise exception 'a reason is required to force an overlap'
        using errcode = '22023',
              detail = 'fadeup_booking_refusal=force_reason_required';
    end if;
    if char_length(v_reason) > 200 then
      raise exception 'the reason is limited to 200 characters'
        using errcode = '22023',
              detail = 'fadeup_booking_refusal=force_reason_required';
    end if;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=no_longer_reschedulable';
  end if;

  if p_starts_at is null then
    raise exception 'the new time is required'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=missing_time';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=past_time';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- A different professional must still belong to this shop and still be
  -- eligible for this service. Never trusted from the caller.
  if v_barber_id <> v_appointment.barber_id then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.barber_services bs on bs.barber_id = b.id and bs.service_id = v_appointment.service_id
      where b.id = v_barber_id
        and b.organization_id = v_appointment.organization_id
        and b.is_bookable and sp.is_active and sp.is_public
    ) then
      raise exception 'that professional is not available for this service'
        using errcode = '22023',
              detail = 'fadeup_booking_refusal=barber_unavailable';
    end if;
  end if;

  -- Duration comes from the SNAPSHOT on the appointment, not from the service
  -- as it stands today: a price list edited since booking must not silently
  -- change the length of an appointment already agreed.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  select l.timezone into v_timezone
    from public.locations l where l.id = v_appointment.location_id;

  -- NEW IN LOT E. Previously this relied entirely on a human seeing the new
  -- time, because a customer move became a request. Nobody sees it now, so
  -- the destination has to be genuinely bookable — not merely unoccupied.
  if not private.slot_is_within_hours(v_barber_id, v_appointment.location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=outside_hours';
  end if;

  -- OS-1 : un forçage ne se pose que sur un conflit RÉEL. Les conflits sont
  -- lus sous le verrou de la ligne déplacée ; pour les autres lignes, c'est
  -- l'exclusion (lignes ordinaires) et le trigger (lignes forcées) qui
  -- restent l'autorité — la trace, elle, dit ce qu'on a vu au moment du geste.
  if v_force then
    v_range := tstzrange(
      p_starts_at - make_interval(mins => v_appointment.buffer_before_minutes),
      v_ends_at + make_interval(mins => v_appointment.buffer_after_minutes),
      '[)'
    );
    select coalesce(array_agg(a.id order by a.starts_at), '{}'::uuid[]) into v_conflicts
    from public.appointments a
    where a.barber_id = v_barber_id
      and a.id <> v_appointment.id
      and a.status not in ('cancelled', 'no_show')
      and a.blocked_range && v_range;
    if coalesce(array_length(v_conflicts, 1), 0) = 0 then
      v_force := false;
    end if;
  end if;

  -- The status is PRESERVED. A confirmed appointment moved to another valid
  -- slot is still a confirmed appointment: the shop said yes to the slot, and
  -- the customer has not stopped being expected.
  --
  -- Raised for exactly this UPDATE, after the checks above — it tells the LOT
  -- 11 column guard that this is the sanctioned reschedule path rather than a
  -- barber editing a time directly.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- One statement. The GiST exclusion constraint is the authority on whether
  -- the destination is free; if it raises, nothing here has changed and the
  -- original appointment is left exactly as it was. There is never a moment
  -- with two appointments.
  --
  -- OS-1 : sans forçage, la trace est EFFACÉE (la ligne rentre dans l'index
  -- et la contrainte arbitre la destination) ; avec, elle est posée.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        overlap_forced_at = case when v_force then now() else null end,
        overlap_forced_by = case when v_force then (select auth.uid()) else null end,
        overlap_forced_reason = case when v_force then v_reason else null end,
        decided_at = case when v_is_business then now() else decided_at end,
        decided_by = case when v_is_business then (select auth.uid()) else decided_by end
    where id = p_appointment_id
    returning * into v_appointment;

  perform set_config('fadeup.appointment_reschedule', 'off', true);

  if v_force then
    insert into public.appointment_overlap_forces
      (organization_id, appointment_id, barber_id, action, forced_by, reason, starts_at, ends_at, conflicting_appointment_ids)
    values
      (v_appointment.organization_id, v_appointment.id, v_barber_id, 'reschedule', (select auth.uid()),
       v_reason, v_appointment.starts_at, v_appointment.ends_at, v_conflicts);
  end if;

  perform private.emit_booking_notification(
    v_appointment, 'booking_rescheduled',
    case when v_is_business then 'customer' else 'business' end,
    'Appointment moved',
    v_appointment.customer_name,
    'booking_rescheduled',
    ':' || extract(epoch from v_appointment.starts_at)::bigint::text
  );

  return v_appointment;
end;
$$;

comment on function public.reschedule_appointment(uuid, timestamptz, uuid, boolean, text) is
  'Déplace un rendez-vous (heure et/ou barber). Client propriétaire ou rôle gestionnaire. OS-1 : `p_force` (owner/manager seulement, motif obligatoire) pose la trace de chevauchement forcé quand un conflit réel existe ; sans forçage la trace est effacée et l''exclusion arbitre. Motifs nommés fadeup_booking_refusal=…';

revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, boolean, text) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. create_appointment_as_business — le client qui appelle
-- ---------------------------------------------------------------------------
-- Les écritures directes sur appointments sont révoquées depuis X3
-- (authenticated : SELECT/DELETE) : la création manuelle passe par une RPC,
-- qui reprend les gardes du tunnel public (lieu, service, barber apte,
-- horaires) et y ajoute le rôle, le forçage et la trace. Statut CONFIRMÉ :
-- le salon vient de dire oui au téléphone. Les triggers existants font le
-- reste (capacité commerciale + mode de service, rattachement client,
-- notifications, blocages de temps — ces derniers ne se forcent PAS :
-- un blocage est la propre indisponibilité du pro, il s'édite).

create function public.create_appointment_as_business(
  p_location_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null,
  p_force boolean default false,
  p_force_reason text default null
) returns public.appointments
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_timezone text;
  v_duration_minutes integer;
  v_buffer_before_minutes integer;
  v_buffer_after_minutes integer;
  v_ends_at timestamptz;
  v_appointment public.appointments;
  v_force boolean := coalesce(p_force, false);
  v_reason text := nullif(btrim(coalesce(p_force_reason, '')), '');
  v_range tstzrange;
  v_conflicts uuid[];
begin
  select l.organization_id, l.timezone into v_organization_id, v_timezone
    from public.locations l
    where l.id = p_location_id and l.is_active;
  if not found then
    raise exception 'location is not available for booking'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=location_unavailable';
  end if;

  if not (select private.can_manage_appointments(v_organization_id)) then
    raise exception 'not authorized to create appointments for this organization'
      using errcode = '42501',
            detail = 'fadeup_booking_refusal=not_authorized';
  end if;

  if v_force then
    if not (select private.can_force_overlap(v_organization_id)) then
      raise exception 'not authorized to force an overlap'
        using errcode = '42501',
              detail = 'fadeup_booking_refusal=force_not_allowed';
    end if;
    if v_reason is null or char_length(v_reason) > 200 then
      raise exception 'a reason (200 characters max) is required to force an overlap'
        using errcode = '22023',
              detail = 'fadeup_booking_refusal=force_reason_required';
    end if;
  end if;

  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=missing_name';
  end if;

  if p_starts_at is null then
    raise exception 'starts_at is required'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=missing_time';
  end if;

  if p_starts_at <= now() then
    raise exception 'starts_at must be in the future'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=past_time';
  end if;

  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration_minutes, v_buffer_before_minutes, v_buffer_after_minutes
    from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
      and exists (select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = p_location_id);
  if not found then
    raise exception 'service is not available for booking at this location'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=service_unavailable';
  end if;

  -- Même aptitude que le tunnel public : le barber fait ce service, ici.
  -- (sp.is_public n'est PAS exigé : un barber non publié reste réservable
  -- par le comptoir — c'est le sens d'une réservation manuelle.)
  if not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.location_id = p_location_id
  ) then
    raise exception 'barber is not available for this service at this location'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=barber_unavailable';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  if not private.slot_is_within_hours(p_barber_id, p_location_id, p_starts_at, v_ends_at, v_timezone) then
    raise exception 'requested time is outside available hours'
      using errcode = '22023',
            detail = 'fadeup_booking_refusal=outside_hours';
  end if;

  -- Un forçage ne se pose que sur un conflit RÉEL (même règle que reschedule).
  if v_force then
    v_range := tstzrange(
      p_starts_at - make_interval(mins => v_buffer_before_minutes),
      v_ends_at + make_interval(mins => v_buffer_after_minutes),
      '[)'
    );
    select coalesce(array_agg(a.id order by a.starts_at), '{}'::uuid[]) into v_conflicts
    from public.appointments a
    where a.barber_id = p_barber_id
      and a.status not in ('cancelled', 'no_show')
      and a.blocked_range && v_range;
    if coalesce(array_length(v_conflicts, 1), 0) = 0 then
      v_force := false;
    end if;
  end if;

  -- created_by = le membre du comptoir ; booked_by_user_id reste NULL (ce
  -- n'est pas le client qui a réservé — le plafond de 5 ne le concerne pas).
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id,
    customer_name, customer_phone, customer_email,
    starts_at, ends_at, buffer_before_minutes, buffer_after_minutes,
    status, notes, created_by, booked_by_user_id,
    decided_at, decided_by,
    overlap_forced_at, overlap_forced_by, overlap_forced_reason
  )
  values (
    v_organization_id, p_location_id, p_barber_id, p_service_id,
    btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_starts_at, v_ends_at, v_buffer_before_minutes, v_buffer_after_minutes,
    'confirmed', nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()), null,
    now(), (select auth.uid()),
    case when v_force then now() else null end,
    case when v_force then (select auth.uid()) else null end,
    case when v_force then v_reason else null end
  )
  returning * into v_appointment;

  if v_force then
    insert into public.appointment_overlap_forces
      (organization_id, appointment_id, barber_id, action, forced_by, reason, starts_at, ends_at, conflicting_appointment_ids)
    values
      (v_organization_id, v_appointment.id, p_barber_id, 'create', (select auth.uid()),
       v_reason, v_appointment.starts_at, v_appointment.ends_at, v_conflicts);
  end if;

  return v_appointment;
end;
$$;

comment on function public.create_appointment_as_business(uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, text) is
  'OS-1 — réservation MANUELLE par le comptoir (owner/manager/receptionist) : statut confirmé, durée et tampons du service, gardes du tunnel public (lieu, service, barber apte, horaires, futur). `p_force` (owner/manager, motif obligatoire) pose la trace de chevauchement forcé quand un conflit réel existe. Les blocages de temps ne se forcent pas. Motifs nommés fadeup_booking_refusal=…';

revoke all on function public.create_appointment_as_business(uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_appointment_as_business(uuid, uuid, uuid, timestamptz, text, text, text, text, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. get_calendar_appointments — tampons, trace de forçage, prix masqué
-- ---------------------------------------------------------------------------
-- DROP + CREATE (colonnes ajoutées au type de retour). Les consommateurs
-- existants (accueil P1PRO, agenda legacy) lisent un sur-ensemble. ACL
-- re-matérialisée à l'identique.

drop function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid);

create function public.get_calendar_appointments(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_location_id uuid default null,
  p_barber_id uuid default null
) returns table(
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  resolution public.appointment_resolution,
  expires_at timestamptz,
  location_id uuid,
  location_name text,
  location_timezone text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  price_cents integer,
  currency text,
  customer_name text,
  customer_phone text,
  notes text,
  created_at timestamptz,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  overlap_forced_at timestamptz,
  overlap_forced_reason text,
  completed_at timestamptz
)
  language sql stable security definer
  set search_path to ''
as $$
  select
    a.id, a.starts_at, a.ends_at, a.status, a.resolution, a.expires_at,
    a.location_id, l.name, l.timezone,
    a.barber_id, sp.display_name,
    a.service_id, s.name,
    -- OS-1 : le prix n'est rendu qu'à qui voit le revenu (owner/manager, ou
    -- barber autorisé par le patron). NULL sinon — pas zéro.
    case when (select private.can_view_revenue(p_organization_id)) then s.price_cents else null end,
    coalesce(o.currency, 'EUR'),
    a.customer_name, a.customer_phone, a.notes, a.created_at,
    a.buffer_before_minutes, a.buffer_after_minutes,
    a.overlap_forced_at, a.overlap_forced_reason,
    a.completed_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  join public.organizations o on o.id = a.organization_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.starts_at >= p_from
    and a.starts_at < p_to
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_barber_id is null or a.barber_id = p_barber_id)
    -- SECURITY DEFINER bypasses RLS, so membership is checked explicitly.
    and ((select private.is_org_member(p_organization_id)) or (select private.is_platform_admin()))
  order by a.starts_at;
$$;

comment on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Agenda fenêtré d''une organisation (membres). OS-1 : tampons, trace de forçage et completed_at exposés ; price_cents NULL pour qui ne voit pas le revenu (private.can_view_revenue).';

revoke all on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_calendar_appointments(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated, service_role;

commit;
