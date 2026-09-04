-- FadeUp — B2, chantier 5: le retrait de marketplace a enfin un déclencheur.
--
-- CE QUE B1 A LAISSÉ
--
-- withdraw_external_professional existe : elle dépublie une identité non
-- revendiquée et l'audite. B1 l'a écrite parce qu'« une publication qu'on ne
-- peut pas défaire n'est pas une décision, c'est une trappe ».
--
-- Mais **rien ne l'appelle**. MASTER_SPEC §5 promet un retrait en 72 h maximum
-- après validation ; une fonction sans déclencheur ni échéance suivie n'est
-- pas cette promesse, c'est la capacité technique de la tenir.
--
-- CE QUE CE FICHIER AJOUTE
--
-- Une demande datée, une échéance calculée, une exécution, et surtout une
-- VISIBILITÉ : une demande non traitée dans les 72 h doit apparaître quelque
-- part, sinon la promesse se tient par la mémoire de quelqu'un.
--
-- LE CANAL DE DEMANDE, DOCUMENTÉ PARCE QU'IL EST PARTIEL
--
-- Aujourd'hui la demande entre par un opérateur, depuis /platform : un
-- professionnel écrit ou téléphone, l'opérateur enregistre. `requested_via`
-- consigne par quel canal, parce que la trace de « qui a demandé, quand,
-- comment » est ce qui rend le délai opposable.
--
-- Il n'y a **pas** de formulaire public de retrait, et ce n'est pas un oubli :
-- un tel formulaire permettrait à n'importe qui de faire dépublier n'importe
-- quel commerce. Vérifier qu'un demandeur est bien le professionnel concerné,
-- c'est la revendication — le même problème, déjà résolu ailleurs. Un
-- professionnel qui revendique son profil le contrôle et n'a plus besoin de
-- nous pour en sortir. Le chemin opérateur couvre ceux qui ne veulent pas
-- revendiquer, et c'est exactement la population concernée.
--
-- LA NON-REPUBLICATION
--
-- Elle ne s'invente pas ici, elle se vérifie : publication_block_reason
-- refusait DÉJÀ un prospect pour deux raisons indépendantes, et le retrait
-- s'appuie sur les deux plutôt que d'en créer une troisième —
--   'already_published'  la ligne prospect_professionals subsiste ;
--   'do_not_contact'     posé par l'exécution du retrait.
-- verify_b2.sql assert les deux après un retrait.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'marketplace_withdrawal_status') then
    create type public.marketplace_withdrawal_status as enum ('pending', 'completed', 'rejected');
  end if;
end $$;

create table if not exists public.marketplace_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),

  professional_id uuid not null references public.professionals (id) on delete cascade,

  -- Par quel canal la demande est arrivée. Une trace, pas une décoration :
  -- c'est ce qui rend le délai de 72 h opposable.
  requested_via text not null,
  requester_note text,

  requested_at timestamptz not null default now(),

  -- MASTER_SPEC §5 : 72 h maximum après validation. Calculée et stockée plutôt
  -- que dérivée à la lecture, pour qu'un changement de règle plus tard ne
  -- réécrive pas rétroactivement l'échéance d'engagements déjà pris.
  deadline_at timestamptz not null default (now() + interval '72 hours'),

  status public.marketplace_withdrawal_status not null default 'pending',
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marketplace_withdrawal_requests_via_valid
    check (requested_via in ('email', 'phone', 'platform_operator', 'legal', 'other')),

  constraint marketplace_withdrawal_requests_decision_matches_status
    check ((status = 'pending') = (decided_at is null)),

  constraint marketplace_withdrawal_requests_deadline_after_request
    check (deadline_at > requested_at)
);

comment on table public.marketplace_withdrawal_requests is
  'Une demande de retrait de la marketplace, datée, avec son échéance de 72 h (MASTER_SPEC §5). Une seule demande en cours par profil à la fois — index unique partiel ci-dessous. Le retrait lui-même reste withdraw_external_professional ; cette table est ce qui le DÉCLENCHE et ce qui rend le délai visible.';

