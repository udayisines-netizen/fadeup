-- FadeUp — LOT 11: chair mode + kiosk + TV mode (phase 1 — anon queue surface)
-- Migration: kiosk self-check-in + TV-mode queue display RPCs
--
-- Two anon-callable SECURITY DEFINER RPCs, following the exact pattern
-- established in LOT 9 (public booking): narrowly-scoped functions
-- returning/accepting only curated fields, not broad anon policies on
-- queue_entries itself — queue_entries retains ZERO anon SELECT/INSERT
-- policy. Every id is re-derived from the organization slug and
-- re-validated against it, never trusted from the caller.
--
-- Idempotent: safe to re-run.

-- join_public_queue -----------------------------------------------------------
-- A kiosk device's self-check-in: "I'm here, put me in line." No
-- scheduling/time-window logic needed (unlike book_public_appointment) —
-- a walk-in joins the current live line immediately.
create or replace function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null
)
returns table (id uuid, status public.queue_status, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_entry public.queue_entries;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active
  ) then
    raise exception 'location is not available';
  end if;

  if p_barber_id is not null and not exists (
    select 1
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_barber_id
      and b.organization_id = v_organization_id
      and b.is_bookable
      and sp.is_active
      and sp.is_public
  ) then
    raise exception 'requested barber is not available';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = v_organization_id and s.is_active
  ) then
    raise exception 'requested service is not available';
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_name, customer_phone, status, created_by)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid) is
  'Anon-callable kiosk self-check-in: adds a waiting queue_entries row. SECURITY DEFINER — re-validates organization/location/barber/service against the slug, same pattern as book_public_appointment (LOT 9).';

revoke execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) to anon, authenticated;

-- get_public_queue_status --------------------------------------------------------
-- A TV-mode / customer-facing "who's next" display. Deliberately returns
-- MINIMAL, privacy-conscious customer identification — first name plus
-- last-initial (e.g. "Alice W."), never the full name, phone or email —
-- since this is meant to be shown on a screen anyone in the shop (or
-- walking past) can see. Position is derived the same way the
-- authenticated app will derive it (LOT 10: row_number() over waiting rows
-- ordered by created_at), not a stored column.
create or replace function public.get_public_queue_status(p_organization_slug text, p_location_id uuid)
returns table (
  id uuid,
  display_name text,
  status public.queue_status,
  queue_position integer,
  barber_display_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    q.id,
    btrim(split_part(q.customer_name, ' ', 1))
      || case when position(' ' in btrim(q.customer_name)) > 0
              then ' ' || left(split_part(q.customer_name, ' ', 2), 1) || '.'
              else '' end as display_name,
    q.status,
    case when q.status = 'waiting' then
      row_number() over (partition by q.status order by q.created_at)::integer
    else null end as queue_position,
    sp.display_name as barber_display_name
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  left join public.barbers b on b.id = q.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  where o.slug = p_organization_slug
    and q.location_id = p_location_id
    and q.status in ('waiting', 'called', 'in_service')
  order by
    case q.status when 'in_service' then 0 when 'called' then 1 else 2 end,
    q.created_at;
$$;

comment on function public.get_public_queue_status(text, uuid) is
  'Anon-callable TV-mode display: active (waiting/called/in_service) queue entries for one location, with customer identity reduced to first-name + last-initial for public-screen privacy. Position is derived, not stored.';

revoke execute on function public.get_public_queue_status(text, uuid) from public;
grant execute on function public.get_public_queue_status(text, uuid) to anon, authenticated;
