-- FadeUp — B1, chantier 5: joining a queue requires being there.
--
-- THE DEFECT
--
-- join_public_queue validated the organization, the location, the barber and
-- the service, and then inserted. Nothing established that the person joining
-- was anywhere near the shop. Anyone, anywhere, could fill any queue in the
-- product, from a script, forever. MASTER_SPEC §7 asks for the opposite:
-- "Présence physique exigée : géofence de 150 m combinée au QR du salon."
--
-- WHAT PRESENCE PROOF IS WORTH — SAID PLAINLY
--
-- Browser geolocation is falsifiable. A determined person can report any
-- coordinates they like, and this mechanism does not stop them. What it stops
-- is the opportunistic case: joining from the sofa, joining ten queues at
-- once, a competitor filling a rival's line from another city. The QR token is
-- the harder barrier — it is printed and displayed inside the establishment,
-- so obtaining it normally means having walked in — and it is still not
-- cryptographic proof: someone can photograph it and send it to a friend.
--
-- This is a deterrent, not a guarantee, and nothing downstream should be
-- built as though it were one. What IS a guarantee is that both checks run ON
-- THE SERVER: calling the REST API directly instead of using the app buys
-- nothing, because the app was never where the decision was made.
--
-- THE MOBILE PROFESSIONAL — DECIDED
--
-- A service_area location has no physical point (chantier 4 makes that
-- structural: latitude and longitude are NULL and cannot be otherwise). There
-- is therefore nothing to measure 150 m from, and no honest geofence exists.
--
--   DECISION: THE LIVE QUEUE IS NOT AVAILABLE AT A SERVICE AREA.
--
-- Not "QR alone is enough". A queue is a line of people standing somewhere,
-- and a professional who travels to the customer does not have one — the
-- feature is meaningless for them rather than merely hard to secure. Accepting
-- a QR-only check-in would have produced a live queue with a position and a
-- wait for a barber who is at somebody else's flat, which is the fabricated
-- operational state MASTER_SPEC §2 forbids outright.
--
-- Enforced in private.queue_admission_allowed, so get_public_service_state
-- already reports queue_accepting_new_entries = false and no interface has to
-- special-case it, and refused by name in join_public_queue for anything that
-- gets that far. The queue_only service mode remains REPRESENTABLE on such a
-- location — forbidding the enum value would need coherence triggers on two
-- tables and would fail closed on an operator merely converting a location —
-- but it admits nobody. An inert setting is safer than a migration that can
-- brick a live configuration.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. The establishment's QR token
--
-- On locations, as B1 specifies, and NOT on location_service_settings — that
-- table is in the supabase_realtime publication, and a token broadcast to every
-- subscribed client is a token that has left the building. locations is not
-- published and anon holds no privilege on it, so the value reaches a customer
-- only by being scanned off the wall.
--
-- 16 random bytes, hex. Not a secret in the cryptographic sense — it is
-- printed and displayed — but not guessable either, which is the property that
-- actually matters: the attack it defeats is "join without visiting", not
-- "join without permission".
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists queue_check_in_token text;

update public.locations
set queue_check_in_token = encode(extensions.gen_random_bytes(16), 'hex')
where queue_check_in_token is null;

alter table public.locations
  alter column queue_check_in_token set not null,
  alter column queue_check_in_token set default encode(extensions.gen_random_bytes(16), 'hex');

alter table public.locations
  drop constraint if exists locations_queue_check_in_token_shape;

alter table public.locations
  add constraint locations_queue_check_in_token_shape
  check (queue_check_in_token ~ '^[0-9a-f]{32}$');

create unique index if not exists locations_queue_check_in_token_unique
  on public.locations (queue_check_in_token);

comment on column public.locations.queue_check_in_token is
  'The value encoded in the QR code displayed inside the establishment. Regenerable by an owner or manager (regenerate_location_queue_check_in_token) so a shop that suspects its code is circulating can invalidate every printed copy at once. Never selectable by anon — locations grants no privilege to that role — and never returned by a public RPC: join_public_queue COMPARES it, and comparison is the only public operation on it.';

-- ---------------------------------------------------------------------------
-- 2. The thresholds, per establishment
--
-- MASTER_SPEC §7 gives three numbers and says each is adjustable per salon:
-- 150 m, 5 minutes of grace after a call, 20 waiting per barber. None existed.
-- They live on location_service_settings, which is already THE per-
-- establishment operational settings row.
--
-- "Réglable /platform" in the spec means a platform-wide default. There is no
-- platform settings table in this schema — V2_DATA_CONTRACT §2 lists its
-- absence as a known P5 gap — so the platform default is the COLUMN DEFAULT
-- here, and the per-salon override is the row value. When P5 builds the
-- settings table these three columns are what it will point at.
-- ---------------------------------------------------------------------------

