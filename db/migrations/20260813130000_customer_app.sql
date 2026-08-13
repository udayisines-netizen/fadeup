-- FadeUp — Wave 1 Phase 4: Customer App (appointments, queue, favorites)
-- Migration: get_my_appointments, cancel_my_appointment, get_my_queue_status,
--            customer_favorites + get_my_favorites
--
-- Every read here follows the Phase 3 decision (see 20260813120000_customer_identity.sql):
-- narrowly-scoped SECURITY DEFINER RPCs that resolve the caller's own
-- customers.id rows via customer_profiles/customers.user_id, never a broad
-- new RLS SELECT policy on appointments/queue_entries/customers — so
-- internal shop fields (customers.notes, appointment.created_by, etc.)
-- never become reachable, only the specific curated columns each RPC
-- selects.
--
-- customer_favorites is the one genuinely NEW table here, and unlike the
-- above it uses direct RLS (not an RPC) for reads/writes — safe because it
-- holds only the customer's own opaque org/barber ids, the same public
-- identifiers already visible from browsing the marketplace. No internal
-- shop data is reachable through it.
--
-- Idempotent: safe to re-run.

-- customer_favorites ----------------------------------------------------------
create table if not exists public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  barber_id uuid references public.barbers (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.customer_favorites is
  'A customer''s favorited shop (barber_id null) or specific barber (barber_id set). Strict owner-only RLS. Used for discovery shortcuts, rebooking, and the customer home.';

-- barber_id null = "favorited the shop overall"; not null = "favorited this
-- specific barber" (barber_id alone already implies the org, via barbers.organization_id,
-- so no separate org-level row is needed once a specific barber is favorited).
create unique index if not exists customer_favorites_shop_unique
  on public.customer_favorites (user_id, organization_id) where barber_id is null;
create unique index if not exists customer_favorites_barber_unique
  on public.customer_favorites (user_id, barber_id) where barber_id is not null;
create index if not exists customer_favorites_user_id_idx on public.customer_favorites (user_id);

alter table public.customer_favorites enable row level security;
alter table public.customer_favorites force row level security;

drop policy if exists customer_favorites_select on public.customer_favorites;
create policy customer_favorites_select
  on public.customer_favorites
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists customer_favorites_insert on public.customer_favorites;
create policy customer_favorites_insert
  on public.customer_favorites
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists customer_favorites_delete on public.customer_favorites;
create policy customer_favorites_delete
  on public.customer_favorites
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- get_my_favorites --------------------------------------------------------------
-- Curated join for display — same fields already public via search/profile
-- RPCs (org name/slug, barber name/avatar), nothing new exposed.
create or replace function public.get_my_favorites()
returns table (
  favorite_id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  barber_id uuid,
  barber_display_name text,
  barber_avatar_url text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    f.id,
    f.organization_id,
    o.name,
    o.slug,
    f.barber_id,
    sp.display_name,
    sp.avatar_url,
    f.created_at
  from public.customer_favorites f
  join public.organizations o on o.id = f.organization_id
  left join public.barbers b on b.id = f.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where f.user_id = (select auth.uid())
  order by f.created_at desc;
$$;

comment on function public.get_my_favorites() is
  'Authenticated-only: the caller''s own favorited shops/barbers, joined with curated public display fields.';

revoke execute on function public.get_my_favorites() from public, anon;
grant execute on function public.get_my_favorites() to authenticated;

-- get_my_appointments -------------------------------------------------------------
create or replace function public.get_my_appointments()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.appointment_status,
  notes text,
  price_cents integer
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id,
    a.organization_id,
    o.name,
    o.slug,
    a.location_id,
    l.name,
    a.barber_id,
    sp.display_name,
    a.service_id,
    s.name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.notes,
    s.price_cents
  from public.appointments a
  join public.organizations o on o.id = a.organization_id
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  )
  order by a.starts_at desc;
$$;

comment on function public.get_my_appointments() is
  'Authenticated-only: every appointment (any organization) linked to the caller via customers.user_id, curated columns only — never customers.notes or any other internal shop field.';

revoke execute on function public.get_my_appointments() from public, anon;
grant execute on function public.get_my_appointments() to authenticated;

-- cancel_my_appointment -------------------------------------------------------------
-- Reuses the existing status machine (pending/confirmed -> cancelled) —
-- does not invent a new cancellation policy. A customer can only cancel
-- their OWN appointment, and only while it's still pending/confirmed (not
-- completed/no_show/already cancelled).
create or replace function public.cancel_my_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  select a.* into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    );

  if not found then
    raise exception 'appointment not found';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled';
  end if;

  update public.appointments set status = 'cancelled' where id = p_appointment_id returning * into v_appointment;
  return v_appointment;
end;
$$;

comment on function public.cancel_my_appointment(uuid) is
  'Authenticated-only: cancel the caller''s own appointment, only while pending/confirmed. Raises if the appointment is not theirs or is no longer cancellable — never silently no-ops.';

revoke execute on function public.cancel_my_appointment(uuid) from public, anon;
grant execute on function public.cancel_my_appointment(uuid) to authenticated;

-- get_my_queue_status -------------------------------------------------------------
-- Position is computed across the FULL waiting line at that location (same
-- row_number()-over-created_at approach as get_public_queue_status), then
-- filtered down to only the caller's own row(s) — an accurate position
-- number without ever exposing another customer's queue entry.
create or replace function public.get_my_queue_status()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  status public.queue_status,
  queue_position integer,
  barber_display_name text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  with waiting_positions as (
    select id, row_number() over (partition by location_id order by created_at) as position
    from public.queue_entries
    where status = 'waiting'
  )
  select
    q.id,
    q.organization_id,
    o.name,
    o.slug,
    q.location_id,
    l.name,
    q.status,
    case when q.status = 'waiting' then wp.position::integer else null end,
    sp.display_name,
    q.created_at
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  join public.locations l on l.id = q.location_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join waiting_positions wp on wp.id = q.id
  where q.status in ('waiting', 'called', 'in_service')
    and q.customer_id in (
      select c.id from public.customers c where c.user_id = (select auth.uid())
    )
  order by q.created_at;
$$;

comment on function public.get_my_queue_status() is
  'Authenticated-only: the caller''s own active (waiting/called/in_service) queue entries, with an accurate position derived from the full location line, never exposing other customers'' entries.';

revoke execute on function public.get_my_queue_status() from public, anon;
grant execute on function public.get_my_queue_status() to authenticated;
