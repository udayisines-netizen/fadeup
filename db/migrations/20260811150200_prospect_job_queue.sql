-- FadeUp — Prospect Worker V2
-- Migration: durable job queue + API quota tracking
--
-- PostgreSQL IS the job queue for V1 — no Redis (per spec). Claiming uses
-- `FOR UPDATE SKIP LOCKED` so multiple worker processes/threads can poll
-- concurrently without blocking each other on a locked row (see
-- private.claim_next_prospect_job below). Stale leases (a worker that died
-- mid-job without marking it failed) are recovered by
-- public.recover_stale_prospect_job_leases(), callable by the Worker's own
-- periodic sweep — no pg_cron dependency, matching the same "no pg_cron
-- available in this container without a restart-requiring config change"
-- constraint already documented in 20260810100000_waitlist_and_no_show_rules.sql
-- for LOT 13's no-show sweep.
--
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_job_status') then
    create type public.prospect_job_status as enum ('queued', 'running', 'retry', 'completed', 'failed', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prospect_job_source_status') then
    create type public.prospect_job_source_status as enum ('pending', 'running', 'completed', 'failed', 'skipped');
  end if;
end $$;

-- prospect_jobs -----------------------------------------------------------------
create table if not exists public.prospect_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich')),
  status public.prospect_job_status not null default 'queued',
  priority int not null default 100,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts > 0),
  scheduled_at timestamptz not null default now(),
  worker_id text,
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prospect_jobs is
  'Durable job queue — PostgreSQL is the queue, no Redis. created_by null means system-scheduled (e.g. a recurring dedup_scan), not a platform-staff-initiated search.';

-- The one index claiming actually needs: cheapest-first scan of
-- claimable rows, ordered by priority (higher first) then age (older
-- first, avoiding starvation).
create index if not exists prospect_jobs_claim_idx
  on public.prospect_jobs (priority desc, scheduled_at)
  where status in ('queued', 'retry');

create index if not exists prospect_jobs_status_idx on public.prospect_jobs (status);
create index if not exists prospect_jobs_lease_until_idx on public.prospect_jobs (lease_until) where status = 'running';
create index if not exists prospect_jobs_created_at_idx on public.prospect_jobs (created_at desc);

drop trigger if exists prospect_jobs_set_updated_at on public.prospect_jobs;
create trigger prospect_jobs_set_updated_at
  before update on public.prospect_jobs
  for each row execute function public.set_updated_at();

-- prospect_source_records.job_id -> prospect_jobs.id, added now that
-- prospect_jobs exists (see 20260811150100's header note on this table).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'prospect_source_records_job_id_fkey'
      and conrelid = 'public.prospect_source_records'::regclass
  ) then
    alter table public.prospect_source_records
      add constraint prospect_source_records_job_id_fkey
      foreign key (job_id) references public.prospect_jobs (id) on delete set null;
  end if;
end $$;

-- prospect_job_sources ------------------------------------------------------
create table if not exists public.prospect_job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.prospect_jobs (id) on delete cascade,
  source_id uuid not null references public.prospect_sources (id),
  status public.prospect_job_source_status not null default 'pending',
  candidates_found int not null default 0 check (candidates_found >= 0),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, source_id)
);

comment on table public.prospect_job_sources is
  'Per-source progress within a discovery/enrichment job. A failed source_id here does not fail the whole job — see spec: "a failed source must not destroy the entire discovery job".';

create index if not exists prospect_job_sources_job_id_idx on public.prospect_job_sources (job_id);

drop trigger if exists prospect_job_sources_set_updated_at on public.prospect_job_sources;
create trigger prospect_job_sources_set_updated_at
  before update on public.prospect_job_sources
  for each row execute function public.set_updated_at();

-- api_usage (append-only per-call log) ---------------------------------------
create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.prospect_sources (id),
  job_id uuid references public.prospect_jobs (id) on delete set null,
  endpoint text,
  success boolean not null,
  status_code int,
  latency_ms int check (latency_ms is null or latency_ms >= 0),
  error text,
  requested_at timestamptz not null default now()
);

comment on table public.api_usage is 'Append-only per-call log for every source adapter request. api_source_health holds the rolling aggregates derived from this.';

create index if not exists api_usage_source_id_requested_at_idx on public.api_usage (source_id, requested_at desc);