alter table public.location_service_settings
  add column if not exists queue_geofence_meters integer not null default 150,
  add column if not exists queue_call_grace_minutes integer not null default 5,
  add column if not exists queue_capacity_per_barber integer not null default 20;

alter table public.location_service_settings
  drop constraint if exists location_service_settings_queue_thresholds_range;

alter table public.location_service_settings
  add constraint location_service_settings_queue_thresholds_range check (
    queue_geofence_meters between 25 and 2000
    and queue_call_grace_minutes between 0 and 120
    and queue_capacity_per_barber between 1 and 200
  );

comment on column public.location_service_settings.queue_geofence_meters is
  'How close a customer must be to join the live queue. 150 m by default (MASTER_SPEC §7). The lower bound of 25 m is GPS accuracy — a tighter fence would refuse people standing in the shop; the upper bound of 2 km is where "physically present" stops meaning anything.';

comment on column public.location_service_settings.queue_call_grace_minutes is
  'Minutes a called customer keeps their place before being treated as absent. 5 by default (MASTER_SPEC §7). STORED AND EXPOSED BY B1, NOT YET ENFORCED: no sweep marks a called entry missed. The operator does it by hand today, exactly as before, and the column is what the sweep will read when it is written.';

comment on column public.location_service_settings.queue_capacity_per_barber is
  'How many customers may be WAITING per bookable barber before the public queue refuses new entries. 20 by default (MASTER_SPEC §7). Enforced at the public door only: a receptionist adding a walk-in at the desk is making a deliberate operational decision and is not blocked by it.';

-- ---------------------------------------------------------------------------
-- 3. A service area admits nobody to a queue
-- ---------------------------------------------------------------------------

create or replace function private.queue_admission_allowed(p_organization_id uuid, p_location_id uuid, p_barber_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      private.org_has_capability(p_organization_id, 'walkIns')
      or private.org_has_capability(p_organization_id, 'liveQueue')
    )
    -- A zone has no door to stand outside of. See this file's header.
    and (select l.kind = 'physical_address' from public.locations l where l.id = p_location_id)
    and private.mode_allows_queue((select m.mode from private.effective_service_mode(p_location_id, p_barber_id) m))
    and (select s.queue_open from private.location_service_settings_effective(p_location_id) s),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. How full is this line right now
--
-- Bounded to TODAY in the establishment's own timezone, for the reason
-- search_public_professionals already documents: nothing in this schema
-- expires a 'waiting' row, so an unbounded count would report last Tuesday's
-- abandoned entries as people standing in the shop.
-- ---------------------------------------------------------------------------

