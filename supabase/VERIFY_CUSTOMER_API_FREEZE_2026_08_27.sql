\set ON_ERROR_STOP on

-- ============================================================
-- FadeUp Customer API Freeze — social contract alignment
-- ============================================================

do $$
declare
  v_result text;
begin
  v_result := pg_get_function_result(
    'public.get_public_barber(text,uuid)'::regprocedure
  );

  if position('professional_id uuid' in v_result) = 0 then
    raise exception 'get_public_barber does not expose professional_id';
  end if;
end
$$;

do $$
declare
  v_result text;
begin
  v_result := pg_get_function_result(
    'public.list_public_organization_barbers(text)'::regprocedure
  );

  if position('professional_id uuid' in v_result) = 0 then
    raise exception 'list_public_organization_barbers does not expose professional_id';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- AMENDED 2026-08-28 (R5). Resolved by NAME, not by a pinned argument list.
--
-- This block used to address the function as
--   search_public_professionals(text,text,…,integer,integer)   -- 13 args
-- and R5 added a trailing `p_sort text default 'recommended'`, which made the
-- assertion fail with "function does not exist" — reporting an ADDITIVE change
-- as a broken contract.
--
-- The freeze is explicit that it freezes "API and identity semantics, not
-- visual UI implementation", and the semantic this block exists to protect is
-- that `professional_id` is exposed and remains distinct from barber_id. That
-- semantic is unchanged. Pinning the arity instead made every future additive
-- parameter look like a violation, which trains people to edit the VERIFY
-- rather than to think about the contract.
--
-- The uniqueness check below is what the arity pin was really buying: exactly
-- one overload must exist, because two would make every existing
-- 13-argument call site ambiguous at runtime.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result text;
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc
  where proname = 'search_public_professionals'
    and pronamespace = 'public'::regnamespace;

  if v_count <> 1 then
    raise exception 'expected exactly one search_public_professionals, found %', v_count;
  end if;

  select pg_get_function_result(oid) into v_result
  from pg_proc
  where proname = 'search_public_professionals'
    and pronamespace = 'public'::regnamespace;

  if position('professional_id uuid' in v_result) = 0 then
    raise exception 'search_public_professionals does not expose professional_id';
  end if;

  -- The other columns the frozen customer contract depends on. Named
  -- individually so a projection rewrite that drops one is caught here rather
  -- than by a customer whose marketplace card lost its price.
  if position('barber_id uuid' in v_result) = 0
     or position('organization_id uuid' in v_result) = 0
     or position('starting_price_cents integer' in v_result) = 0
     or position('is_open_now boolean' in v_result) = 0
     or position('queue_waiting_count integer' in v_result) = 0 then
    raise exception 'search_public_professionals dropped a frozen column: %', v_result;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customer_favorites'::regclass
      and conname = 'customer_favorites_new_rows_shop_only'
      and not convalidated
  ) then
    raise exception 'shop-only NOT VALID compatibility constraint missing';
  end if;
end
$$;

do $$
begin
  if has_table_privilege(
    'authenticated',
    'public.customer_favorites',
    'INSERT'
  ) then
    raise exception 'authenticated still has direct INSERT on customer_favorites';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.customer_favorites',
    'UPDATE'
  ) then
    raise exception 'authenticated still has direct UPDATE on customer_favorites';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.customer_favorites',
    'DELETE'
  ) then
    raise exception 'authenticated still has direct DELETE on customer_favorites';
  end if;
end
$$;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.favorite_shop(uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute favorite_shop';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.remove_favorite(uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute remove_favorite';
  end if;

  if has_function_privilege(
    'anon',
    'public.favorite_shop(uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute favorite_shop';
  end if;

  if has_function_privilege(
    'anon',
    'public.remove_favorite(uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute remove_favorite';
  end if;
end
$$;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.follow_professional(uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute follow_professional';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.unfollow_professional(uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute unfollow_professional';
  end if;
end
$$;

do $$
begin
  if has_table_privilege(
    'authenticated',
    'public.professional_follows',
    'INSERT'
  ) then
    raise exception 'authenticated gained direct INSERT on professional_follows';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.professional_follows',
    'UPDATE'
  ) then
    raise exception 'authenticated gained direct UPDATE on professional_follows';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.professional_follows',
    'DELETE'
  ) then
    raise exception 'authenticated gained direct DELETE on professional_follows';
  end if;
end
$$;

select 'PASS — Customer API social contract alignment' as result;
