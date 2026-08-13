-- FadeUp — Wave 1, Phase 7: narrow the claim to the appointment itself
--
-- Fixes two defects found in adversarial review of
-- 20260813150000_appointment_ownership_hardening.sql. Both come from the
-- same wrong assumption: that the public.customers row an appointment
-- points at was necessarily created BY that appointment.
--
-- It is not. The pre-existing appointments_link_customer trigger (LOT 12,
-- 20260809180100) find-or-creates that row by matching the caller-TYPED
-- customer_phone, then lower(customer_email), against existing rows in the
-- same organization. So the row a booking lands on is chosen by data the
-- booker supplies.
--
-- 1. CRITICAL — the takeover vector 20260813150000 set out to remove was
--    still reachable, just one step further along:
--
--      a. Victim V has an unlinked customers row R at shop S — from a past
--         anonymous booking, or because staff typed V into the CRM. R.user_id
--         is null, the normal state for every pre-Wave-1 customer.
--      b. Attacker A, SIGNED OUT, books any free slot at S and enters V's
--         phone or email. The trigger matches R, so the new appointment
--         points at R. A is anonymous, so A is handed a claim token for
--         their own booking.
--      c. A signs in and redeems. The old code saw "appointment points at R,
--         R is unowned" and wrote R.user_id = A.
--      d. get_my_appointments() resolves through customers.user_id, so A now
--         reads every appointment of V's at S — barber, times, status, price,
--         notes — and cancel_my_appointment() lets A cancel them. V can never
--         claim R afterwards.
--
--    Knowing a phone number or email address was enough. That is precisely
--    the caller-asserted identity the previous migration removed from
--    claim_customer_records, reintroduced through the trigger.
--
--    Fix: redemption never mutates customers.user_id on a row it did not
--    create. A claim token proves exactly one thing — that the holder made
--    THAT booking — so it now grants exactly that: the claimed appointment
--    is repointed at a CRM row the caller owns. Nothing else moves.
--
-- 2. HIGH — private.resolve_customer_for_user returned null whenever the
--    caller's phone/email already sat on a different unlinked row, because
--    the insert hit customers_org_phone_unique / customers_org_email_unique
--    and `on conflict do nothing` yielded no id. book_public_appointment then
--    inserted the appointment with customer_id = null, the trigger attached
--    it to that pre-existing unlinked row, and — since the booker WAS signed
--    in — no claim token was issued either. The customer saw a success
--    screen for a booking that never appeared in their appointments and had
--    no recovery path. This is the ordinary case, not an edge one: any
--    customer the shop had already typed into its CRM hit it.
--
--    Fix: on conflict, still create a row owned by the caller, with
--    phone/email left null so neither partial unique index applies. The
--    appointment itself still carries the denormalized contact details, so
--    staff lose nothing. resolve_customer_for_user now never returns null
--    for a valid (organization, user) pair.
--
-- Idempotent: safe to re-run.

create or replace function private.resolve_customer_for_user(
  p_organization_id uuid,
  p_user_id uuid,
  p_name text,
  p_phone text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_name text := coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Customer');
begin
  if p_user_id is null or p_organization_id is null then
    return null;
  end if;

  -- Already linked in this organization — the only lookup that proves
  -- anything. An unlinked row is NEVER matched on a caller-supplied
  -- phone/email: that is the takeover vector this migration closes.
  select c.id into v_customer_id
    from public.customers c
    where c.organization_id = p_organization_id and c.user_id = p_user_id;
  if found then
    return v_customer_id;
  end if;

  -- Preferred: the caller's own row, carrying their contact details.
  insert into public.customers (organization_id, user_id, name, phone, email)
  values (
    p_organization_id, p_user_id, v_name,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), '')
  )
  on conflict do nothing
  returning id into v_customer_id;

  if v_customer_id is not null then
    return v_customer_id;
  end if;

  -- Those details already belong to a different, unlinked row in this shop.
  -- We must not adopt that row, but the caller still needs one of their own,
  -- so create it without contact details: customers_org_phone_unique and
  -- customers_org_email_unique are partial (WHERE ... IS NOT NULL), so nulls
  -- never collide, and customers_org_user_unique cannot collide because the
  -- lookup above established this user has no row here yet. The appointment
  -- keeps the denormalized name/phone/email either way.
  insert into public.customers (organization_id, user_id, name, phone, email)
  values (p_organization_id, p_user_id, v_name, null, null)
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

