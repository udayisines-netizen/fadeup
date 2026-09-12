-- FadeUp — PLAT-2 (1/4) : l'écran support.
--
-- À APPLIQUER EN postgres (règle 1 de DB_OWNERSHIP.md). Tous les objets
-- touchés ou créés appartiennent à `postgres` : vérifié avant écriture sur
-- les quatre tables lues par les dossiers (appointments, queue_entries,
-- email_outbox, marketplace_withdrawal_requests).
--
-- CE QUE CE FICHIER POSE
--
--   1. quatre droits de plus dans la grille de PLAT-1 ;
--   2. LE MODÈLE DE TICKET, qui n'existait nulle part (vérifié : aucune table
--      `*ticket*` en base au 2026-09-11) ;
--   3. les trois dossiers en LECTURE, assemblés par des SECURITY DEFINER qui
--      TRACENT chaque consultation ;
--   4. les deux actions de premier niveau qui manquaient : sortir quelqu'un
--      d'une file, renvoyer un e-mail.
--
-- POURQUOI DES RPC ET PAS DES POLICIES ÉLARGIES
--
-- PLAT-1 §13 laisse la « lecture complète pour traiter un appel » non cochée,
-- en refusant d'élargir une quarantaine de policies locataires sans écran
-- pour les exercer. Ce lot ne les élargit pas davantage : il assemble le
-- dossier dans une fonction SECURITY DEFINER gardée par `support.dossier`.
-- Deux raisons, et la seconde est la vraie :
--   * le périmètre lu est ÉCRIT dans la fonction, lisible d'un coup d'œil,
--     au lieu d'être la somme de quarante policies ;
--   * « chaque consultation de dossier est tracée » est IMPOSSIBLE avec une
--     policy — une policy ne peut pas écrire. Seule une fonction le peut.
--
-- LE CAS NUL, partout. `private.platform_can()` rend un booléen strict, mais
-- chaque garde écrit quand même `v_actor is null or not ...` : X3 a payé deux
-- fois pour cette omission.

begin;

