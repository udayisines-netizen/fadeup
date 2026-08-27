\set ON_ERROR_STOP on

drop table if exists pg_temp.verify_results;

create temp table verify_results (
  check_name text not null,
  status text not null,
  detail text
);

create or replace function pg_temp.record_check(
  p_name text,
  p_ok boolean,
  p_detail text default null
)
returns void
language plpgsql
as $$
begin
  insert into verify_results(check_name, status, detail)
  values (
    p_name,
    case when p_ok then 'PASS' else 'FAIL' end,
    p_detail
  );
end;
$$;


select pg_temp.record_check(
  '1.01 organization_follows exists',
  to_regclass('public.organization_follows') is not null
);

select pg_temp.record_check(
  '1.02 organization_follows has RLS enabled',
  (
    select c.relrowsecurity
    from pg_class c
    where c.oid = 'public.organization_follows'::regclass
  )
);

select pg_temp.record_check(
  '1.03 organization_follows has FORCE RLS',
  (
    select c.relforcerowsecurity
    from pg_class c
    where c.oid = 'public.organization_follows'::regclass
  )
);

select pg_temp.record_check(
  '1.04 relationship uses organization_id',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_follows'
      and column_name = 'organization_id'
  )
);

select pg_temp.record_check(
  '1.05 relationship does NOT use professional_id',
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_follows'
      and column_name = 'professional_id'
  )
);

select pg_temp.record_check(
  '1.06 relationship does NOT use barber_id',
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_follows'
      and column_name = 'barber_id'
  )
);


select pg_temp.record_check(
  '2.01 follow_organization exists',
  to_regprocedure('public.follow_organization(uuid)') is not null
);

select pg_temp.record_check(
  '2.02 unfollow_organization exists',
  to_regprocedure('public.unfollow_organization(uuid)') is not null
);

select pg_temp.record_check(
  '2.03 list_my_followed_organizations exists',
  to_regprocedure('public.list_my_followed_organizations()') is not null
);


select pg_temp.record_check(
  '3.01 authenticated can execute follow_organization',
  has_function_privilege(
    'authenticated',
    'public.follow_organization(uuid)',
    'EXECUTE'
  )
);

select pg_temp.record_check(
  '3.02 authenticated can execute unfollow_organization',
  has_function_privilege(
    'authenticated',
    'public.unfollow_organization(uuid)',
    'EXECUTE'
  )
);

select pg_temp.record_check(
  '3.03 authenticated can execute list_my_followed_organizations',
  has_function_privilege(
    'authenticated',
    'public.list_my_followed_organizations()',
    'EXECUTE'
  )
);

select pg_temp.record_check(
  '3.04 anon cannot execute follow_organization',
  not has_function_privilege(
    'anon',
    'public.follow_organization(uuid)',
    'EXECUTE'
  )
);

select pg_temp.record_check(
  '3.05 anon cannot execute unfollow_organization',
  not has_function_privilege(
    'anon',
    'public.unfollow_organization(uuid)',
    'EXECUTE'
  )
);

select pg_temp.record_check(
  '3.06 anon cannot list customer organization follows',
  not has_function_privilege(
    'anon',
    'public.list_my_followed_organizations()',
    'EXECUTE'
  )
);


select pg_temp.record_check(
  '4.01 authenticated cannot INSERT organization_follows directly',
  not has_table_privilege(
    'authenticated',
    'public.organization_follows',
    'INSERT'
  )
);

select pg_temp.record_check(
  '4.02 authenticated cannot UPDATE organization_follows directly',
  not has_table_privilege(
    'authenticated',
    'public.organization_follows',
    'UPDATE'
  )
);

select pg_temp.record_check(
  '4.03 authenticated cannot DELETE organization_follows directly',
  not has_table_privilege(
    'authenticated',
    'public.organization_follows',
    'DELETE'
  )
);


select pg_temp.record_check(
  '5.01 follow_organization is SECURITY DEFINER',
  (
    select p.prosecdef
    from pg_proc p
    where p.oid = 'public.follow_organization(uuid)'::regprocedure
  )
);

select pg_temp.record_check(
  '5.02 unfollow_organization is SECURITY DEFINER',
  (
    select p.prosecdef
    from pg_proc p
    where p.oid = 'public.unfollow_organization(uuid)'::regprocedure
  )
);

select pg_temp.record_check(
  '5.03 list function is SECURITY DEFINER',
  (
    select p.prosecdef
    from pg_proc p
    where p.oid =
      'public.list_my_followed_organizations()'::regprocedure
  )
);


select pg_temp.record_check(
  '6.01 follow_organization derives actor from auth.uid',
  pg_get_functiondef(
    'public.follow_organization(uuid)'::regprocedure
  ) ilike '%auth.uid()%'
);

select pg_temp.record_check(
  '6.02 unfollow_organization derives actor from auth.uid',
  pg_get_functiondef(
    'public.unfollow_organization(uuid)'::regprocedure
  ) ilike '%auth.uid()%'
);

select pg_temp.record_check(
  '6.03 Follow pins search_path',
  exists (
    select 1
    from pg_proc
    where oid = 'public.follow_organization(uuid)'::regprocedure
      and array_to_string(proconfig, ',') like '%search_path=%'
  )
);

select pg_temp.record_check(
  '6.04 Unfollow pins search_path',
  exists (
    select 1
    from pg_proc
    where oid = 'public.unfollow_organization(uuid)'::regprocedure
      and array_to_string(proconfig, ',') like '%search_path=%'
  )
);

select pg_temp.record_check(
  '6.05 list pins search_path',
  exists (
    select 1
    from pg_proc
    where oid =
      'public.list_my_followed_organizations()'::regprocedure
      and array_to_string(proconfig, ',') like '%search_path=%'
  )
);


select pg_temp.record_check(
  '7.01 list exposes organization_id',
  pg_get_function_result(
    'public.list_my_followed_organizations()'::regprocedure
  ) ilike '%organization_id uuid%'
);

select pg_temp.record_check(
  '7.02 professional Follow still exists',
  to_regprocedure('public.follow_professional(uuid)') is not null
);

select pg_temp.record_check(
  '7.03 professional Unfollow still exists',
  to_regprocedure('public.unfollow_professional(uuid)') is not null
);

select pg_temp.record_check(
  '7.04 shop Favorite still exists',
  to_regprocedure('public.favorite_shop(uuid)') is not null
);

select pg_temp.record_check(
  '7.05 remove Favorite still exists',
  to_regprocedure('public.remove_favorite(uuid)') is not null
);


select pg_temp.record_check(
  '8.01 suite executed all expected checks',
  (select count(*) from verify_results) >= 29,
  (select count(*)::text || ' checks recorded'
   from verify_results)
);

table verify_results;

select
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from verify_results;

do $$
begin
  if exists (
    select 1
    from verify_results
    where status = 'FAIL'
  ) then
    raise exception 'ORGANIZATION FOLLOW VERIFY FAILED';
  end if;
end
$$;