comment on function private.resolve_customer_for_user(uuid, uuid, text, text, text) is
  'Returns the caller-owned public.customers row id for an organization, creating it if absent. Matches ONLY on (organization_id, user_id) — never adopts a pre-existing unlinked row on the strength of caller-supplied contact details. If those details already belong to another unlinked row, creates the caller''s row without them rather than returning null, so a signed-in booking is never left unattached.';

revoke execute on function private.resolve_customer_for_user(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.redeem_appointment_claim(p_token text)
returns table (
  claimed boolean,
  organization_name text,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_token_id uuid;
  v_appointment_id uuid;
  v_appointment public.appointments;
  v_customer_id uuid;
  v_organization_name text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'redeem_appointment_claim requires an authenticated session';
  end if;

  if p_token is null or btrim(p_token) = '' then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  -- Single-use and time-limited, checked in one statement so two concurrent
  -- redemptions cannot both win.
  update public.appointment_claim_tokens t
    set redeemed_at = now(), redeemed_by = v_user_id
    where t.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
      and t.redeemed_at is null
      and t.expires_at > now()
    returning t.id, t.appointment_id into v_token_id, v_appointment_id;

  if v_token_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  select * into v_appointment from public.appointments a where a.id = v_appointment_id;

  -- The token proves the holder made THIS booking, and nothing more. So we
  -- move exactly this booking onto a CRM row the caller owns, and never
  -- touch the ownership of whatever row the LOT 12 trigger happened to
  -- attach it to — that row is chosen from caller-typed contact details and
  -- may well belong to somebody else entirely.
  v_customer_id := private.resolve_customer_for_user(
    v_appointment.organization_id, v_user_id,
    v_appointment.customer_name, v_appointment.customer_phone, v_appointment.customer_email
  );

  if v_customer_id is null then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  update public.appointments a
    set customer_id = v_customer_id
    where a.id = v_appointment_id;

  select o.name into v_organization_name
    from public.organizations o where o.id = v_appointment.organization_id;

  return query select true, v_organization_name, v_appointment.starts_at;
end;
$$;

comment on function public.redeem_appointment_claim(text) is
  'Authenticated-only. Repoints the appointment identified by a single-use booking claim token at a public.customers row owned by the caller. Proof of ownership is possession of the token issued at booking time. Deliberately narrow: it moves only the claimed appointment and never changes who owns any pre-existing CRM row, because the row an appointment lands on is selected by the appointments_link_customer trigger from caller-typed contact details.';

revoke execute on function public.redeem_appointment_claim(text) from public, anon;
grant execute on function public.redeem_appointment_claim(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stop returning staff-authored appointment notes to the customer.
--
-- appointments.notes is a single shared column written by BOTH the customer
-- (the "Notes (optional)" box in the public booking wizard) and by staff
-- (the same field in the internal appointments dialog,
-- apps/web/src/pages/app-appointments-page.tsx). get_my_appointments
-- returned it verbatim, so a receptionist typing "always 20 min late, take
-- a deposit" was handing that to the customer over PostgREST — reachable
-- with a single supabase.rpc('get_my_appointments') call whether or not any
-- UI renders it.
--
-- That directly contradicts this wave's own internal-notes separation
-- requirement, which the Fade Passport tables enforce structurally. Since
-- the two kinds of note are indistinguishable once written, the only honest
-- fix available without a schema split is to stop exposing the column at
-- all; nothing in the customer app reads it. Splitting customer-supplied
-- booking notes from staff notes into separate columns is the real fix and
-- belongs in Wave 2.
--
-- Return shape changes, so DROP + CREATE.
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_appointments();

create function public.get_my_appointments()
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
  'The signed-in customer''s own appointments across every organization, resolved through customers.user_id. Deliberately does NOT return appointments.notes: that column is shared with staff-authored internal notes and cannot be separated per-author after the fact.';

revoke execute on function public.get_my_appointments() from public, anon;
grant execute on function public.get_my_appointments() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Stop advertising a stale, misattributed queue count as live wait data.
--
-- queue_waiting_count counted every queue_entries row with status='waiting'
-- for the location, with NO time bound — and nothing in this schema ever
-- expires such a row (apply_appointment_no_show_rule covers appointments
-- only). It also counted unassigned entries (barber_id is null) towards
-- EVERY barber at that location.
--
-- Observed on live seed data before this fix: three 'waiting' rows created
-- two days earlier caused "Le Fade Parisien" AND both of its barbers to each
-- advertise "2 people waiting", when nobody was waiting for either barber
-- and the rows were 48 hours old. That is a wait-time fact the database
-- cannot support — exactly what this wave's no-fabricated-data rule forbids.
--
-- Same signature and return shape, so CREATE OR REPLACE.
-- ---------------------------------------------------------------------------

create or replace function public.search_public_professionals(
  p_country text default null,
  p_city text default null,
  p_query text default null,
  p_service_query text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_km double precision default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_open_now_only boolean default false,
  p_entity_type text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  entity_type text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  barber_id uuid,
  barber_display_name text,
  barber_avatar_url text,
  barber_title text,
  location_id uuid,
  location_name text,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text,
  distance_km double precision,
  starting_price_cents integer,
  is_open_now boolean,
  queue_waiting_count integer,
  total_count bigint
)
language sql
security definer
stable
set search_path = ''
as $$
  with shop_base as (
    select
      'shop'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      null::uuid as barber_id,
      null::text as barber_display_name,
      null::text as barber_avatar_url,
      null::text as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
    from public.organizations o
    join public.locations l on l.organization_id = o.id
    where o.marketplace_visible
      and l.is_active
      and (p_entity_type is null or p_entity_type = 'shop')
      and (p_country is null or l.country = p_country)
      and (p_city is null or l.city ilike p_city)
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.service_locations sl on sl.service_id = s.id and sl.location_id = l.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  barber_base as (
    select
      'barber'::text as entity_type,
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      b.id as barber_id,
      sp.display_name as barber_display_name,
      sp.avatar_url as barber_avatar_url,
      sp.title as barber_title,
      l.id as location_id,
      l.name as location_name,
      l.address_line1,
      l.city,
      l.region,
      l.postal_code,
      l.country,
      l.timezone,
      case
        when p_latitude is not null and p_longitude is not null and l.latitude is not null and l.longitude is not null
          then extensions.earth_distance(extensions.ll_to_earth(p_latitude, p_longitude), extensions.ll_to_earth(l.latitude, l.longitude)) / 1000.0
        else null
      end as distance_km
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    join public.organizations o on o.id = b.organization_id
    join public.locations l on l.id = sp.location_id
    where o.marketplace_visible
      and b.is_bookable
      and sp.is_active
      and sp.is_public
      and l.is_active
      and (p_entity_type is null or p_entity_type = 'barber')
      and (p_country is null or l.country = p_country)
      and (p_city is null or l.city ilike p_city)
      and (
        p_query is null or p_query = '' or
        extensions.unaccent(sp.display_name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(o.name) ilike extensions.unaccent('%' || p_query || '%') or
        extensions.unaccent(l.city) ilike extensions.unaccent('%' || p_query || '%')
      )
      and (
        p_service_query is null or p_service_query = '' or exists (
          select 1
          from public.services s
          join public.barber_services bs on bs.service_id = s.id and bs.barber_id = b.id
          where s.organization_id = o.id and s.is_active
            and extensions.unaccent(s.name) ilike extensions.unaccent('%' || p_service_query || '%')
        )
      )
  ),
  combined as (
    select * from shop_base
    union all
    select * from barber_base
  ),
  priced as (
    select
      c.*,
      (
        select min(s.price_cents)
        from public.services s
        where s.organization_id = c.organization_id and s.is_active
          and (
            (c.entity_type = 'shop' and exists (
              select 1 from public.service_locations sl where sl.service_id = s.id and sl.location_id = c.location_id
            ))
            or
            (c.entity_type = 'barber' and exists (
              select 1 from public.barber_services bs where bs.service_id = s.id and bs.barber_id = c.barber_id
            ))
          )
      ) as starting_price_cents,
      (
        select not lh.is_closed
          and (now() at time zone c.timezone)::time between lh.open_time and lh.close_time
        from public.location_hours lh
        where lh.location_id = c.location_id
          and lh.day_of_week = extract(dow from (now() at time zone c.timezone))::smallint
      ) as is_open_now,
      (
        -- Two corrections over the original Wave 1 definition (see
        -- 20260813160000_claim_scope_fix.sql for the reasoning):
        --   1. Bounded to TODAY in the location's own timezone. Nothing in
        --      this schema ever expires a 'waiting' queue_entries row, so an
        --      unbounded count happily advertises a queue from last week as
        --      a live wait.
        --   2. A barber row counts only entries actually assigned to that
        --      barber. Counting unassigned (barber_id is null) entries
        --      towards every barber told each of them the shop-wide number
        --      as if it were their own line.
        select count(*)::integer
        from public.queue_entries qe
        where qe.location_id = c.location_id and qe.status = 'waiting'
          and qe.created_at >= (date_trunc('day', now() at time zone c.timezone) at time zone c.timezone)
          and (c.entity_type = 'shop' or qe.barber_id = c.barber_id)
      ) as queue_waiting_count
    from combined c
  ),
  filtered as (
    select *
    from priced
    where (p_radius_km is null or distance_km is null or distance_km <= p_radius_km)
      and (p_min_price_cents is null or starting_price_cents is null or starting_price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or starting_price_cents is null or starting_price_cents <= p_max_price_cents)
      and (not p_open_now_only or is_open_now is true)
  )
  select
    f.entity_type,
    f.organization_id,
    f.organization_name,
    f.organization_slug,
    f.barber_id,
    f.barber_display_name,
    f.barber_avatar_url,
    f.barber_title,
    f.location_id,
    f.location_name,
    f.address_line1,
    f.city,
    f.region,
    f.postal_code,
    f.country,
    f.distance_km,
    f.starting_price_cents,
    f.is_open_now,
    f.queue_waiting_count,
    count(*) over () as total_count
  from filtered f
  order by (f.distance_km is not null) desc, f.distance_km asc nulls last, f.organization_name asc, coalesce(f.barber_display_name, '') asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

-- ---------------------------------------------------------------------------
-- 5. Let a signed-in walk-in actually reach their own queue status.
--
-- get_my_queue_status (Wave 1) resolves through
-- queue_entries.customer_id -> customers.user_id, but join_public_queue
-- (LOT 10) never consulted auth.uid(): it inserted with created_by = null
-- and left customer_id to the appointments_link_customer trigger's
-- phone match. So the "you're in the queue" card — the TOP priority slot on
-- the customer home screen, with a 20s refetch behind it — only ever
-- rendered if the customer's CRM row at that shop happened to be
-- account-linked already AND they typed a byte-identical phone number at
-- the kiosk. In practice it was dead.
--
-- Stamping customer_id from the caller's own account when a session exists
-- is the same fix, and the same guarantee, as the one applied to
-- book_public_appointment: it uses only (organization_id, user_id), never a
-- typed-in phone, so it cannot attach the caller to anyone else's record.
-- Anonymous kiosk check-in is completely unchanged.
--
-- Same signature and return shape, so CREATE OR REPLACE.
-- ---------------------------------------------------------------------------

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
  v_user_id uuid;
  v_customer_id uuid;
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

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  v_user_id := (select auth.uid());
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid) is
  'Anon-callable kiosk self-check-in: adds a waiting queue_entries row. SECURITY DEFINER — re-validates organization/location/barber/service against the slug, same pattern as book_public_appointment (LOT 9). When the caller is authenticated, stamps customer_id with their own CRM row for that shop (resolved on user_id only, never on a typed-in phone) so the entry is visible through get_my_queue_status.';

revoke execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid) to anon, authenticated;
