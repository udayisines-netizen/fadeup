-- FadeUp — retour arrière de 20260911100300_plat1_publication_chain.sql
--
-- Remet les trois fonctions de la chaîne de publication sur leur garde
-- d'avant PLAT-1 : is_platform_admin() pour create_external_professional,
-- has_platform_role([owner, admin]) pour les deux autres. Corps repris
-- verbatim de la production du 2026-09-11, avant correction.
--
-- À passer AVANT le retour arrière de 20260911100100, qui supprime
-- private.platform_can(). À APPLIQUER EN postgres.

set lock_timeout = '5s';

begin;

-- ---- create_external_professional : garde d'avant PLAT-1
create or replace function public.create_external_professional(p_prospect_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing uuid;
  v_name text;
  v_professional_id uuid;
begin
  -- TWO conditions for the worker arm, and both are load-bearing.
  --
  -- session_user, NOT current_user: inside a SECURITY DEFINER function
  -- current_user is the function OWNER (postgres), so testing it would let
  -- every caller through. session_user is the role that actually connected —
  -- 'prospect_worker' for the worker's own connection, 'authenticator' for
  -- anything arriving through PostgREST, which R1A confirmed is not a member
  -- of prospect_worker so no JWT can reach it.
  --
  -- auth.uid() IS NULL because the worker holds no JWT. Without this clause a
  -- superuser session that has merely SET ROLE to authenticated would satisfy
  -- pg_has_role(session_user, 'prospect_worker', ...) — superusers are
  -- implicitly members of every role — and an equality test alone would leave
  -- the check unverifiable from any test harness. Requiring the absence of a
  -- session as well makes it both stricter and testable.
  if not (
    (select private.is_platform_admin())
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform staff or the acquisition worker can create external profiles'
      using errcode = '42501';
  end if;

  -- Idempotent per prospect. Checked first AND enforced by the unique
  -- constraint below, because a concurrent second job must lose on the index
  -- rather than on this read.
  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    return v_existing;
  end if;

  select p.canonical_name into v_name
  from public.prospects p
  where p.id = p_prospect_id;

  if v_name is null then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  insert into public.professionals (claim_state, display_name, source, is_public)
  values ('unclaimed', v_name, 'acquisition', false)
  returning id into v_professional_id;

  begin
    insert into public.prospect_professionals (prospect_id, professional_id)
    values (p_prospect_id, v_professional_id);
  exception when unique_violation then
    -- A concurrent job won. Fail the whole statement rather than return a
    -- second identity for the same real business: the caller retries into the
    -- idempotent branch above and receives the winner's identity.
    raise exception 'external profile for this prospect is already being created; retry'
      using errcode = '40001';
  end;

  return v_professional_id;
end;
$function$;

-- ---- refresh_prospect_publication_eligibility : garde d'avant PLAT-1
create or replace function public.refresh_prospect_publication_eligibility(p_prospect_id uuid)
 RETURNS prospect_publication_eligibility
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text;
  v_distinct_sources integer;
  v_trust_anchor boolean;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.prospects where id = p_prospect_id) then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);

  select count(distinct psr.source_id),
         coalesce(bool_or(ps.is_identity_trust_anchor), false)
    into v_distinct_sources, v_trust_anchor
  from public.prospect_source_records psr
  join public.prospect_sources ps on ps.id = psr.source_id
  where psr.prospect_id = p_prospect_id;

  insert into public.prospect_publication_eligibility as e (
    prospect_id, is_eligible, block_reason,
    distinct_source_count, has_trust_anchor, evaluated_at
  )
  values (
    p_prospect_id, v_reason is null, v_reason,
    coalesce(v_distinct_sources, 0), v_trust_anchor, now()
  )
  on conflict (prospect_id) do update
  set is_eligible           = excluded.is_eligible,
      block_reason          = excluded.block_reason,
      distinct_source_count = excluded.distinct_source_count,
      has_trust_anchor      = excluded.has_trust_anchor,
      evaluated_at          = excluded.evaluated_at
  returning e.* into v_row;

  return v_row;
end;
$function$;

-- ---- sweep_prospect_publication_eligibility : garde d'avant PLAT-1
create or replace function public.sweep_prospect_publication_eligibility(p_limit integer DEFAULT 100)
 RETURNS TABLE(prospect_id uuid, is_eligible boolean, block_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_row public.prospect_publication_eligibility;
begin
  if not (
    (select private.has_platform_role(
       array['platform_owner', 'platform_admin']::public.platform_role[]))
    or ((select auth.uid()) is null and session_user = 'prospect_worker')
  ) then
    raise exception 'only FadeUp platform administrators or the acquisition worker can evaluate publication eligibility'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit must be between 1 and 1000' using errcode = '22023';
  end if;

  for v_id in
    select p.id
    from public.prospects p
    left join public.prospect_publication_eligibility e on e.prospect_id = p.id
    order by e.evaluated_at asc nulls first, p.first_discovered_at asc
    limit p_limit
  loop
    v_row := public.refresh_prospect_publication_eligibility(v_id);
    prospect_id := v_row.prospect_id;
    is_eligible := v_row.is_eligible;
    block_reason := v_row.block_reason;
    return next;
  end loop;
end;
$function$;

commit;
