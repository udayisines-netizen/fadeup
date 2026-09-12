-- Retour arrière de 20260912100300_plat3_worker_pilot.sql — EN postgres.
--
-- CE QU'IL DÉTRUIT :
--
--   * la table `prospect_worker_state` — donc LE BATTEMENT et LA PAUSE. Après
--     ce retour arrière, la base ne sait plus dire si le worker tourne, et
--     `docker stop` redevient le seul moyen de l'arrêter. Un worker laissé en
--     pause au moment du retour arrière REPART IMMÉDIATEMENT : la pause
--     disparaît avec la table, et le défaut de la fonction restaurée est de
--     servir. À savoir avant de l'ordonner.
--   * le droit `worker.operate` et ses deux attributions ; la garde de
--     `create_prospect_discovery_job` redevient `is_platform_admin()`, qui
--     désigne exactement les deux mêmes rôles — aucun élargissement.
--   * la trace `prospect_worker_pass_launched` cesse d'être écrite. Les lignes
--     déjà au journal restent : il est en ajout seul.
--
-- Les deux fonctions reprennent le corps EXACT d'avant PLAT-3, extrait de la
-- production le 2026-09-12.

begin;

CREATE OR REPLACE FUNCTION private.claim_next_prospect_job(p_worker_id text, p_lease_seconds integer DEFAULT 300)
 RETURNS prospect_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.prospect_jobs;
begin
  select * into v_job
  from public.prospect_jobs
  where status in ('queued', 'retry') and scheduled_at <= now()
  order by priority desc, scheduled_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.prospect_jobs
  set status = 'running',
      worker_id = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_prospect_discovery_job(p_job_type text, p_payload jsonb, p_source_keys text[] DEFAULT NULL::text[], p_priority integer DEFAULT 100)
 RETURNS prospect_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job public.prospect_jobs;
  v_source record;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may create a prospect job';
  end if;

  if p_job_type not in ('discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich') then
    raise exception 'invalid job_type: %', p_job_type;
  end if;

  insert into public.prospect_jobs (job_type, payload, priority, created_by)
  values (p_job_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_priority, 100), (select auth.uid()))
  returning * into v_job;

  for v_source in
    select id, is_enabled from public.prospect_sources
    where p_source_keys is null or key = any (p_source_keys)
  loop
    insert into public.prospect_job_sources (job_id, source_id, status)
    values (v_job.id, v_source.id, (case when v_source.is_enabled then 'pending' else 'skipped' end)::public.prospect_job_source_status);
  end loop;

  return v_job;
end;
$function$;

drop function if exists public.list_prospect_worker_passes(integer);
drop function if exists public.set_prospect_worker_paused(boolean, text);
drop function if exists public.get_prospect_worker_state();

drop policy if exists prospect_worker_state_select on public.prospect_worker_state;
drop table if exists public.prospect_worker_state;

delete from public.platform_role_permissions where permission_key = 'worker.operate';
delete from public.platform_permissions where key = 'worker.operate';

commit;
