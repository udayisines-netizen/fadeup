-- FadeUp — B1 chantier 1, rollback.
--
-- Restores the R1B publication rule: is_public requires claim_state='claimed'.
--
-- DATA CONSEQUENCE, STATED BEFORE IT HAPPENS. Any identity published while
-- this migration was live is unclaimed AND public, which the restored CHECK
-- forbids — the ALTER would fail on it. This script DEPUBLISHES those rows
-- (is_public = false) before restoring the constraint. It deletes nothing:
-- the identities, their handles, their followers and their prospect linkage
-- all survive, they simply stop being projected. Re-applying the migration and
-- pressing Publish again restores them exactly.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- 1. The guard goes first, so the depublication below is not itself refused.
drop trigger if exists professionals_guard_publication on public.professionals;
drop function if exists public.guard_professional_publication();

-- 2. Depublish what the restored constraint cannot represent.
update public.professionals
set is_public = false
where is_public and claim_state <> 'claimed';

-- 3. The R1B constraint, verbatim.
alter table public.professionals
  drop constraint if exists professionals_publication_eligibility;

alter table public.professionals
  add constraint professionals_publication_eligibility
  check (not is_public or (claim_state = 'claimed' and btrim(display_name) <> ''));

comment on constraint professionals_publication_eligibility on public.professionals is null;

-- 4. The anchor helper has no remaining caller.
drop function if exists private.professional_publication_anchor(uuid);

-- 5. The public projections, as R1B defined them.
drop function if exists public.get_public_professional(uuid);
drop function if exists public.get_public_professional_by_handle(text);

create function public.get_public_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

create function public.get_public_professional_by_handle(p_handle text)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  follower_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         private.professional_follower_count(p.id)
  from public.professionals p
  where p.handle is not null
    and lower(p.handle) = lower(btrim(coalesce(p_handle, '')))
    and p.claim_state = 'claimed'
    and p.is_public;
$$;

create function public.get_public_external_professional(p_professional_id uuid)
returns table (
  id uuid,
  display_name text,
  handle text,
  headline text,
  bio text,
  avatar_url text,
  is_claimed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.handle, p.headline, p.bio, p.avatar_url,
         false
  from public.professionals p
  where p.id = p_professional_id
    and p.claim_state = 'unclaimed'
    and p.is_public;
$$;

comment on function public.get_public_external_professional(uuid) is
  'Anon-callable. The public contract for an UNCLAIMED, externally discovered professional. A DELIBERATELY DIFFERENT SHAPE from get_public_professional: it has no follower_count, no location and no operational column, so it cannot leak or fabricate FadeUp state even by accident. is_claimed is a literal false so no consumer can mistake it for a claimed profile. Returns zero rows for every input in R1B — the publication CHECK on professionals forbids is_public while unclaimed, and R10 removes that clause deliberately.';

revoke all on function public.get_public_professional(uuid) from public;
revoke all on function public.get_public_professional_by_handle(text) from public;
revoke all on function public.get_public_external_professional(uuid) from public;
grant execute on function public.get_public_professional(uuid) to anon, authenticated, service_role;
grant execute on function public.get_public_professional_by_handle(text) to anon, authenticated, service_role;
grant execute on function public.get_public_external_professional(uuid) to anon, authenticated, service_role;

-- 6. publish_external_professional, without the UPDATE that publishes.
create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    return v_existing;
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  return v_professional_id;
end;
$$;

-- 7. Withdrawal did not exist before B1.
drop function if exists public.withdraw_external_professional(uuid, text);

comment on function public.create_external_professional(uuid) is
  'Platform-staff or acquisition-worker only. Mints ONE unclaimed professional identity per canonical prospect, idempotently, with structurally safe defaults: unclaimed (so the publication CHECK forbids is_public), no barbers row (so no availability, queue, schedule or appointment can be implied), and a display name copied from the prospect rather than supplied by the caller. Serialises against a concurrent second job on the unique index, returning 40001 so the caller retries into the idempotent branch.';

comment on column public.professionals.is_public is
  'Whether this identity is CURRENTLY projected publicly. Distinct from existence and from eligibility. Never inherited from staff_profiles.is_public.';

commit;