-- ---------------------------------------------------------------------------
-- 1. Les droits
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('support.tickets', 'Ouvrir, lire, assigner et résoudre un ticket de support.'),
  ('support.dossier', 'Lire le dossier complet d''un client, d''un professionnel ou d''un salon pour traiter un appel — chaque consultation est tracée.'),
  ('queue.remove',    'Sortir quelqu''un d''une file d''attente au nom du support.'),
  ('email.resend',    'Renvoyer un e-mail transactionnel déjà parti, à l''identique.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key)
select r.role, p.key
from (values
  ('platform_owner'::public.platform_role),
  ('platform_admin'::public.platform_role),
  ('platform_support'::public.platform_role)
) as r(role)
cross join (values ('support.tickets'), ('support.dossier'), ('queue.remove'), ('email.resend')) as p(key)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Le modèle de ticket
-- ---------------------------------------------------------------------------

-- QUATRE ORIGINES, dont UNE SEULE est branchée aujourd'hui — c'est écrit dans
-- le rapport et dans l'écran, pas seulement ici :
--   phone            : le support décroche et saisit. BRANCHÉ.
--   gdpr_withdrawal  : ouvert à la main DEPUIS une demande de retrait, qui
--                      porte alors son échéance. BRANCHÉ (geste humain).
--   report           : un signalement d'avis. NON BRANCHÉ — aucun déclencheur
--                      n'ouvre de ticket sur `review_reports`.
--   inbound_email    : un e-mail entrant. NON BRANCHÉ — FadeUp n'a pas de MX
--                      de réception (X2 §verrous), donc rien n'arrive.
create type public.support_ticket_origin as enum (
  'phone', 'gdpr_withdrawal', 'report', 'inbound_email'
);

create type public.support_ticket_status as enum ('open', 'waiting', 'resolved');

create type public.support_ticket_message_kind as enum (
  'note', 'inbound', 'outbound', 'status_change', 'assignment', 'action'
);

-- Une référence qu'on peut lire au téléphone. Une séquence, pas un aléa :
-- l'unicité est garantie par la base plutôt que par un tirage qu'il faudrait
-- re-tirer en cas de collision.
create sequence public.support_ticket_reference_seq;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  origin public.support_ticket_origin not null,
  subject text not null,
  body text,
  status public.support_ticket_status not null default 'open',
  assigned_to uuid references auth.users (id) on delete set null,

  -- CE QUE LE TICKET CONCERNE. Toutes facultatives : un appel commence
  -- souvent sans qu'on sache encore de qui il s'agit, et forcer un
  -- rattachement produirait un rattachement faux.
  subject_user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  professional_id uuid references public.professionals (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  queue_entry_id uuid references public.queue_entries (id) on delete set null,
  withdrawal_request_id uuid references public.marketplace_withdrawal_requests (id) on delete set null,

  -- L'ÉCHÉANCE QUI DÉFILE. Pour un retrait RGPD c'est celle de la demande
  -- (72 h, posée par B2/X2) : elle est RECOPIÉE ici et non recalculée, pour
  -- qu'un changement de règle plus tard ne réécrive pas une promesse déjà
  -- faite — même raisonnement que `platform_support_sessions.expires_at`.
  due_at timestamptz,

  opened_by uuid references auth.users (id) on delete set null,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint support_tickets_subject_not_blank check (btrim(subject) <> ''),
  constraint support_tickets_subject_length check (char_length(subject) <= 200),
  constraint support_tickets_body_length check (body is null or char_length(body) <= 5000),
  constraint support_tickets_resolution_length check (resolution is null or char_length(resolution) <= 2000),
  -- Un ticket résolu porte sa date ET son mot de résolution ; un ticket
  -- ouvert n'en porte aucun. Pas de « résolu » muet.
  constraint support_tickets_resolution_stamped check (
    (status = 'resolved') = (resolved_at is not null)
    and (status <> 'resolved' or nullif(btrim(coalesce(resolution, '')), '') is not null)
  ),
  -- Une origine RGPD sans la demande qu'elle traite serait une échéance
  -- inventée. La forme l'interdit.
  constraint support_tickets_gdpr_shape check (
    origin <> 'gdpr_withdrawal' or withdrawal_request_id is not null
  )
);

create index support_tickets_open_due_idx on public.support_tickets (due_at nulls last)
  where status <> 'resolved';
create index support_tickets_assigned_idx on public.support_tickets (assigned_to)
  where assigned_to is not null;
create index support_tickets_status_created_idx on public.support_tickets (status, created_at desc);
create unique index support_tickets_one_open_per_withdrawal
  on public.support_tickets (withdrawal_request_id)
  where withdrawal_request_id is not null and status <> 'resolved';

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

-- L'HISTORIQUE DES ÉCHANGES, en ajout seul. Le motif exact de
-- platform_audit_log : un historique qu'on peut réécrire n'est pas un
-- historique, et le déclencheur le dit même au rôle le plus puissant.
create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  kind public.support_ticket_message_kind not null,
  body text not null,
  author_user_id uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_body_not_blank check (btrim(body) <> ''),
  constraint support_ticket_messages_body_length check (char_length(body) <= 5000),
  constraint support_ticket_messages_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);

-- ===========================================================================
-- CETTE FONCTION EST REDÉFINIE PAR B5 — À SAVOIR AVANT DE LA RÉÉCRIRE
--
-- B5 (`b5/missing-contracts`, NON FUSIONNÉE, migrations APPLIQUÉES en
-- production) redéfinit CETTE fonction dans
-- `20260911210000_b5_account_erasure_addendum.sql` pour y ouvrir UNE seule
-- porte : le caviardage d'un fil dont le sujet a effacé son compte
-- (`body -> '[deleted]'`, auteur -> NULL, metadata -> '{}'), vérifié colonne
-- par colonne, sous un GUC transactionnel posé par la seule
-- `private.erase_customer_account()`. Le DELETE y reste refusé à tout le
-- monde : l'invariant d'ajout seul tient, le fil n'est jamais amputé.
--
-- SON PREMIER HORODATAGE (…160300) ÉTAIT ANTÉRIEUR AU MIEN (…200000). Un
-- rejeu à blanc depuis les seules migrations, dans l'ordre des noms, aurait
-- appliqué B5 PUIS celle-ci — et CETTE version, qui ne connaît pas le
-- caviardage, aurait ÉCRASÉ la porte de B5. L'effacement de compte se serait
-- cassé sur un fil de support, silencieusement, à la première suppression
-- réelle ; en production l'ordre d'application le masquait.
--
-- CORRIGÉ : B5 a renommé son addendum en `20260911210000_…`, donc APRÈS ce
-- fichier. L'invariant à tenir reste celui-ci — **toute redéfinition future
-- de cette fonction doit passer APRÈS 20260911200000**, sinon elle perd la
-- porte de caviardage. Ne PAS reprendre le corps de B5 ici : cette migration
-- doit rester lisible seule, et B5 reste propriétaire de sa propre exemption.
--
-- ÉTAT EN PRODUCTION AU 2026-09-11 : c'est la version de B5 qui tourne, et
-- les assertions B19/B20/B21 de `verify_plat2.sql` restent vertes avec elle.
-- ===========================================================================
create or replace function public.reject_support_ticket_message_mutation()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  raise exception
    'support_ticket_messages est en ajout seul : % n''est pas permis', tg_op
    using errcode = '42501';
