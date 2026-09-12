-- FadeUp — PLAT-3 (4/5) : le pilotage du worker.
--
-- À APPLIQUER EN postgres. `private.claim_next_prospect_job` et
-- `public.create_prospect_discovery_job` appartiennent à `postgres` (vérifié),
-- et sont reprises en `create or replace` à signature inchangée : l'ACL est
-- conservée, et le worker qui les appelle ne voit aucune différence de contrat.
--
-- L'ÉTAT DES LIEUX, MESURÉ AVANT D'ÉCRIRE
--
--   * Le conteneur `fadeup-prospect-worker-v2` est `Exited (0)` depuis six
--     jours — arrêté pendant l'incident disque du 2026-09-05 et laissé en bas
--     volontairement (infra/ops/README.md §3).
--   * Il n'existe AUCUN drapeau de pause : ni colonne, ni variable
--     d'environnement, ni fichier. Le seul « pause » disponible est
--     `docker stop`. Ce qui existe est par SOURCE
--     (`prospect_sources.is_enabled`, `api_source_health.is_paused`), et
--     `claim_next_prospect_job` ne le consulte même pas.
--   * Le battement du worker est un FICHIER dans le conteneur
--     (`/tmp/prospect-worker-heartbeat`, lu par le HEALTHCHECK Docker). Il
--     N'ATTEINT JAMAIS LA BASE. X1 ne le supervise pas non plus : le
--     conteneur est explicitement exclu d'`EXPECTED_CONTAINERS`.
--
-- LA DÉCISION, ET POURQUOI ELLE NE TOUCHE PAS AU CODE DU WORKER
--
-- Le worker interroge `private.claim_next_prospect_job` toutes les cinq
-- secondes, par voie. Cette fonction est donc, déjà, le battement — il suffit
-- de l'écrire. C'est ce que fait ce fichier : chaque sondage inscrit
-- `last_poll_at` et l'identifiant de la voie. AUCUNE ligne du worker ne
-- change, AUCUN conteneur n'est reconstruit, et le battement est vrai parce
-- qu'il est produit par le geste lui-même et non par une déclaration.
--
-- Et c'est ce qui rend la PAUSE distincte d'une PANNE, exigence du lot :
--   * en pause   → `is_paused` vrai ET `last_poll_at` récent  ;
--   * en panne   → `last_poll_at` vieux, quoi que dise `is_paused`.
-- Un worker en pause continue de sonder, il ne reçoit simplement rien.
--
-- LE CAS NUL, partout.

begin;