-- Une seule demande en cours par profil : deux demandes concurrentes
-- produiraient deux échéances et deux exécutions pour un seul engagement.
create unique index if not exists marketplace_withdrawal_requests_one_pending
  on public.marketplace_withdrawal_requests (professional_id) where status = 'pending';

create index if not exists marketplace_withdrawal_requests_deadline_idx
  on public.marketplace_withdrawal_requests (deadline_at) where status = 'pending';

drop trigger if exists marketplace_withdrawal_requests_set_updated_at on public.marketplace_withdrawal_requests;
create trigger marketplace_withdrawal_requests_set_updated_at
  before update on public.marketplace_withdrawal_requests
  for each row execute function public.set_updated_at();

alter table public.marketplace_withdrawal_requests enable row level security;

drop policy if exists marketplace_withdrawal_requests_select on public.marketplace_withdrawal_requests;
create policy marketplace_withdrawal_requests_select
  on public.marketplace_withdrawal_requests
  for select to authenticated
  using ((select private.is_platform_admin()));

revoke all on table public.marketplace_withdrawal_requests from anon, authenticated;
grant select on table public.marketplace_withdrawal_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Enregistrer la demande
-- ---------------------------------------------------------------------------

create or replace function public.request_marketplace_withdrawal(
  p_professional_id uuid,
  p_requested_via text,
  p_requester_note text default null
)
returns table (id uuid, deadline_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can record a withdrawal request'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p where p.id = p_professional_id;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  if v_claim_state = 'claimed' then
    -- Un profil revendiqué se retire tout seul : son propriétaire contrôle sa
    -- visibilité depuis Pro. Passer par ce chemin serait retirer le profil de
    -- quelqu'un à sa place.
    raise exception 'this profile is claimed; its owner controls its visibility'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=professional_is_claimed';
  end if;

  insert into public.marketplace_withdrawal_requests
    (professional_id, requested_via, requester_note)
  values
    (p_professional_id, p_requested_via, nullif(btrim(coalesce(p_requester_note, '')), ''))
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_requested', 'professionals', p_professional_id,
          jsonb_build_object('request_id', v_row.id, 'requested_via', p_requested_via,
                             'deadline_at', v_row.deadline_at));

  return query select v_row.id, v_row.deadline_at;
end;
$$;

comment on function public.request_marketplace_withdrawal(uuid, text, text) is
  'Platform-admin. Enregistre la demande de retrait d''un professionnel non revendiqué et démarre le décompte de 72 h (MASTER_SPEC §5). Refuse sur un profil revendiqué : son propriétaire contrôle déjà sa visibilité, et le retirer à sa place serait agir pour lui.';