end;
$function$;

comment on function public.reject_support_ticket_message_mutation() is
  'PLAT-2 : aucune exemption de rôle. BYPASSRLS ne contourne pas un déclencheur — postgres et service_role sont refusés comme les autres.';

create trigger support_ticket_messages_append_only
  before update or delete on public.support_ticket_messages
  for each row execute function public.reject_support_ticket_message_mutation();

create trigger support_ticket_messages_append_only_truncate
  before truncate on public.support_ticket_messages
  for each statement execute function public.reject_support_ticket_message_mutation();

alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_messages force row level security;

create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using ((select private.platform_can('support.tickets')));

create policy support_ticket_messages_select on public.support_ticket_messages
  for select to authenticated
  using ((select private.platform_can('support.tickets')));

-- Aucune policy d'écriture, volontairement : toute mutation passe par une RPC
-- qui repose la question et écrit au journal. Une policy INSERT ouvrirait un
-- chemin d'écriture non tracé.
revoke insert, update, delete, truncate on public.support_tickets from anon, authenticated;
revoke insert, update, delete, truncate on public.support_ticket_messages from anon, authenticated;
revoke all on public.support_tickets from anon;
revoke all on public.support_ticket_messages from anon;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Les RPC du ticket
-- ---------------------------------------------------------------------------

create or replace function private.assert_support_tickets()
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Le cas nul explicitement, même si platform_can rend un booléen strict.
  if v_actor is null or not (select private.platform_can('support.tickets')) then
    raise exception 'file de support non autorisée'
      using errcode = '42501', detail = 'fadeup_support_refusal=not_authorized';
  end if;
  return v_actor;
end;
$function$;

create or replace function public.open_support_ticket(
  p_origin public.support_ticket_origin,
  p_subject text,
  p_body text default null,
  p_subject_user_id uuid default null,
  p_organization_id uuid default null,
  p_professional_id uuid default null,
  p_appointment_id uuid default null,
  p_queue_entry_id uuid default null,
  p_withdrawal_request_id uuid default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_due timestamptz;
begin
  if v_subject is null then
    raise exception 'un ticket a besoin de son sujet'
      using errcode = '22023', detail = 'fadeup_support_refusal=subject_required';
  end if;

  -- Les deux origines non branchées ne s'ouvrent pas à la main : les laisser
  -- passer donnerait l'illusion qu'un circuit existe derrière.
  if p_origin in ('report', 'inbound_email') then
    raise exception 'cette origine n''est pas encore branchée'
      using errcode = '22023', detail = 'fadeup_support_refusal=origin_not_wired';
  end if;

  if p_origin = 'gdpr_withdrawal' then
    if p_withdrawal_request_id is null then
      raise exception 'un ticket de retrait a besoin de la demande qu''il traite'
        using errcode = '22023', detail = 'fadeup_support_refusal=withdrawal_required';
    end if;
    -- L'ÉCHÉANCE VIENT DE LA DEMANDE, jamais d'un calcul local : c'est la
    -- promesse faite au professionnel par X2, pas une durée que le support
    -- redécide.
    select w.deadline_at into v_due
    from public.marketplace_withdrawal_requests w
    where w.id = p_withdrawal_request_id;
    if v_due is null then
      raise exception 'demande de retrait introuvable' using errcode = '42704';
    end if;
  end if;

  insert into public.support_tickets (
    reference, origin, subject, body, opened_by, assigned_to, due_at,
    subject_user_id, organization_id, professional_id, appointment_id,
    queue_entry_id, withdrawal_request_id
  )
  values (
    'T-' || lpad(nextval('public.support_ticket_reference_seq')::text, 5, '0'),
    p_origin, v_subject, nullif(btrim(coalesce(p_body, '')), ''), v_actor, v_actor, v_due,
    p_subject_user_id, p_organization_id, p_professional_id, p_appointment_id,
    p_queue_entry_id, p_withdrawal_request_id
  )
  returning * into v_ticket;

  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id, metadata)
  values (v_ticket.id, 'note', coalesce(v_ticket.body, v_ticket.subject), v_actor,
          jsonb_build_object('event', 'opened', 'origin', p_origin));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_opened', 'support_tickets', v_ticket.id,
          jsonb_build_object('origin', p_origin, 'reference', v_ticket.reference));

  return v_ticket;
