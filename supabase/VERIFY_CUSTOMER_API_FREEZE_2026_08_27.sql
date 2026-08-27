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

do $$
declare
  v_result text;
begin
  v_result := pg_get_function_result(
    'public.search_public_professionals(text,text,text,text,double precision,double precision,double precision,integer,integer,boolean,text,integer,integer)'::regprocedure
  );

  if position('professional_id uuid' in v_result) = 0 then
    raise exception 'search_public_professionals does not expose professional_id';
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