revoke update, delete on public.api_usage from anon, authenticated, prospect_worker;
grant insert on public.api_usage to prospect_worker;

-- api_source_limits (configured budgets) -------------------------------------
create table if not exists public.api_source_limits (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique references public.prospect_sources (id),
  max_requests_per_minute int check (max_requests_per_minute is null or max_requests_per_minute > 0),
  max_requests_per_day int check (max_requests_per_day is null or max_requests_per_day > 0),
  max_requests_per_month int check (max_requests_per_month is null or max_requests_per_month > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.api_source_limits is 'Locally configurable quota/budget guards, independent per source — reaching one source''s limit pauses only that source (see api_source_health.is_paused).';

drop trigger if exists api_source_limits_set_updated_at on public.api_source_limits;
create trigger api_source_limits_set_updated_at
  before update on public.api_source_limits
  for each row execute function public.set_updated_at();

-- Sensible starting defaults, editable by platform_admin afterward.
insert into public.api_source_limits (source_id, max_requests_per_minute, max_requests_per_day, max_requests_per_month)
select id,
  case key when 'google_places' then 20 when 'geoapify' then 5 when 'sirene' then 10 when 'instagram' then 10 else null end,
  case key when 'google_places' then 1000 when 'geoapify' then 3000 when 'sirene' then 5000 when 'instagram' then 500 else null end,
  case key when 'google_places' then 10000 when 'geoapify' then 90000 when 'sirene' then null when 'instagram' then 10000 else null end
from public.prospect_sources
on conflict (source_id) do nothing;

-- api_source_health (rolling aggregates + pause flag) --------------------------
create table if not exists public.api_source_health (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique references public.prospect_sources (id),
  requests_today int not null default 0 check (requests_today >= 0),
  requests_this_month int not null default 0 check (requests_this_month >= 0),
  success_count int not null default 0 check (success_count >= 0),
  failure_count int not null default 0 check (failure_count >= 0),
  rate_limited_count int not null default 0 check (rate_limited_count >= 0),
  avg_latency_ms numeric,
  last_request_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  is_paused boolean not null default false,
  paused_reason text,
  last_reset_day date not null default current_date,
  last_reset_month date not null default date_trunc('month', current_date)::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.api_source_health is
  'Rolling per-source counters, derived from api_usage by private.record_api_usage(). requests_today/requests_this_month reset lazily on first use after a day/month rollover (no pg_cron — see migration header).';

insert into public.api_source_health (source_id)
select id from public.prospect_sources
on conflict (source_id) do nothing;

drop trigger if exists api_source_health_set_updated_at on public.api_source_health;
create trigger api_source_health_set_updated_at
  before update on public.api_source_health
  for each row execute function public.set_updated_at();

-- Row level security --------------------------------------------------------
do $$
declare
  t text;
  all_tables text[] := array['prospect_jobs', 'prospect_job_sources', 'api_usage', 'api_source_limits', 'api_source_health'];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I_select_platform_staff on public.%I', t, t);
    execute format(
      'create policy %I_select_platform_staff on public.%I for select to authenticated using ((select private.has_platform_role(array[''platform_owner'',''platform_admin'',''platform_support'']::public.platform_role[])))',
      t, t
    );

    execute format('drop policy if exists %I_all_prospect_worker on public.%I', t, t);
    execute format('create policy %I_all_prospect_worker on public.%I for all to prospect_worker using (true) with check (true)', t, t);
  end loop;

  -- api_usage is append-only even for the Worker (see revoke update/delete
  -- above); its ALL policy is intentionally still correct because the table
  -- grant, not the policy, is what actually blocks UPDATE/DELETE.
  execute 'grant select, insert on public.prospect_jobs to prospect_worker';
  execute 'grant select, insert, update on public.prospect_job_sources to prospect_worker';
  execute 'grant select, insert on public.api_usage to prospect_worker';
  execute 'grant select, update on public.api_source_limits to prospect_worker';
  execute 'grant select, update on public.api_source_health to prospect_worker';
end
$$;

-- prospect_jobs: platform_owner/platform_admin can create discovery jobs
-- from the Search UI and cancel their own or any job. Regular UPDATE
-- (status/attempts/lease_until/...) is Worker-only — a platform admin
-- cancelling a job goes through public.cancel_prospect_job() below, not a
-- raw UPDATE, so cancellation is validated (only queued/retry/running jobs
-- can be cancelled) and audited via prospect_jobs.result.
drop policy if exists prospect_jobs_insert_platform_admin on public.prospect_jobs;
create policy prospect_jobs_insert_platform_admin
  on public.prospect_jobs
  for insert
  to authenticated
  with check ((select private.is_platform_admin()));

-- create_prospect_discovery_job -------------------------------------------------
-- The one client-facing way to enqueue work. Validates job_type/entity
-- selection, resolves the requested source keys to prospect_source_records
-- rows (skipping disabled sources rather than failing outright — "adapters
-- must be independently enableable"), and returns the created job.
create or replace function public.create_prospect_discovery_job(
  p_job_type text,
  p_payload jsonb,
  p_source_keys text[] default null,
  p_priority int default 100
)
returns public.prospect_jobs
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function public.create_prospect_discovery_job(text, jsonb, text[], int) is
  'Platform owner/admin only. Enqueues a prospect_jobs row and one prospect_job_sources row per requested (or all, if p_source_keys is null) source — disabled sources are recorded as skipped, not omitted, so the UI can show why a source did not run.';

revoke execute on function public.create_prospect_discovery_job(text, jsonb, text[], int) from public, anon;
grant execute on function public.create_prospect_discovery_job(text, jsonb, text[], int) to authenticated;

-- cancel_prospect_job -------------------------------------------------------
create or replace function public.cancel_prospect_job(p_id uuid)
returns public.prospect_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.prospect_jobs;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may cancel a prospect job';
  end if;

  update public.prospect_jobs
  set status = 'cancelled'
  where id = p_id and status in ('queued', 'retry', 'running')
  returning * into v_job;

  if not found then
    raise exception 'job not found or not in a cancellable state';
  end if;

  return v_job;
end;
$$;

comment on function public.cancel_prospect_job(uuid) is 'Platform owner/admin only. Cancels a queued/retry/running job. No-op-safe: raises if the job is already terminal.';

revoke execute on function public.cancel_prospect_job(uuid) from public, anon;
grant execute on function public.cancel_prospect_job(uuid) to authenticated;

-- Job-claiming primitives (private schema — never exposed via PostgREST,
-- called only by the Worker's own direct psql connection as prospect_worker) --

-- claim_next_prospect_job: the core queue primitive. FOR UPDATE SKIP LOCKED
-- means N concurrent worker processes calling this simultaneously will each
-- get a DIFFERENT row (or none), never block on each other, and never
-- double-claim — Postgres guarantees a locked row is invisible to another
-- SKIP LOCKED scan until the lock releases (commit).
create or replace function private.claim_next_prospect_job(p_worker_id text, p_lease_seconds int default 300)
returns public.prospect_jobs
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function private.claim_next_prospect_job(text, int) is
  'Atomically claims the next runnable job via FOR UPDATE SKIP LOCKED. Never exposed to PostgREST (private schema) — called only over the Worker''s direct psql connection.';

revoke execute on function private.claim_next_prospect_job(text, int) from public, anon, authenticated;
grant execute on function private.claim_next_prospect_job(text, int) to prospect_worker;

-- extend_prospect_job_lease: a long-running job (e.g. a big discovery run)
-- calls this periodically to push its lease forward, so
-- recover_stale_prospect_job_leases() does not mistake genuinely in-progress
-- work for an abandoned job.
create or replace function private.extend_prospect_job_lease(p_id uuid, p_worker_id text, p_lease_seconds int default 300)
returns public.prospect_jobs
language sql
security definer
set search_path = ''
as $$
  update public.prospect_jobs
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_id and worker_id = p_worker_id and status = 'running'
  returning *;
$$;

revoke execute on function private.extend_prospect_job_lease(uuid, text, int) from public, anon, authenticated;
grant execute on function private.extend_prospect_job_lease(uuid, text, int) to prospect_worker;

-- complete_prospect_job -------------------------------------------------------
create or replace function private.complete_prospect_job(p_id uuid, p_worker_id text, p_result jsonb default '{}'::jsonb)
returns public.prospect_jobs
language sql
security definer
set search_path = ''
as $$
  update public.prospect_jobs
  set status = 'completed', result = coalesce(p_result, '{}'::jsonb), completed_at = now(), lease_until = null
  where id = p_id and worker_id = p_worker_id and status = 'running'
  returning *;
$$;

revoke execute on function private.complete_prospect_job(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.complete_prospect_job(uuid, text, jsonb) to prospect_worker;

-- fail_prospect_job: retry vs terminal-failure decision lives here, not in
-- the Worker, so it is enforced consistently regardless of which Worker
-- process makes the call — attempts >= max_attempts is terminal, otherwise
-- the job goes back to 'retry' with an exponential-backoff-with-jitter
-- schedule computed by the caller and passed in as p_next_attempt_at (the
-- Worker owns the backoff math since it varies by error class — 429 vs
-- permission failure — per spec's retry engine section).
create or replace function private.fail_prospect_job(
  p_id uuid,
  p_worker_id text,
  p_error text,
  p_retryable boolean,
  p_next_attempt_at timestamptz default null
)
returns public.prospect_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.prospect_jobs;
begin
  select * into v_job from public.prospect_jobs where id = p_id and worker_id = p_worker_id and status = 'running';

  if not found then
    return null;
  end if;

  if p_retryable and v_job.attempts < v_job.max_attempts then
    update public.prospect_jobs
    set status = 'retry',
        last_error = p_error,
        lease_until = null,
        scheduled_at = coalesce(p_next_attempt_at, now())
    where id = p_id
    returning * into v_job;
  else
    update public.prospect_jobs
    set status = 'failed', last_error = p_error, failed_at = now(), lease_until = null
    where id = p_id
    returning * into v_job;
  end if;

  return v_job;
end;
$$;

comment on function private.fail_prospect_job(uuid, text, text, boolean, timestamptz) is
  'p_retryable=false (invalid credentials, bad request, permission failure) always goes straight to failed, ignoring max_attempts — see spec: "Do not endlessly retry invalid credentials/bad request/permission failure."';

revoke execute on function private.fail_prospect_job(uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function private.fail_prospect_job(uuid, text, text, boolean, timestamptz) to prospect_worker;

-- recover_stale_prospect_job_leases -------------------------------------------
-- A worker process that crashed/was killed mid-job leaves a 'running' row
-- whose lease_until has passed. This puts such rows back into 'retry' (or
-- 'failed' if out of attempts) so they are not lost forever. No pg_cron in
-- this container (see migration header) — called opportunistically by the
-- Worker itself at the top of every poll cycle, same pattern as LOT 13's
-- no-show rule.
create or replace function public.recover_stale_prospect_job_leases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    select id from public.prospect_jobs
    where status = 'running' and lease_until is not null and lease_until < now()
    for update skip locked
  )
  update public.prospect_jobs j
  set status = (case when j.attempts >= j.max_attempts then 'failed' else 'retry' end)::public.prospect_job_status,
      failed_at = case when j.attempts >= j.max_attempts then now() else j.failed_at end,
      last_error = 'stale lease recovered: worker did not complete or heartbeat before lease_until',
      lease_until = null,
      worker_id = null
  from stale
  where j.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.recover_stale_prospect_job_leases() is
  'Recovers jobs whose lease expired without completion (crashed/killed worker). Callable by any platform_worker/admin caller — SECURITY INVOKER would also work here since it only touches rows RLS already allows the Worker to touch, but DEFINER keeps it callable from a CLI/admin context too without needing prospect_worker''s own grants.';

revoke execute on function public.recover_stale_prospect_job_leases() from public, anon;
grant execute on function public.recover_stale_prospect_job_leases() to authenticated, prospect_worker;

-- record_api_usage ------------------------------------------------------------
-- Single entry point the Worker calls after every provider request: writes
-- the raw api_usage row AND updates the api_source_health rolling
-- aggregate atomically, including lazy day/month counter resets.
create or replace function private.record_api_usage(
  p_source_key text,
  p_job_id uuid,
  p_endpoint text,
  p_success boolean,
  p_status_code int,
  p_latency_ms int,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_is_rate_limited boolean := p_status_code = 429;
begin
  select id into v_source_id from public.prospect_sources where key = p_source_key;
  if v_source_id is null then
    raise exception 'unknown source key: %', p_source_key;
  end if;

  insert into public.api_usage (source_id, job_id, endpoint, success, status_code, latency_ms, error)
  values (v_source_id, p_job_id, p_endpoint, p_success, p_status_code, p_latency_ms, p_error);

  update public.api_source_health
  set requests_today = case when last_reset_day = v_today then requests_today + 1 else 1 end,
      requests_this_month = case when last_reset_month = v_month then requests_this_month + 1 else 1 end,
      last_reset_day = v_today,
      last_reset_month = v_month,
      success_count = success_count + case when p_success then 1 else 0 end,
      failure_count = failure_count + case when p_success then 0 else 1 end,
      rate_limited_count = rate_limited_count + case when v_is_rate_limited then 1 else 0 end,
      avg_latency_ms = case
        when p_latency_ms is null then avg_latency_ms
        when avg_latency_ms is null then p_latency_ms
        else (avg_latency_ms * (success_count + failure_count) + p_latency_ms) / (success_count + failure_count + 1)
      end,
      last_request_at = now(),
      last_success_at = case when p_success then now() else last_success_at end,
      last_failure_at = case when p_success then last_failure_at else now() end,
      last_error = case when p_success then last_error else p_error end
  where source_id = v_source_id;
end;
$$;

comment on function private.record_api_usage(text, uuid, text, boolean, int, int, text) is
  'Worker calls this after every provider HTTP request. Resets requests_today/requests_this_month lazily on the first call after a day/month rollover — no pg_cron dependency.';

revoke execute on function private.record_api_usage(text, uuid, text, boolean, int, int, text) from public, anon, authenticated;
grant execute on function private.record_api_usage(text, uuid, text, boolean, int, int, text) to prospect_worker;

-- is_prospect_source_paused: quota-guard check the Worker calls BEFORE
-- making a request. is_paused is a manual/automatic override; the
-- day/month counters vs api_source_limits are checked here too so a
-- source auto-pauses the instant it would exceed its configured budget,
-- without needing a separate cron sweep.
create or replace function private.is_prospect_source_paused(p_source_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(h.is_paused, false)
    or (l.max_requests_per_day is not null and h.last_reset_day = current_date and h.requests_today >= l.max_requests_per_day)
    or (l.max_requests_per_month is not null and h.last_reset_month = date_trunc('month', current_date)::date and h.requests_this_month >= l.max_requests_per_month)
  from public.prospect_sources s
  join public.api_source_health h on h.source_id = s.id
  left join public.api_source_limits l on l.source_id = s.id
  where s.key = p_source_key;
$$;

comment on function private.is_prospect_source_paused(text) is
  'True if this source should not be called right now — manual pause OR today''s/this month''s configured budget already reached. One provider hitting quota pauses only that provider.';

revoke execute on function private.is_prospect_source_paused(text) from public, anon, authenticated;
grant execute on function private.is_prospect_source_paused(text) to prospect_worker;

-- set_prospect_source_enabled / set_prospect_source_paused ---------------------
-- Platform-admin controls surfaced in the Sources UI.
create or replace function public.set_prospect_source_enabled(p_key text, p_enabled boolean)
returns public.prospect_sources
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.prospect_sources;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may change source configuration';
  end if;

  update public.prospect_sources set is_enabled = p_enabled where key = p_key returning * into v_source;

  if not found then
    raise exception 'unknown source key: %', p_key;
  end if;

  return v_source;
end;
$$;

revoke execute on function public.set_prospect_source_enabled(text, boolean) from public, anon;
grant execute on function public.set_prospect_source_enabled(text, boolean) to authenticated;

create or replace function public.set_prospect_source_paused(p_key text, p_paused boolean, p_reason text default null)
returns public.api_source_health
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_health public.api_source_health;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may pause/resume a source';
  end if;

  update public.api_source_health h
  set is_paused = p_paused, paused_reason = case when p_paused then p_reason else null end
  from public.prospect_sources s
  where h.source_id = s.id and s.key = p_key
  returning h.* into v_health;

  if not found then
    raise exception 'unknown source key: %', p_key;
  end if;

  return v_health;
end;
$$;

revoke execute on function public.set_prospect_source_paused(text, boolean, text) from public, anon;
grant execute on function public.set_prospect_source_paused(text, boolean, text) to authenticated;