end;
$function$;

create or replace function public.list_support_tickets(
  p_include_resolved boolean default false,
  p_assigned_to_me boolean default false,
  p_limit integer default 200
)
returns table (
  id uuid,
  reference text,
  origin public.support_ticket_origin,
  subject text,
  status public.support_ticket_status,
  assigned_to uuid,
  assigned_to_email text,
  due_at timestamptz,
  hours_remaining numeric,
  is_overdue boolean,
  organization_id uuid,
  organization_name text,
  professional_id uuid,
  professional_display_name text,
  withdrawal_request_id uuid,
  message_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    t.id, t.reference, t.origin, t.subject, t.status,
    t.assigned_to, au.email::text,
    t.due_at,
    case when t.due_at is null then null
         else round(extract(epoch from (t.due_at - now())) / 3600.0, 1) end,
    -- Un ticket résolu n'est jamais « en retard » : l'échéance ne court plus.
    t.status <> 'resolved' and t.due_at is not null and t.due_at < now(),
    t.organization_id, o.name,
    t.professional_id, pr.display_name,
    t.withdrawal_request_id,
    (select count(*)::integer from public.support_ticket_messages m where m.ticket_id = t.id),
    t.created_at, t.updated_at
  from public.support_tickets t
  left join auth.users au on au.id = t.assigned_to
  left join public.organizations o on o.id = t.organization_id
  left join public.professionals pr on pr.id = t.professional_id
  where (select private.platform_can('support.tickets'))
    and (p_include_resolved or t.status <> 'resolved')
    and (not p_assigned_to_me or t.assigned_to = (select auth.uid()))
  -- L'URGENCE EN TÊTE. Une file triée par date d'arrivée enterre les 72 h
  -- sous l'historique : c'est exactement le reproche de PLAT-1 §15.7.
  order by
    (t.status <> 'resolved' and t.due_at is not null and t.due_at < now()) desc,
    (t.due_at is null),
    t.due_at,
    t.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
$function$;

create or replace function public.get_support_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
  v_out jsonb;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'ticket introuvable' using errcode = '42704';
  end if;

  select jsonb_build_object(
    'ticket', to_jsonb(v_ticket)
      || jsonb_build_object(
           'assigned_to_email', (select au.email::text from auth.users au where au.id = v_ticket.assigned_to),
           'opened_by_email',   (select au.email::text from auth.users au where au.id = v_ticket.opened_by),
           'organization_name', (select o.name from public.organizations o where o.id = v_ticket.organization_id),
           'organization_slug', (select o.slug from public.organizations o where o.id = v_ticket.organization_id),
           'professional_display_name', (select pr.display_name from public.professionals pr where pr.id = v_ticket.professional_id),
           'professional_handle', (select pr.handle from public.professionals pr where pr.id = v_ticket.professional_id),
           'subject_user_email', (select au.email::text from auth.users au where au.id = v_ticket.subject_user_id),
           'hours_remaining', case when v_ticket.due_at is null then null
                                   else round(extract(epoch from (v_ticket.due_at - now())) / 3600.0, 1) end,
           'is_overdue', v_ticket.status <> 'resolved' and v_ticket.due_at is not null and v_ticket.due_at < now()
         ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'body', m.body,
               'author_email', (select au.email::text from auth.users au where au.id = m.author_user_id),
               'metadata', m.metadata, 'created_at', m.created_at)
             order by m.created_at)
      from public.support_ticket_messages m where m.ticket_id = v_ticket.id
    ), '[]'::jsonb)
  ) into v_out;

  -- OUVRIR UN TICKET, C'EST CONSULTER UN DOSSIER. Tracé comme tel.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_viewed', 'support_tickets', v_ticket.id,
          jsonb_build_object('reference', v_ticket.reference));

  return v_out;
end;
$function$;

create or replace function public.add_support_ticket_message(
  p_ticket_id uuid,
  p_body text,
  p_kind public.support_ticket_message_kind default 'note'
)
returns public.support_ticket_messages
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_message public.support_ticket_messages;
begin
  if v_body is null then
    raise exception 'un message a besoin de son texte'
      using errcode = '22023', detail = 'fadeup_support_refusal=body_required';
  end if;
  -- Les trois genres système ne s'écrivent pas à la main : ils sont la trace
  -- d'un geste, et un geste qu'on peut raconter sans l'avoir fait n'est plus
  -- une trace.
  if p_kind in ('status_change', 'assignment', 'action') then
    raise exception 'ce genre de message est écrit par le système'
      using errcode = '22023', detail = 'fadeup_support_refusal=kind_reserved';
  end if;
  if not exists (select 1 from public.support_tickets where id = p_ticket_id) then
    raise exception 'ticket introuvable' using errcode = '42704';
  end if;

  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id)
  values (p_ticket_id, p_kind, v_body, v_actor)
  returning * into v_message;

  update public.support_tickets set updated_at = now() where id = p_ticket_id;
  return v_message;