-- ---------------------------------------------------------------------------
-- 1. Le droit
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('worker.operate', 'Piloter le worker d''acquisition : voir son état, lancer une passe, mettre en pause. Chaque geste est tracé.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key)
select r.role, 'worker.operate'
from (values ('platform_owner'::public.platform_role), ('platform_admin'::public.platform_role)) as r(role)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. L'état
-- ---------------------------------------------------------------------------

create table if not exists public.prospect_worker_state (
  id                  boolean primary key default true,
  is_paused           boolean not null default false,
  paused_at           timestamptz,
  paused_by           uuid references auth.users (id) on delete set null,
  pause_reason        text,
  last_poll_at        timestamptz,
  last_poll_worker_id text,
  last_claim_at       timestamptz,
  updated_at          timestamptz not null default now(),
  constraint prospect_worker_state_singleton check (id),
  constraint prospect_worker_state_pause_shape check (
    not is_paused
    or (paused_at is not null and nullif(btrim(coalesce(pause_reason, '')), '') is not null)
  ),
  constraint prospect_worker_state_reason_length check (pause_reason is null or char_length(pause_reason) <= 500)
);

insert into public.prospect_worker_state (id) values (true) on conflict (id) do nothing;

comment on table public.prospect_worker_state is
  'Une seule ligne, garantie par la clé primaire booléenne. `last_poll_at` est écrit par claim_next_prospect_job à chaque sondage du worker : c''est le battement, produit par le geste et non déclaré. La pause se lit avec lui — pause = sondages récents SANS travail ; panne = plus de sondage du tout.';

alter table public.prospect_worker_state enable row level security;
alter table public.prospect_worker_state force row level security;

drop policy if exists prospect_worker_state_select on public.prospect_worker_state;
create policy prospect_worker_state_select on public.prospect_worker_state
  for select to authenticated
  using ((select private.platform_can('worker.operate')));

revoke insert, update, delete, truncate on public.prospect_worker_state from anon, authenticated;
revoke all on public.prospect_worker_state from anon;
grant select on public.prospect_worker_state to authenticated;
-- Le worker tourne sous son propre rôle : il écrit le battement à travers
-- claim_next_prospect_job, SECURITY DEFINER, donc aucune concession directe
-- n'est nécessaire ici. C'est volontaire : le worker n'a pas à pouvoir se
-- dépauser lui-même.

-- ---------------------------------------------------------------------------
-- 3. Le battement et la pause, dans la fonction que le worker appelle déjà
-- ---------------------------------------------------------------------------
--
-- Corps repris VERBATIM, avec deux ajouts en tête : l'écriture du battement,
-- puis le refus de servir quand la pause est levée.

create or replace function private.claim_next_prospect_job(p_worker_id text, p_lease_seconds integer default 300)
returns public.prospect_jobs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.prospect_jobs;
  v_paused boolean;
  v_claimed boolean := false;
begin
  -- La pause se LIT sans verrou. L'écriture du battement vient en dernier,
  -- volontairement : `claim_next_prospect_job` est appelée par trois voies
  -- concurrentes et tout son intérêt est de ne pas les sérialiser
  -- (`for update skip locked`). Un verrou de ligne pris en tête serait tenu
  -- jusqu'au commit et referait, à lui seul, la file d'attente que B1 avait
  -- pris soin d'éviter.
  select s.is_paused into v_paused from public.prospect_worker_state s where s.id;

  -- Ligne d'état absente (restauration partielle, retour arrière en cours) :
  -- on ne s'arrête pas de travailler pour autant. Le défaut est de SERVIR,
  -- parce qu'un worker muet coûte plus cher qu'un worker qui tourne.
  if not coalesce(v_paused, false) then
    select * into v_job
    from public.prospect_jobs
    where status in ('queued', 'retry') and scheduled_at <= now()
    order by priority desc, scheduled_at
    for update skip locked
    limit 1;

    if found then
      update public.prospect_jobs
      set status = 'running',
          worker_id = p_worker_id,
          lease_until = now() + make_interval(secs => p_lease_seconds),
          started_at = coalesce(started_at, now()),
          attempts = attempts + 1
      where id = v_job.id
      returning * into v_job;
      v_claimed := true;
    end if;
  end if;

  -- LE BATTEMENT. Écrit à chaque sondage, Y COMPRIS EN PAUSE : c'est
  -- précisément ce qui distingue une pause d'une panne.
  update public.prospect_worker_state
     set last_poll_at = now(),
         last_poll_worker_id = p_worker_id,
         last_claim_at = case when v_claimed then now() else last_claim_at end,
         updated_at = now()
   where id;

  if not v_claimed then
    return null;
  end if;

  return v_job;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Les RPC de pilotage
-- ---------------------------------------------------------------------------

create or replace function public.get_prospect_worker_state()
returns table (
  is_paused boolean,
  paused_at timestamptz,
  paused_by_email text,
  pause_reason text,
  last_poll_at timestamptz,
  seconds_since_last_poll integer,
  last_poll_worker_id text,
  last_claim_at timestamptz,
  -- « Depuis quand » : le premier sondage d'une série ininterrompue est
  -- inconnaissable en base — on ne garde pas l'historique des battements. Ce
  -- qui est vrai et utile, c'est la dernière passe réussie.
  last_successful_pass_at timestamptz,
  jobs_queued integer,
  jobs_running integer,
  jobs_failed integer,
  prospects_total integer,
  prospects_last_7_days integer,
  is_live boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  c_live_within constant interval := interval '60 seconds';
begin
  if (select auth.uid()) is null or not (select private.platform_can('worker.operate')) then
    raise exception 'piloting the acquisition worker is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_worker_refusal=not_authorized';
  end if;

  return query
  select
    s.is_paused, s.paused_at, u.email::text, s.pause_reason,
    s.last_poll_at,
    case when s.last_poll_at is null then null
         else extract(epoch from (now() - s.last_poll_at))::integer end,
    s.last_poll_worker_id, s.last_claim_at,
    (select max(j.completed_at) from public.prospect_jobs j where j.status = 'completed'),
    (select count(*)::integer from public.prospect_jobs j where j.status in ('queued', 'retry')),
    (select count(*)::integer from public.prospect_jobs j where j.status = 'running'),
    (select count(*)::integer from public.prospect_jobs j where j.status = 'failed'),
    (select count(*)::integer from public.prospects),
    (select count(*)::integer from public.prospects p where p.first_discovered_at >= now() - interval '7 days'),
    -- « Vivant » est une MESURE, pas une déclaration : le worker sonde toutes
    -- les cinq secondes, donc une minute sans sondage veut dire qu'il n'est
    -- plus là. NULL (jamais vu) rend false, jamais NULL.
    coalesce(s.last_poll_at >= now() - c_live_within, false)
  from public.prospect_worker_state s
  left join auth.users u on u.id = s.paused_by
  where s.id;
end;
$function$;

comment on function public.get_prospect_worker_state() is
  'L''état réel du worker : est-il en train de sonder, est-il en pause, quand a-t-il terminé sa dernière passe, combien de travaux attendent. `is_live` est mesuré sur le battement, jamais supposé — un worker arrêté rend false même s''il n''est pas en pause, et c''est ainsi qu''une panne se distingue d''une pause.';

create or replace function public.set_prospect_worker_paused(p_paused boolean, p_reason text default null)
returns public.prospect_worker_state
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_reason text;
  v_row public.prospect_worker_state;
  v_was boolean;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('worker.operate')) then
    raise exception 'pausing the acquisition worker is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_worker_refusal=not_authorized';
  end if;

  if p_paused is null then
    raise exception 'a target state is required'
      using errcode = '22023', detail = 'fadeup_worker_refusal=missing_argument';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_paused and v_reason is null then
    raise exception 'pausing the worker requires a reason'
      using errcode = '22023', detail = 'fadeup_worker_refusal=reason_required';
  end if;

  select s.is_paused into v_was from public.prospect_worker_state s where s.id;

  update public.prospect_worker_state
     set is_paused = p_paused,
         paused_at = case when p_paused then now() else null end,
         paused_by = case when p_paused then v_actor else null end,
         pause_reason = case when p_paused then v_reason else null end,
         updated_at = now()
   where id
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor,
          case when p_paused then 'prospect_worker_paused' else 'prospect_worker_resumed' end,
          'prospect_worker_state', null,
          jsonb_build_object('was_paused', v_was, 'reason', v_reason));

  return v_row;
