begin;

-- ============================================================================
-- FadeUp V2 — Organization Follow
--
-- professional_id = durable human social identity
-- organization_id = durable barbershop/business identity
-- barber_id       = operational placement identity
--
-- Shop Follow and Shop Favorite are intentionally separate.
-- ============================================================================

create table if not exists public.organization_follows (
  follower_user_id uuid not null
    references auth.users(id)
    on delete cascade,

  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,

  is_following boolean not null default true,

  followed_at timestamptz,
  unfollowed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (follower_user_id, organization_id),

  constraint organization_follows_timestamp_state_check
    check (
      (
        is_following = true
        and followed_at is not null
        and unfollowed_at is null
      )
      or
      (
        is_following = false
        and unfollowed_at is not null
      )
    )
);

comment on table public.organization_follows is
  'Durable customer-to-barbershop social Follow graph. Separate from customer_favorites. Explicit unfollows are retained as tombstones.';


create index if not exists organization_follows_by_organization_idx
  on public.organization_follows (
    organization_id,
    is_following
  );

create index if not exists organization_follows_by_user_idx
  on public.organization_follows (
    follower_user_id,
    is_following,
    followed_at desc
  );


-- ============================================================================
-- RLS / LEAST PRIVILEGE
-- ============================================================================

alter table public.organization_follows enable row level security;
alter table public.organization_follows force row level security;

drop policy if exists organization_follows_select_own
  on public.organization_follows;

create policy organization_follows_select_own
  on public.organization_follows
  for select
  to authenticated
  using (
    follower_user_id = (select auth.uid())
  );

revoke all
  on table public.organization_follows
  from public, anon, authenticated;

grant select
  on table public.organization_follows
  to authenticated;


-- ============================================================================
-- FOLLOW ORGANIZATION
--
-- Manual explicit action.
-- Actor ALWAYS comes from auth.uid().
-- Only a currently public organization can be newly followed.
-- ============================================================================

create or replace function public.follow_organization(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_slug text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select o.slug::text
    into v_slug
  from public.organizations o
  where o.id = p_organization_id;

  if v_slug is null then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from public.get_public_organization(v_slug)
  limit 1;

  if not found then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  insert into public.organization_follows (
    follower_user_id,
    organization_id,
    is_following,
    followed_at,
    unfollowed_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    p_organization_id,
    true,
    now(),
    null,
    now(),
    now()
  )
  on conflict (follower_user_id, organization_id)
  do update
  set
    is_following = true,
    followed_at = now(),
    unfollowed_at = null,
    updated_at = now();
end;
$$;

comment on function public.follow_organization(uuid) is
  'Authenticated explicit Follow of a public FadeUp barbershop organization. Actor identity is auth.uid().';

revoke execute
  on function public.follow_organization(uuid)
  from public, anon, authenticated;

grant execute
  on function public.follow_organization(uuid)
  to authenticated;


-- ============================================================================
-- UNFOLLOW ORGANIZATION
--
-- Preserve the explicit decision as a tombstone.
--
-- If the relationship already exists, unfollow must still work even if the
-- organization later becomes private/inactive.
--
-- If no relationship exists, a public organization can still receive an
-- explicit unfollow tombstone. This keeps future auto-follow semantics safe.
-- ============================================================================

create or replace function public.unfollow_organization(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_slug text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  update public.organization_follows
  set
    is_following = false,
    unfollowed_at = now(),
    updated_at = now()
  where follower_user_id = v_user_id
    and organization_id = p_organization_id;

  if found then
    return;
  end if;

  select o.slug::text
    into v_slug
  from public.organizations o
  where o.id = p_organization_id;

  if v_slug is null then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from public.get_public_organization(v_slug)
  limit 1;

  if not found then
    raise exception 'organization unavailable'
      using errcode = '42501';
  end if;

  insert into public.organization_follows (
    follower_user_id,
    organization_id,
    is_following,
    followed_at,
    unfollowed_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    p_organization_id,
    false,
    null,
    now(),
    now(),
    now()
  )
  on conflict (follower_user_id, organization_id)
  do update
  set
    is_following = false,
    unfollowed_at = now(),
    updated_at = now();
end;
$$;

comment on function public.unfollow_organization(uuid) is
  'Authenticated explicit organization unfollow. The relationship is retained as a tombstone rather than deleted.';

revoke execute
  on function public.unfollow_organization(uuid)
  from public, anon, authenticated;

grant execute
  on function public.unfollow_organization(uuid)
  to authenticated;


-- ============================================================================
-- CURRENT USER ACTIVE ORGANIZATION FOLLOWS
-- ============================================================================

create or replace function public.list_my_followed_organizations()
returns table (
  organization_id uuid,
  followed_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  return query
  select
    f.organization_id,
    f.followed_at
  from public.organization_follows f
  join public.organizations o
    on o.id = f.organization_id
  where f.follower_user_id = v_user_id
    and f.is_following = true
    and exists (
      select 1
      from public.get_public_organization(o.slug::text)
    )
  order by f.followed_at desc nulls last;
end;
$$;

comment on function public.list_my_followed_organizations() is
  'Returns the authenticated customer current active barbershop follows.';

revoke execute
  on function public.list_my_followed_organizations()
  from public, anon, authenticated;

grant execute
  on function public.list_my_followed_organizations()
  to authenticated;


-- Explicitly preserve server-owned writes.
revoke insert, update, delete
  on public.organization_follows
  from anon, authenticated;

commit;