end;
$function$;

create or replace function public.assign_support_ticket(
  p_ticket_id uuid,
  p_assignee uuid
)
returns public.support_tickets
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
begin
  -- On n'assigne qu'à quelqu'un qui peut traiter. Assigner à un rôle qui
  -- n'ouvrira jamais la file, c'est perdre le ticket.
  if p_assignee is not null and not exists (
    select 1
    from public.platform_members pm
    join public.platform_role_permissions rp on rp.role = pm.role
    where pm.user_id = p_assignee and rp.permission_key = 'support.tickets'
  ) then
    raise exception 'ce compte ne traite pas les tickets'
      using errcode = '22023', detail = 'fadeup_support_refusal=assignee_not_support';
  end if;

  update public.support_tickets
     set assigned_to = p_assignee, updated_at = now()
   where id = p_ticket_id
  returning * into v_ticket;
  if not found then
    raise exception 'ticket introuvable' using errcode = '42704';
  end if;

  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id, metadata)
  values (v_ticket.id, 'assignment',
          coalesce((select au.email::text from auth.users au where au.id = p_assignee), 'non assigné'),
          v_actor, jsonb_build_object('assigned_to', p_assignee));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_assigned', 'support_tickets', v_ticket.id,
          jsonb_build_object('assigned_to', p_assignee, 'reference', v_ticket.reference));

  return v_ticket;
end;
$function$;

create or replace function public.set_support_ticket_status(
  p_ticket_id uuid,
  p_status public.support_ticket_status,
  p_resolution text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
  v_resolution text := nullif(btrim(coalesce(p_resolution, '')), '');
begin
  if p_status = 'resolved' and v_resolution is null then
    raise exception 'une résolution a besoin de son mot'
      using errcode = '22023', detail = 'fadeup_support_refusal=resolution_required';
  end if;

  update public.support_tickets
     set status = p_status,
         resolution = case when p_status = 'resolved' then v_resolution else null end,
         resolved_at = case when p_status = 'resolved' then now() else null end,
         resolved_by = case when p_status = 'resolved' then v_actor else null end,
         updated_at = now()
   where id = p_ticket_id
  returning * into v_ticket;
  if not found then
    raise exception 'ticket introuvable' using errcode = '42704';
  end if;

  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id, metadata)
  values (v_ticket.id, 'status_change', coalesce(v_resolution, p_status::text), v_actor,
          jsonb_build_object('status', p_status));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_status_changed', 'support_tickets', v_ticket.id,
          jsonb_build_object('status', p_status, 'reference', v_ticket.reference, 'resolution', v_resolution));

  return v_ticket;
end;
$function$;

comment on table public.support_tickets is
  'PLAT-2 : la file du support. Quatre origines déclarées, deux branchées (phone, gdpr_withdrawal) ; report et inbound_email refusent l''ouverture tant que rien ne les alimente.';
comment on table public.support_ticket_messages is
  'PLAT-2 : l''historique des échanges d''un ticket, en AJOUT SEUL (déclencheur, sans exemption de rôle).';

-- ---------------------------------------------------------------------------
-- 4. Les dossiers, en lecture seule et tracés
-- ---------------------------------------------------------------------------
--
-- CE QUE CES TROIS FONCTIONS N'EXPOSENT PAS, ET POURQUOI
--
--   * `customers.notes` — les notes clients privées. OS-2 pose leur modèle en
--     parallèle de ce lot ; PLAT-2 ne les rend sur AUCUNE de ses surfaces,
--     ni au support ni au commercial. Un périmètre qu'un autre lot est en
--     train de définir ne s'ouvre pas d'avance.
--   * le moyen de paiement — `billing.manage` n'est pas dans cette grille et
--     ne le devient pas ici. L'abonnement est rendu EN LECTURE : plan, statut,
--     essai. Rien d'actionnable.