end;
$function$;

create or replace function public.list_prospect_worker_passes(p_limit integer default 50)
returns table (
  id uuid,
  job_type text,
  status public.prospect_job_status,
  priority integer,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  attempts integer,
  worker_id text,
  launched_by_email text,
  -- « Combien trouvés, combien retenus, combien d'erreurs » : les compteurs
  -- vivent dans `result` (jsonb), dont la forme varie par type de travail. On
  -- lit les deux formes observées et on rend NULL plutôt que zéro quand la
  -- clé n'existe pas — un zéro inventé vaut moins que rien.
  candidates_found integer,
  prospects_created integer,
  sources_total integer,
  sources_failed integer,
  last_error text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not (select private.platform_can('worker.operate')) then
    raise exception 'reading the worker log is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_worker_refusal=not_authorized';
  end if;

  return query
  select
    j.id, j.job_type, j.status, j.priority,
    j.created_at, j.started_at, j.completed_at, j.failed_at,
    j.attempts, j.worker_id, u.email::text,
    coalesce((j.result -> 'candidatesFound')::text::integer,
             (j.result -> 'candidates_found')::text::integer),
    coalesce((j.result -> 'prospectsCreated')::text::integer,
             (j.result -> 'prospects_created')::text::integer),
    (select count(*)::integer from public.prospect_job_sources s where s.job_id = j.id),
    (select count(*)::integer from public.prospect_job_sources s where s.job_id = j.id and s.status = 'failed'),
    j.last_error
  from public.prospect_jobs j
  left join auth.users u on u.id = j.created_by
  order by j.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Lancer une passe : la RPC existante, avec sa trace
-- ---------------------------------------------------------------------------
--
-- Corps repris VERBATIM de la production, à deux ajouts près : la garde passe
-- par la grille (`worker.operate`, portée par le fondateur et l'admin —
-- exactement l'ensemble que `is_platform_admin()` désignait, prouvé par la
-- suite de permissions) et le lancement écrit au journal. Le cahier des
-- charges l'exige : « une trace de qui a lancé ».
--
-- La CONFIRMATION avant lancement est une affaire d'interface — une RPC ne
-- peut pas demander « êtes-vous sûr ». Ce qu'elle peut faire, et fait ici,
-- c'est laisser la trace qui rend un lancement par erreur explicable.

create or replace function public.create_prospect_discovery_job(
  p_job_type text,
  p_payload jsonb,
  p_source_keys text[] default null,
  p_priority integer default 100
)
returns public.prospect_jobs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.prospect_jobs;
  v_source record;
  v_actor uuid;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('worker.operate')) then
    raise exception 'only a platform owner or platform_admin may create a prospect job'
      using errcode = '42501', detail = 'fadeup_worker_refusal=not_authorized';
  end if;

  if p_job_type not in ('discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich') then
    raise exception 'invalid job_type: %', p_job_type;
  end if;

  insert into public.prospect_jobs (job_type, payload, priority, created_by)
  values (p_job_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_priority, 100), v_actor)
  returning * into v_job;

  for v_source in
    select id, is_enabled from public.prospect_sources
    where p_source_keys is null or key = any (p_source_keys)
  loop
    insert into public.prospect_job_sources (job_id, source_id, status)
    values (v_job.id, v_source.id, (case when v_source.is_enabled then 'pending' else 'skipped' end)::public.prospect_job_source_status);
  end loop;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'prospect_worker_pass_launched', 'prospect_jobs', v_job.id,
          jsonb_build_object('job_type', p_job_type, 'priority', v_job.priority,
                             'source_keys', to_jsonb(p_source_keys)));

  return v_job;
end;
$function$;

revoke all on function public.get_prospect_worker_state() from public, anon;
revoke all on function public.set_prospect_worker_paused(boolean, text) from public, anon;
revoke all on function public.list_prospect_worker_passes(integer) from public, anon;
grant execute on function public.get_prospect_worker_state() to authenticated;
grant execute on function public.set_prospect_worker_paused(boolean, text) to authenticated;
grant execute on function public.list_prospect_worker_passes(integer) to authenticated;

commit;