create or replace function private.queue_waiting_count(p_location_id uuid, p_barber_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.queue_entries qe
  join public.locations l on l.id = qe.location_id
  where qe.location_id = p_location_id
    and qe.status = 'waiting'
    and qe.created_at >= (date_trunc('day', now() at time zone l.timezone) at time zone l.timezone)
    and (p_barber_id is null or qe.barber_id = p_barber_id);
$$;

revoke all on function private.queue_waiting_count(uuid, uuid) from public, anon, authenticated;

create or replace function private.queue_capacity(p_location_id uuid, p_barber_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_barber_id is not null then s.queue_capacity_per_barber
    -- A shared line is worth the whole floor: the per-barber allowance times
    -- the barbers actually able to take a walk-in. greatest(...,1) so an
    -- establishment between hires refuses everyone rather than dividing by a
    -- roster of zero.
    else s.queue_capacity_per_barber * greatest((
      select count(*)::integer
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      where b.organization_id = s.organization_id
        and sp.location_id = p_location_id
        and b.is_bookable and sp.is_active
    ), 1)
  end
  from public.location_service_settings s
  where s.location_id = p_location_id;
$$;

revoke all on function private.queue_capacity(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. join_public_queue — presence, proved on the server
--
-- The three new parameters are appended with NULL defaults so the SIGNATURE
-- stays additive, and every one of them is REFUSED when NULL. A caller that
-- has not been updated fails loudly with a named reason rather than quietly
-- keeping the old behaviour, which is the whole point: a default that let the
-- check through would reintroduce the defect it is here to close.
--
-- REFUSAL REASONS, DISTINGUISHABLE BY THE CALLER. Every refusal carries
-- DETAIL 'fadeup_queue_refusal=<code>', which PostgREST surfaces as the
-- `details` field of its JSON error body. P2 branches on the code, not on the
-- prose, and the prose stays free to be rewritten and translated:
--
--   service_area_has_no_queue   the professional is mobile; there is no line
--   invalid_check_in_token      no token, or not this establishment's
--   location_not_geolocated     the shop has no coordinates, so presence
--                               cannot be checked at all — a shop-side fix,
--                               not a customer-side one, and named separately
--                               so the customer is not told to move closer
--   position_required           the caller sent no coordinates
--   too_far                     outside the geofence
--   queue_closed                mode, queue_open or entitlement says no
--   queue_full                  capacity reached
--   already_in_queue            this person is already waiting somewhere
--
-- ORDER MATTERS. The token is checked before capacity and before the queue
-- state, so a caller without the token learns nothing about the shop's
-- occupancy or configuration by probing.
-- ---------------------------------------------------------------------------

create or replace function public.join_public_queue(
  p_organization_slug text,
  p_location_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_barber_id uuid default null,
  p_service_id uuid default null,
  p_check_in_token text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
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
  v_location public.locations;
  v_geofence_meters integer;
  v_distance_meters double precision;
  v_waiting integer;
  v_capacity integer;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_name is required';
  end if;

  select o.id into v_organization_id from public.organizations o where o.slug = p_organization_slug;
  if not found then
    raise exception 'unknown organization';
  end if;

  select l.* into v_location
  from public.locations l
  where l.id = p_location_id and l.organization_id = v_organization_id and l.is_active;

  if not found then
    raise exception 'location is not available';
  end if;

  -- (a) A zone has no queue. Decided and explained in this file's header.
  if v_location.kind = 'service_area' then
    raise exception 'this professional works in a service area and has no live queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=service_area_has_no_queue',
            hint = 'A live queue is a line of people at an address. Book a slot instead.';
  end if;

  -- (b) The QR token. Compared against THIS establishment's value, so a token
  -- scanned in one shop cannot be replayed against another.
  if nullif(btrim(coalesce(p_check_in_token, '')), '') is null
     or lower(btrim(p_check_in_token)) <> v_location.queue_check_in_token then
    raise exception 'the check-in code for this establishment is missing or invalid'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=invalid_check_in_token',
            hint = 'Scan the QR code displayed in the shop.';
  end if;

  -- (c) The geofence, measured here and nowhere else. A client that computes
  -- its own distance and sends a verdict is a client that can send true.
  if v_location.latitude is null or v_location.longitude is null then
    raise exception 'this establishment has not published its position, so presence cannot be verified'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=location_not_geolocated',
            hint = 'The establishment must set its coordinates before the live queue can admit anyone.';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'your position is required to join the queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=position_required',
            hint = 'Joining a live queue requires being at the shop.';
  end if;

  select s.queue_geofence_meters into v_geofence_meters
  from public.location_service_settings s
  where s.location_id = p_location_id;
  v_geofence_meters := coalesce(v_geofence_meters, 150);

  v_distance_meters := private.point_distance_km(
    p_latitude, p_longitude, v_location.latitude, v_location.longitude
  ) * 1000.0;

  if v_distance_meters is null or v_distance_meters > v_geofence_meters then
    raise exception 'you are too far from this establishment to join its queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=too_far',
            hint = format('The live queue admits customers within %s m.', v_geofence_meters);
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

  -- (d) Is the line open at all. The enforce_queue_service_mode trigger checks
  -- this too and is the guarantee; asking here turns its generic refusal into
  -- one of the named codes P2 can branch on.
  if not private.queue_admission_allowed(v_organization_id, p_location_id, p_barber_id) then
    raise exception 'this queue is not accepting new entries right now'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_closed';
  end if;

  -- (e) Capacity.
  v_waiting  := private.queue_waiting_count(p_location_id, p_barber_id);
  v_capacity := private.queue_capacity(p_location_id, p_barber_id);
  if v_capacity is not null and v_waiting >= v_capacity then
    raise exception 'this queue is full'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=queue_full',
            hint = format('%s people are already waiting.', v_waiting);
  end if;

  v_user_id := (select auth.uid());

  -- (f) One line at a time. A signed-in customer is matched on their account,
  -- which is exact. An anonymous kiosk check-in can only be matched on the
  -- phone number they typed, at this establishment — weaker, and honestly so:
  -- an anonymous customer who gives a different number each time is not
  -- detectable here, and the QR plus the geofence are what stand in the way.
  if v_user_id is not null and exists (
    select 1 from public.queue_entries qe
    where qe.booked_by_user_id = v_user_id
      and qe.status in ('waiting', 'called', 'in_service')
  ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  if v_user_id is null
     and nullif(btrim(coalesce(p_customer_phone, '')), '') is not null
     and exists (
       select 1 from public.queue_entries qe
       where qe.location_id = p_location_id
         and qe.customer_phone = btrim(p_customer_phone)
         and qe.status in ('waiting', 'called', 'in_service')
     ) then
    raise exception 'you are already in a queue'
      using errcode = '42501',
            detail = 'fadeup_queue_refusal=already_in_queue';
  end if;

  -- Signed-in walk-in: attach the entry to the caller's OWN customer record
  -- for this shop so get_my_queue_status can find it. Anonymous kiosk
  -- check-in leaves this null and behaves exactly as before.
  if v_user_id is not null then
    v_customer_id := private.resolve_customer_for_user(
      v_organization_id, v_user_id, p_customer_name, p_customer_phone, null
    );
  end if;

  insert into public.queue_entries (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, status, created_by, booked_by_user_id)
  values (v_organization_id, p_location_id, p_barber_id, p_service_id, v_customer_id, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''), 'waiting', null, v_user_id)
  returning * into v_entry;

  return query select v_entry.id, v_entry.status, v_entry.created_at;
end;
$$;

comment on function public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision) is
  'Anon-callable. Joins the live queue of an establishment, and since B1 requires PROOF OF PRESENCE to do it: the QR token displayed in the shop plus coordinates within the establishment''s geofence (150 m by default, per-salon). Both are verified on the server, so calling the REST API directly is exactly as constrained as using the app. Both are also defeatable by a determined person — a photographed QR, a spoofed position — and nothing downstream should treat a queue entry as evidence that someone was physically present. Refusals carry DETAIL fadeup_queue_refusal=<code>: service_area_has_no_queue, invalid_check_in_token, location_not_geolocated, position_required, too_far, queue_closed, queue_full, already_in_queue.';

revoke all on function public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision) from public;
grant execute on function public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision) to anon, authenticated, service_role;

-- The pre-B1 six-argument signature still resolves for any caller that has not
-- been updated, and PostgREST would happily route to it. Drop it: leaving a
-- door open that skips the presence check is the defect, not a compatibility
-- courtesy.
drop function if exists public.join_public_queue(text, uuid, text, text, uuid, uuid);

-- ---------------------------------------------------------------------------
-- 6. The professional's side of the QR
-- ---------------------------------------------------------------------------

create or replace function public.get_location_queue_check_in(p_location_id uuid)
returns table (
  location_id uuid,
  queue_check_in_token text,
  queue_geofence_meters integer,
  queue_call_grace_minutes integer,
  queue_capacity_per_barber integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Receptionist included: reprinting the code that is taped to the counter is
  -- front-of-house work, the same category as opening and closing the queue.
  perform private.assert_service_mode_authority(p_location_id, null, true);

  return query
  select l.id, l.queue_check_in_token,
         s.queue_geofence_meters, s.queue_call_grace_minutes, s.queue_capacity_per_barber
  from public.locations l
  join private.location_service_settings_effective(p_location_id) e on e.location_id = l.id
  left join public.location_service_settings s on s.location_id = l.id
  where l.id = p_location_id;
end;
$$;

comment on function public.get_location_queue_check_in(uuid) is
  'Owner, manager or receptionist. The establishment''s QR check-in token and its three queue thresholds, for the Pro screen that prints the code. The token is returned ONLY here — no public RPC ever emits it.';

revoke all on function public.get_location_queue_check_in(uuid) from public, anon;
grant execute on function public.get_location_queue_check_in(uuid) to authenticated, service_role;

create or replace function public.regenerate_location_queue_check_in_token(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  -- Owner or manager only, receptionist excluded: this invalidates every
  -- printed copy in the building at once. That is a decision, not a task.
  perform private.assert_service_mode_authority(p_location_id, null, false);

  update public.locations
  set queue_check_in_token = encode(extensions.gen_random_bytes(16), 'hex')
  where id = p_location_id
  returning queue_check_in_token into v_token;

  if v_token is null then
    raise exception 'location not found' using errcode = '42704';
  end if;

  return v_token;
end;
$$;

comment on function public.regenerate_location_queue_check_in_token(uuid) is
  'Owner or manager. Issues a new QR check-in token for the establishment, invalidating every printed copy immediately. The reason this exists: the token is displayed in public, so a shop that suspects it is circulating outside the building needs to be able to retire it without waiting for anyone.';

revoke all on function public.regenerate_location_queue_check_in_token(uuid) from public, anon;
grant execute on function public.regenerate_location_queue_check_in_token(uuid) to authenticated, service_role;

commit;