create or replace function private.assert_support_dossier(p_kind text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not (select private.platform_can('support.dossier')) then
    raise exception 'consultation de dossier non autorisée'
      using errcode = '42501', detail = 'fadeup_support_refusal=dossier_not_authorized';
  end if;
  if p_id is null then
    raise exception 'un dossier a besoin de son identifiant'
      using errcode = '22023', detail = 'fadeup_support_refusal=target_required';
  end if;
  -- LA TRACE. Elle est écrite AVANT la lecture : un dossier consulté puis
  -- interrompu reste un dossier consulté.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_dossier_viewed', p_kind, p_id, jsonb_build_object('kind', p_kind));
  return v_actor;
end;
$function$;

create or replace function public.get_platform_customer_dossier(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_dossier('customer', p_user_id));
begin
  return jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'user_id', u.id, 'email', u.email::text, 'created_at', u.created_at,
        'full_name', pf.full_name, 'locale', pf.locale)
      from auth.users u
      left join public.profiles pf on pf.id = u.id
      where u.id = p_user_id
    ),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'organization_name', o.name, 'organization_slug', o.slug,
               'starts_at', a.starts_at, 'status', a.status, 'resolution', a.resolution,
               'was_request', a.was_request, 'expires_at', a.expires_at,
               'service_name', s.name)
             order by a.starts_at desc)
      from public.appointments a
      join public.organizations o on o.id = a.organization_id
      left join public.services s on s.id = a.service_id
      where a.booked_by_user_id = p_user_id
      -- Dix-huit mois : un dossier de support n'est pas un export.
      and a.starts_at > now() - interval '18 months'
    ), '[]'::jsonb),
    'queue_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'organization_name', o.name, 'location_id', q.location_id,
               'status', q.status, 'created_at', q.created_at, 'customer_name', q.customer_name)
             order by q.created_at desc)
      from public.queue_entries q
      join public.organizations o on o.id = q.organization_id
      where q.booked_by_user_id = p_user_id
    ), '[]'::jsonb),
    'interest_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'professional_handle', pr.handle, 'professional_display_name', pr.display_name,
               'service_label', r.service_label, 'preferred_starts_at', r.preferred_starts_at,
               'status', r.status, 'expires_at', r.expires_at)
             order by r.created_at desc)
      from public.professional_interest_requests r
      join public.professional_interest_request_contacts c on c.request_id = r.id
      join public.professionals pr on pr.id = r.professional_id
      where c.booked_by_user_id = p_user_id
    ), '[]'::jsonb),
    'recent_emails', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'template', e.template, 'status', e.status,
               'created_at', e.created_at, 'sent_at', e.sent_at,
               'bounced_at', e.bounced_at, 'last_error', e.last_error)
             order by e.created_at desc)
      from public.email_outbox e
      where e.to_email = (select lower(u.email::text) from auth.users u where u.id = p_user_id)
        and e.created_at > now() - interval '90 days'
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_platform_professional_dossier(p_professional_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_dossier('professional', p_professional_id));
begin
  return jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'id', pr.id, 'display_name', pr.display_name, 'handle', pr.handle,
        'claim_state', pr.claim_state, 'is_public', pr.is_public, 'source', pr.source,
        'claimed_at', pr.claimed_at, 'created_at', pr.created_at,
        'account_email', (select u.email::text from auth.users u where u.id = pr.user_id))
      from public.professionals pr where pr.id = p_professional_id
    ),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'state', c.state, 'submitted_at', c.submitted_at,
               'decided_at', c.decided_at, 'decision_note', c.decision_note,
               'claimant_email', (select u.email::text from auth.users u where u.id = c.claimant_user_id))
             order by c.submitted_at desc)
      from public.professional_claims c where c.professional_id = p_professional_id
    ), '[]'::jsonb),
    'withdrawal_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'status', w.status, 'requested_via', w.requested_via,
               'requested_at', w.requested_at, 'deadline_at', w.deadline_at,
               'hours_remaining', round(extract(epoch from (w.deadline_at - now())) / 3600.0, 1),
               'is_overdue', w.status = 'pending' and w.deadline_at < now(),
               'decided_at', w.decided_at)
             order by w.requested_at desc)
      from public.marketplace_withdrawal_requests w where w.professional_id = p_professional_id
    ), '[]'::jsonb),
    'interest_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status, 'service_label', r.service_label,
               'preferred_starts_at', r.preferred_starts_at, 'expires_at', r.expires_at,
               'created_at', r.created_at)
             order by r.created_at desc)
      from public.professional_interest_requests r where r.professional_id = p_professional_id
    ), '[]'::jsonb),
    'reviews', jsonb_build_object(
      'published', (select count(*) from public.reviews rv where rv.professional_id = p_professional_id and rv.status = 'published'),
      'moderated', (select count(*) from public.reviews rv where rv.professional_id = p_professional_id and rv.status <> 'published')
    ),
    'workplace', (
      select jsonb_build_object('organization_id', o.id, 'organization_name', o.name, 'organization_slug', o.slug)
      from public.barbers b
      join public.organizations o on o.id = b.organization_id
      where b.professional_id = p_professional_id
      limit 1
    ),
    'prospect', (
      select jsonb_build_object('prospect_id', pp.prospect_id, 'canonical_name', p.canonical_name,
                                'origin', p.origin, 'status', p.status, 'do_not_contact', p.do_not_contact)
      from public.prospect_professionals pp
      join public.prospects p on p.id = pp.prospect_id
      where pp.professional_id = p_professional_id
    )
  );