revoke all on function public.request_marketplace_withdrawal(uuid, text, text) from public, anon;
grant execute on function public.request_marketplace_withdrawal(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Exécuter le retrait
-- ---------------------------------------------------------------------------

create or replace function public.complete_marketplace_withdrawal(
  p_request_id uuid,
  p_decision_note text default null
)
returns table (professional_id uuid, completed_at timestamptz, hours_taken numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can complete a withdrawal'
      using errcode = '42501';
  end if;

  select * into v_row from public.marketplace_withdrawal_requests
  where id = p_request_id for update;

  if not found then
    raise exception 'withdrawal request not found' using errcode = '42704';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'this withdrawal request is already %', v_row.status
      using errcode = '42501';
  end if;

  -- 1. Dépublier. B1 a écrit cette fonction, elle audite déjà son geste.
  perform public.withdraw_external_professional(v_row.professional_id, p_decision_note);

  -- 2. Couper toute relance future. C'est la moitié du retrait que la simple
  --    dépublication ne couvre pas : un profil invisible qui continue de
  --    recevoir des e-mails de prospection n'est pas retiré, il est caché.
  update public.prospects pr
  set do_not_contact = true
  from public.prospect_professionals pp
  where pp.prospect_id = pr.id
    and pp.professional_id = v_row.professional_id
    and not pr.do_not_contact;

  insert into public.prospect_suppressions (scope, prospect_id, reason)
  select 'prospect', pp.prospect_id, 'marketplace_withdrawal'
  from public.prospect_professionals pp
  where pp.professional_id = v_row.professional_id
  on conflict do nothing;

  -- 3. Les demandes d'intérêt en cours n'ont plus de destinataire. Les laisser
  --    « pending » ferait attendre un client une réponse qui ne viendra
  --    jamais, et la troisième relance partirait vers quelqu'un qui a demandé
  --    à sortir.
  -- La table est nommée en entier dans le WHERE : la clause RETURNS TABLE de
  -- cette fonction déclare une variable `professional_id`, qui masquerait la
  -- colonne et ferait échouer l'UPDATE sur « column reference is ambiguous ».
  update public.professional_interest_requests r
  set status = 'withdrawn', resolved_at = now()
  where r.professional_id = v_row.professional_id and r.status = 'pending';

  update public.marketplace_withdrawal_requests
  set status = 'completed', decided_at = now(), decided_by = v_actor,
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_request_id
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_completed', 'professionals', v_row.professional_id,
          jsonb_build_object('request_id', v_row.id,
                             'requested_at', v_row.requested_at,
                             'deadline_at', v_row.deadline_at,
                             'within_deadline', v_row.decided_at <= v_row.deadline_at));

  return query select
    v_row.professional_id,
    v_row.decided_at,
    round(extract(epoch from (v_row.decided_at - v_row.requested_at)) / 3600.0, 1);
end;
$$;

comment on function public.complete_marketplace_withdrawal(uuid, text) is
'Platform-admin. Exécute un retrait de marketplace, en quatre gestes qui vont ensemble :
  1. dépublication (withdraw_external_professional, écrite par B1) ;
  2. do_not_contact + suppression durable sur le prospect — un profil invisible qui reçoit encore des relances n''est pas retiré, il est caché ;
  3. les demandes d''intérêt en cours passent en `withdrawn`, pour ne pas faire attendre un client une réponse qui ne viendra pas ;
  4. l''audit, avec within_deadline, qui dit si l''engagement des 72 h a été tenu.

Retourne hours_taken pour que la mesure du délai soit une donnée, pas une impression.';

revoke all on function public.complete_marketplace_withdrawal(uuid, text) from public, anon;
grant execute on function public.complete_marketplace_withdrawal(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La visibilité de l'échéance
-- ---------------------------------------------------------------------------

create or replace function public.list_marketplace_withdrawal_requests(p_include_completed boolean default false)
returns table (
  id uuid,
  professional_id uuid,
  professional_display_name text,
  professional_handle text,
  is_still_public boolean,
  requested_via text,
  requested_at timestamptz,
  deadline_at timestamptz,
  hours_remaining numeric,
  is_overdue boolean,
  status public.marketplace_withdrawal_status,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id, w.professional_id, p.display_name, p.handle, p.is_public,
    w.requested_via, w.requested_at, w.deadline_at,
    round(extract(epoch from (w.deadline_at - now())) / 3600.0, 1),
    w.status = 'pending' and w.deadline_at < now(),
    w.status, w.decided_at
  from public.marketplace_withdrawal_requests w
  join public.professionals p on p.id = w.professional_id
  where (select private.is_platform_admin())
    and (p_include_completed or w.status = 'pending')
  -- Les retards en premier : une liste triée par date de demande enterre
  -- l'urgence sous l'historique.
  order by (w.status = 'pending' and w.deadline_at < now()) desc, w.deadline_at;
$$;

comment on function public.list_marketplace_withdrawal_requests(boolean) is
  'Platform-admin. Les demandes de retrait, les retards d''abord. hours_remaining passe en négatif quand l''engagement des 72 h de MASTER_SPEC §5 est dépassé, et is_overdue le dit sans calcul — c''est la colonne sur laquelle un écran /platform doit alerter. Retourne zéro ligne à un appelant non habilité plutôt que de lever : c''est une lecture de liste, pas une action.';

revoke all on function public.list_marketplace_withdrawal_requests(boolean) from public, anon;
grant execute on function public.list_marketplace_withdrawal_requests(boolean) to authenticated, service_role;

commit;