end;
$function$;

create or replace function public.get_platform_organization_dossier(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_dossier('organization', p_organization_id));
begin
  return jsonb_build_object(
    'identity', (
      select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug,
                                'business_type', o.business_type, 'country_code', o.country_code,
                                'marketplace_visible', o.marketplace_visible,
                                'onboarding_completed_at', o.onboarding_completed_at,
                                'created_at', o.created_at)
      from public.organizations o where o.id = p_organization_id
    ),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'city', l.city,
                                          'country', l.country, 'is_active', l.is_active, 'kind', l.kind)
             order by l.name)
      from public.locations l where l.organization_id = p_organization_id
    ), '[]'::jsonb),
    -- L'ABONNEMENT, EN LECTURE. Aucun geste de paiement n'est offert ici :
    -- `billing.manage` n'appartient ni au support ni au modérateur, et cette
    -- fonction ne fait que lire.
    'subscription', (
      select jsonb_build_object('plan_key', cs.plan_key, 'status', cs.status,
                                'entitlement_source', cs.entitlement_source,
                                'provider', cs.provider, 'assigned_at', cs.assigned_at)
      from public.organization_commercial_state cs where cs.organization_id = p_organization_id
    ),
    'trial', (
      select jsonb_build_object('status', tr.status, 'started_at', tr.started_at,
                                'ends_at', tr.ends_at, 'converted_at', tr.converted_at)
      from public.organization_trials tr where tr.organization_id = p_organization_id
    ),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('role', m.role,
                                          'email', (select u.email::text from auth.users u where u.id = m.user_id))
             order by m.role)
      from public.memberships m where m.organization_id = p_organization_id
    ), '[]'::jsonb),
    'upcoming_appointments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status,
                                          'customer_name', a.customer_name, 'was_request', a.was_request,
                                          'expires_at', a.expires_at)
             order by a.starts_at)
      from public.appointments a
      where a.organization_id = p_organization_id
        and a.starts_at >= now() - interval '1 day'
        and a.status in ('pending', 'confirmed')
    ), '[]'::jsonb),
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'location_id', q.location_id,
                                          'customer_name', q.customer_name, 'status', q.status,
                                          'created_at', q.created_at, 'called_at', q.called_at)
             order by q.created_at)
      from public.queue_entries q
      where q.organization_id = p_organization_id
        and q.status in ('waiting', 'called', 'in_service')
    ), '[]'::jsonb),
    'support_sessions', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', ss.started_at, 'ended_at', ss.ended_at,
                                          'expires_at', ss.expires_at, 'reason', ss.reason)
             order by ss.started_at desc)
      from public.platform_support_sessions ss
      where ss.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Les deux actions de premier niveau qui manquaient
-- ---------------------------------------------------------------------------

create or replace function public.remove_queue_entry_as_platform(
  p_entry_id uuid,
  p_reason text
)
returns public.queue_entries
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_entry public.queue_entries;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not (select private.platform_can('queue.remove')) then
    raise exception 'sortie de file non autorisée'
      using errcode = '42501', detail = 'fadeup_platform_refusal=queue_remove_required';
  end if;
  if v_reason is null then
    raise exception 'une sortie de file interne a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_platform_refusal=reason_required';
  end if;

  select * into v_entry from public.queue_entries where id = p_entry_id for update;
  if not found then
    raise exception 'entrée de file introuvable' using errcode = '42704';
  end if;
  if v_entry.status = 'cancelled' then
    return v_entry;
  end if;
  -- Une prestation commencée ou terminée ne se « sort » pas de la file : elle
  -- s'est produite. Le support ne réécrit pas l'histoire du salon.
  if v_entry.status not in ('waiting', 'called') then
    raise exception 'cette entrée n''est plus en attente'
      using errcode = '22023', detail = 'fadeup_platform_refusal=queue_entry_not_waiting';
  end if;

  update public.queue_entries
     set status = 'cancelled',
         notes = trim(both ' ' from coalesce(v_entry.notes, '') || ' [support] ' || v_reason),
         updated_at = now()
   where id = p_entry_id
  returning * into v_entry;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'queue_entry_removed_by_platform', 'queue_entries', v_entry.id,
          jsonb_build_object('organization_id', v_entry.organization_id,
                             'location_id', v_entry.location_id, 'reason', v_reason));

  return v_entry;
end;
$function$;

-- RENVOYER UN E-MAIL, C'EST EN POSTER UN NOUVEAU. La ligne d'origine n'est
-- jamais rejouée ni mutée : son `dedupe_key` la protège justement contre le
-- double envoi, et le renvoi porte le sien. Le journal d'envoi garde donc les
-- deux faits — l'envoi initial, et le renvoi demandé par un humain.
create or replace function public.resend_platform_email(
  p_email_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_source public.email_outbox;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_id uuid;
begin
  if v_actor is null or not (select private.platform_can('email.resend')) then
    raise exception 'renvoi d''e-mail non autorisé'
      using errcode = '42501', detail = 'fadeup_platform_refusal=email_resend_required';
  end if;
  if v_reason is null then
    raise exception 'un renvoi a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_platform_refusal=reason_required';
  end if;

  select * into v_source from public.email_outbox where id = p_email_id;
  if not found then
    raise exception 'e-mail introuvable' using errcode = '42704';
  end if;
  -- Un e-mail qui a rebondi durement ne se renvoie pas : X2 a posé la liste
  -- d'opposition précisément pour ça, et repousser dessus serait la contourner.
  if v_source.bounced_at is not null then
    raise exception 'cet e-mail a rebondi, il ne se renvoie pas'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_bounced';
  end if;
  -- Le marketing ne se renvoie pas à la main par-dessus les relances : B2 tient
  -- la cadence et les heures calmes, et un renvoi manuel les court-circuite.
  if v_source.stream <> 'transactional' then
    raise exception 'seul un e-mail transactionnel se renvoie'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_not_transactional';
  end if;

  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values (v_source.to_email, v_source.template, v_source.locale, v_source.payload, v_source.stream,
          'resend:' || v_source.id::text || ':' || extract(epoch from now())::bigint::text)
  returning id into v_new_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'platform_email_resent', 'email_outbox', v_new_id,
          jsonb_build_object('source_email_id', v_source.id, 'template', v_source.template, 'reason', v_reason));

  return v_new_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Les concessions, EXPLICITES (règle 4 de DB_OWNERSHIP.md)
-- ---------------------------------------------------------------------------
-- Aucune RPC de ce fichier n'est destinée à `anon` : le contrat de surface
-- anonyme reste inchangé par cette migration.

revoke all on function private.assert_support_tickets() from public, anon, authenticated;
revoke all on function private.assert_support_dossier(text, uuid) from public, anon, authenticated;

revoke all on function public.open_support_ticket(public.support_ticket_origin, text, text, uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.open_support_ticket(public.support_ticket_origin, text, text, uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.list_support_tickets(boolean, boolean, integer) from public, anon;
grant execute on function public.list_support_tickets(boolean, boolean, integer) to authenticated;

revoke all on function public.get_support_ticket(uuid) from public, anon;
grant execute on function public.get_support_ticket(uuid) to authenticated;

revoke all on function public.add_support_ticket_message(uuid, text, public.support_ticket_message_kind) from public, anon;
grant execute on function public.add_support_ticket_message(uuid, text, public.support_ticket_message_kind) to authenticated;

revoke all on function public.assign_support_ticket(uuid, uuid) from public, anon;
grant execute on function public.assign_support_ticket(uuid, uuid) to authenticated;

revoke all on function public.set_support_ticket_status(uuid, public.support_ticket_status, text) from public, anon;
grant execute on function public.set_support_ticket_status(uuid, public.support_ticket_status, text) to authenticated;

revoke all on function public.get_platform_customer_dossier(uuid) from public, anon;
grant execute on function public.get_platform_customer_dossier(uuid) to authenticated;

revoke all on function public.get_platform_professional_dossier(uuid) from public, anon;
grant execute on function public.get_platform_professional_dossier(uuid) to authenticated;

revoke all on function public.get_platform_organization_dossier(uuid) from public, anon;
grant execute on function public.get_platform_organization_dossier(uuid) to authenticated;

revoke all on function public.remove_queue_entry_as_platform(uuid, text) from public, anon;
grant execute on function public.remove_queue_entry_as_platform(uuid, text) to authenticated;

revoke all on function public.resend_platform_email(uuid, text) from public, anon;
grant execute on function public.resend_platform_email(uuid, text) to authenticated;

commit;
