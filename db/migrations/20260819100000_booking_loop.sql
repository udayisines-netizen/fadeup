-- FadeUp — LOT C: close the booking loop
--
-- The booking ENGINE is correct and stays untouched. What was missing was the
-- loop around it: a public booking landed as `pending`, the GiST exclusion
-- constraint dutifully held the slot, and then nothing ever happened. No shop
-- workflow, no customer feedback, no expiry. A request nobody answered blocked
-- that barber's slot forever.
--
-- ============================================================================
-- THE CENTRAL DESIGN DECISION: NO NEW STATUS VALUES
-- ============================================================================
--
-- The obvious move is to add `declined` and `expired` to appointment_status.
-- It is the wrong one, and the reason is worth writing down.
--
-- Slot occupancy is decided by ONE thing — the predicate on the exclusion
-- constraints:
--
--     EXCLUDE USING gist (barber_id WITH =, blocked_range WITH &&)
--       WHERE (status <> ALL (ARRAY['cancelled', 'no_show']))
--
-- A new status is invisible to that predicate, so `declined` would occupy the
-- slot exactly as `pending` did — the bug, renamed. Fixing that means DROP +
-- ADD on the constraint: an ACCESS EXCLUSIVE lock, a full re-validation, and a
-- window in which FadeUp's only double-booking guard does not exist. That
-- guard is proven and is explicitly not to be weakened.
--
-- So a decision that ENDS a request resolves to `cancelled` — already in the
-- predicate, so the slot is freed by the constraint we did not touch — and a
-- new `resolution` column records WHY. Same statuses, richer meaning, zero
-- risk to the concurrency guard. `resolution` is what the customer's screen
-- reads to say "not accepted" rather than "cancelled".
--
--     status=cancelled + resolution=declined              -> shop said no
--     status=cancelled + resolution=expired               -> nobody answered
--     status=cancelled + resolution=cancelled_by_customer -> customer withdrew
--     status=cancelled + resolution=cancelled_by_business -> shop cancelled
--     status=cancelled + resolution=rescheduled           -> superseded
--
-- ============================================================================
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle metadata on appointments
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'appointment_resolution') then
    create type public.appointment_resolution as enum (
      'declined',
      'expired',
      'cancelled_by_customer',
      'cancelled_by_business',
      'rescheduled'
    );
  end if;
end $$;

comment on type public.appointment_resolution is
  'WHY an appointment reached a terminal state. Paired with status=cancelled so the existing GiST exclusion predicate frees the slot without being rebuilt — see this migration''s header.';

alter table public.appointments
  -- When a pending request stops being answerable. Server-derived (see the
  -- trigger below); never accepted from a client.
  add column if not exists expires_at timestamptz,
  add column if not exists resolution public.appointment_resolution,
  add column if not exists resolution_note text,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references auth.users (id) on delete set null,
  -- Set on the OLD row when a reschedule supersedes it, so both sides of the
  -- move are traceable without a separate history table.
  add column if not exists rescheduled_to uuid references public.appointments (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_resolution_note_length') then
    alter table public.appointments
      add constraint appointments_resolution_note_length
      check (resolution_note is null or char_length(resolution_note) <= 500);
  end if;
  -- A resolution only makes sense once the appointment has actually ended.
  if not exists (select 1 from pg_constraint where conname = 'appointments_resolution_terminal_only') then
    alter table public.appointments
      add constraint appointments_resolution_terminal_only
      check (resolution is null or status in ('cancelled', 'no_show'));
  end if;
end $$;

comment on column public.appointments.expires_at is
  'When an unanswered booking request stops being answerable. Set by the appointments_set_request_expiry trigger from organizations.booking_request_ttl_minutes — the single authoritative policy value. NULL for anything not awaiting a decision.';
comment on column public.appointments.resolution is
  'Why this appointment ended. status says the slot is free; resolution says whether the shop declined, nobody answered, or someone cancelled.';
comment on column public.appointments.rescheduled_to is
  'On a superseded row: the appointment that replaced it.';

-- The request inbox's hot path: "pending requests for this organization,
-- soonest expiry first". Partial, so it indexes only rows that can appear.
create index if not exists appointments_pending_requests_idx
  on public.appointments (organization_id, expires_at)
  where status = 'pending';

-- The expiry sweep's hot path: "pending rows already past their deadline",
-- across all tenants. Deliberately separate from the index above — the sweep
-- does not filter by organization, so a leading organization_id column would
-- make it scan.
create index if not exists appointments_expiring_idx
  on public.appointments (expires_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. The decision window, as ONE authoritative value
--
--    Stored on the organization so a shop can set its own answering time, and
--    applied by a trigger so EVERY insert path gets it — the anon booking RPC,
--    the staff dialog, and anything added later. The frontend reads expires_at
--    off the row and never computes it, which is what stops the policy from
--    existing in two places that can disagree.
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists booking_request_ttl_minutes integer not null default 1440;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_booking_ttl_sane') then
    alter table public.organizations
      add constraint organizations_booking_ttl_sane
      check (booking_request_ttl_minutes between 15 and 20160);
  end if;
end $$;

comment on column public.organizations.booking_request_ttl_minutes is
  'How long a booking request waits for an answer before expiring and releasing the slot. Default 1440 (24h); floor 15 minutes, ceiling 14 days. THE authoritative policy — the trigger reads it, the client only ever reads the resulting expires_at.';

create or replace function public.set_appointment_request_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ttl integer;
begin
  if new.status = 'pending' then
    -- Only derive on the way IN to pending. A row already carrying a deadline
    -- keeps it, so a reschedule or a staff edit never silently extends the
    -- window a customer is already watching count down.
    if new.expires_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'pending') then
      select o.booking_request_ttl_minutes into v_ttl
        from public.organizations o where o.id = new.organization_id;
      new.expires_at := now() + make_interval(mins => coalesce(v_ttl, 1440));
    end if;

    -- A request can never outlive the appointment it is asking for: answering
    -- at 10:05 for a 10:00 slot is not an answer.
    new.expires_at := least(new.expires_at, new.starts_at);
  else
    -- Left pending: there is nothing left to expire. Keeping a stale deadline
    -- would make the sweep and the UI both lie.
    new.expires_at := null;
  end if;

  return new;
end;
$$;

comment on function public.set_appointment_request_expiry() is
  'BEFORE INSERT/UPDATE: derives appointments.expires_at from the organization''s booking_request_ttl_minutes, capped at the appointment start. Server-side only — a client-supplied expires_at is always overwritten.';

drop trigger if exists appointments_set_request_expiry on public.appointments;
create trigger appointments_set_request_expiry
  before insert or update on public.appointments
  for each row execute function public.set_appointment_request_expiry();

-- ---------------------------------------------------------------------------
-- 3. Product notifications
--
--    public.platform_notifications is FadeUp staff only — its RLS demands a
--    platform role — so it cannot carry "your appointment was confirmed".
--    This is the customer/professional equivalent: one row per recipient,
--    owner-scoped, and deliberately the smallest thing that works. Push is a
--    later channel; nothing here forecloses it.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'booking_request_created',
      'booking_confirmed',
      'booking_declined',
      'booking_expired',
      'booking_cancelled',
      'booking_rescheduled',
      'team_invitation'
    );
  end if;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.notification_type not null,
  -- Denormalized display data, captured at emit time. A notification must
  -- still read correctly after the thing it describes has moved on.
  title text not null,
  body text,
  organization_id uuid references public.organizations (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,
  /**
   * Makes emission idempotent. Every emitter derives it from the transition
   * itself, so replaying a transition writes the same key and the unique
   * index below silently absorbs it. The state guards in the RPCs already
   * prevent a second transition; this makes "exactly one notification" a
   * property of the schema rather than of the callers being careful.
   */
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_title_not_blank check (btrim(title) <> '')
);

comment on table public.notifications is
  'Product notifications for customers and professionals. Distinct from platform_notifications, which is FadeUp staff only. Owner-scoped RLS: a recipient reads and dismisses their own rows and nothing else. Written server-side inside the same transaction as the business transition it describes.';

create unique index if not exists notifications_dedupe_key_unique on public.notifications (dedupe_key);
-- The bell's two queries: unread count, and the recent list.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Read your own. No INSERT policy at all: notifications are produced
-- server-side by the transition functions, never by a client.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Marking your own read is the only client write, and the WITH CHECK stops it
-- being used to move a row to somebody else.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke insert, delete on public.notifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.emit_booking_notification
--
--    One place that writes BOTH channels for a booking transition: the in-app
--    row and the email_outbox intent. Every transition RPC calls it inside its
--    own transaction, so a decision and the intent to tell someone about it
--    commit together or not at all.
--
--    Email DELIVERY is deliberately not part of that transaction — the outbox
--    is a durable queue drained separately, so an SMTP outage can never roll
--    back a confirmed booking. That is the whole point of the outbox pattern
--    this reuses rather than reinvents.
-- ---------------------------------------------------------------------------

create or replace function private.emit_booking_notification(
  p_appointment public.appointments,
  p_type public.notification_type,
  p_audience text,               -- 'customer' | 'business'
  p_title text,
  p_body text default null,
  p_email_template text default null,
  p_dedupe_suffix text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_org_name text;
  v_service_name text;
  v_recipient record;
begin
  select o.name into v_org_name from public.organizations o where o.id = p_appointment.organization_id;
  select s.name into v_service_name from public.services s where s.id = p_appointment.service_id;

  if p_audience = 'customer' then
    -- The account behind the booking, if there is one. An anonymous booking
    -- has no account to notify in-app; it still gets the email, because the
    -- appointment carries the address that was typed at booking time.
    select c.user_id into v_user_id
      from public.customers c where c.id = p_appointment.customer_id;
    v_email := p_appointment.customer_email;

    if v_user_id is not null then
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':customer' || p_dedupe_suffix)
      on conflict (dedupe_key) do nothing;
    end if;

    if v_email is not null and p_email_template is not null then
      insert into public.email_outbox (to_email, template, payload)
      values (v_email, p_email_template, jsonb_build_object(
        'appointment_id', p_appointment.id,
        'organization_name', v_org_name,
        'service_name', v_service_name,
        'starts_at', p_appointment.starts_at,
        'customer_name', p_appointment.customer_name
      ));
    end if;

  elsif p_audience = 'business' then
    -- Everyone who can actually act on it. A request that only reaches the
    -- owner is a request that waits for the owner to be free.
    for v_recipient in
      select m.user_id
        from public.memberships m
        where m.organization_id = p_appointment.organization_id
          and m.role in ('owner', 'manager', 'receptionist')
    loop
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_recipient.user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':' || v_recipient.user_id::text || p_dedupe_suffix)
      on conflict (dedupe_key) do nothing;
    end loop;

    if p_email_template is not null then
      -- One address for the shop: the owner's. Fanning transactional email out
      -- to every member is a notification-preference decision, not a booking
      -- one, and belongs with the preferences that do not exist yet.
      select u.email into v_email
        from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.organization_id = p_appointment.organization_id and m.role = 'owner'
        order by m.created_at
        limit 1;

      if v_email is not null then
        insert into public.email_outbox (to_email, template, payload)
        values (v_email, p_email_template, jsonb_build_object(
          'appointment_id', p_appointment.id,
          'organization_name', v_org_name,
          'service_name', v_service_name,
          'starts_at', p_appointment.starts_at,
          'customer_name', p_appointment.customer_name
        ));
      end if;
    end if;
  end if;
end;
$$;

comment on function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text) is
  'Writes the in-app notification and the email_outbox intent for one booking transition, inside the caller''s transaction. Idempotent via notifications.dedupe_key. Email delivery itself stays asynchronous — an SMTP outage must never roll back a booking decision.';

revoke execute on function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Notify the shop when a request arrives
--
--    An AFTER INSERT trigger rather than an edit to book_public_appointment:
--    it covers every path that creates a pending appointment, and it keeps a
--    200-line, twice-hardened, security-critical function untouched.
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_booking_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;

  perform private.emit_booking_notification(
    new,
    'booking_request_created',
    'business',
    'New booking request',
    new.customer_name,
    'booking_request_created'
  );
  return new;
end;
$$;

drop trigger if exists appointments_notify_new_request on public.appointments;
create trigger appointments_notify_new_request
  after insert on public.appointments
  for each row execute function public.notify_new_booking_request();

-- ---------------------------------------------------------------------------
-- 6. The decision RPCs
--
--    Every one of them: SECURITY DEFINER with a pinned search_path, an
--    explicit authorization check (DEFINER bypasses RLS, so the check must be
--    written out), `select ... for update` to serialize concurrent callers on
--    the row, a state guard so a losing racer sees the settled state instead
--    of overwriting it, and a notification emitted in the same transaction.
--
--    The state guard is also what makes them idempotent: a second Accept finds
--    a row that is no longer pending and returns it unchanged.
-- ---------------------------------------------------------------------------

create or replace function private.can_manage_appointments(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select private.has_org_role(
    p_organization_id,
    array['owner', 'manager', 'receptionist']::public.membership_role[]
  ));
$$;

comment on function private.can_manage_appointments(uuid) is
  'The front-of-house roles that may decide a booking request. Matches the existing appointments INSERT/UPDATE policies exactly rather than inventing a second rule.';

revoke execute on function private.can_manage_appointments(uuid) from public, anon;
grant execute on function private.can_manage_appointments(uuid) to authenticated;

-- confirm_booking_request ------------------------------------------------------
create or replace function public.confirm_booking_request(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  -- Idempotent: whoever lost the race gets the settled row, not an error and
  -- not a second confirmation.
  if v_appointment.status = 'confirmed' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'this request has already been answered' using errcode = '22023';
  end if;

  -- The accept-versus-expire race. The row is locked, so the sweep is either
  -- already done (status is no longer pending, caught above) or is waiting
  -- behind this lock and will find the row confirmed. This check closes the
  -- remaining case: the deadline passed but the sweep has not run yet.
  if v_appointment.expires_at is not null and v_appointment.expires_at <= now() then
    raise exception 'this request has expired' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'confirmed',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_confirmed', 'customer',
    'Your appointment is confirmed',
    null, 'booking_confirmed'
  );

  return v_appointment;
end;
$$;

comment on function public.confirm_booking_request(uuid) is
  'Accepts a pending booking request. Owner/manager/receptionist of that organization only. Row-locked and state-guarded, so concurrent accepts settle on one outcome and a second accept is a harmless no-op. Refuses an expired request even if the sweep has not reached it yet.';

revoke execute on function public.confirm_booking_request(uuid) from public, anon;
grant execute on function public.confirm_booking_request(uuid) to authenticated;

-- decline_booking_request ------------------------------------------------------
create or replace function public.decline_booking_request(p_appointment_id uuid, p_note text default null)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  if v_appointment.status = 'cancelled' and v_appointment.resolution = 'declined' then
    return v_appointment;
  end if;

  if v_appointment.status <> 'pending' then
    raise exception 'this request has already been answered' using errcode = '22023';
  end if;

  -- status=cancelled is what frees the slot, through the untouched exclusion
  -- predicate. resolution is what lets the customer's screen say "not
  -- accepted" instead of "cancelled".
  update public.appointments
    set status = 'cancelled',
        resolution = 'declined',
        resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_declined', 'customer',
    'Your booking request was not accepted',
    v_appointment.resolution_note, 'booking_declined'
  );

  return v_appointment;
end;
$$;

comment on function public.decline_booking_request(uuid, text) is
  'Declines a pending booking request and frees the slot. The optional note is shown to the customer, so it is length-checked and never required.';

revoke execute on function public.decline_booking_request(uuid, text) from public, anon;
grant execute on function public.decline_booking_request(uuid, text) to authenticated;

-- cancel_appointment_as_business -----------------------------------------------
create or replace function public.cancel_appointment_as_business(p_appointment_id uuid, p_note text default null)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  if not (select private.can_manage_appointments(v_appointment.organization_id)) then
    raise exception 'not authorized to manage this booking' using errcode = '42501';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled' using errcode = '22023';
  end if;

  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_business',
        resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'customer',
    'Your appointment was cancelled',
    v_appointment.resolution_note, 'booking_cancelled'
  );

  return v_appointment;
end;
$$;

comment on function public.cancel_appointment_as_business(uuid, text) is
  'Shop-side cancellation of a pending or confirmed appointment. Frees the slot and tells the customer. Mirrors cancel_my_appointment on the customer side rather than reusing it, because the authorization and the resolution differ.';

revoke execute on function public.cancel_appointment_as_business(uuid, text) from public, anon;
grant execute on function public.cancel_appointment_as_business(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Customer cancellation — same rules, now part of the loop
--
--    cancel_my_appointment already existed and already had the right
--    authorization. It gains a resolution and a notification to the shop.
--    Signature and return type unchanged, so it is CREATE OR REPLACE.
-- ---------------------------------------------------------------------------

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
    )
  for update;

  if not found then
    raise exception 'appointment not found';
  end if;

  if v_appointment.status = 'cancelled' then
    return v_appointment;
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled';
  end if;

  update public.appointments
    set status = 'cancelled',
        resolution = 'cancelled_by_customer',
        decided_at = now(),
        decided_by = (select auth.uid())
    where id = p_appointment_id
    returning * into v_appointment;

  perform private.emit_booking_notification(
    v_appointment, 'booking_cancelled', 'business',
    'A customer cancelled',
    v_appointment.customer_name, 'booking_cancelled'
  );

  return v_appointment;
end;
$$;

comment on function public.cancel_my_appointment(uuid) is
  'Authenticated-only: cancel the caller''s own appointment, only while pending/confirmed. Unchanged authorization; now records resolution=cancelled_by_customer and notifies the shop in the same transaction.';

revoke execute on function public.cancel_my_appointment(uuid) from public, anon;
grant execute on function public.cancel_my_appointment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reschedule
--
--    Moving the SAME row rather than creating a replacement. That is what
--    makes it atomic: there is never a moment when two appointments exist, the
--    exclusion constraint validates the new range against every other row (a
--    row cannot conflict with itself), and a violation aborts the statement
--    leaving the original exactly as it was.
--
--    Who may move it to what state follows the product's existing shape: the
--    shop is the authority on its own diary, so a shop reschedule stays
--    confirmed. A customer is asking, not telling — the public booking flow
--    already creates `pending` for exactly that reason — so a customer
--    reschedule returns the appointment to `pending` and re-opens the decision
--    window rather than silently moving a slot the shop had agreed to.
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_barber_id uuid default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_is_business boolean;
  v_is_customer boolean;
  v_barber_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_new_status public.appointment_status;
begin
  select * into v_appointment from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'appointment not found' using errcode = '42704';
  end if;

  v_is_business := (select private.can_manage_appointments(v_appointment.organization_id));
  v_is_customer := v_appointment.customer_id in (
    select c.id from public.customers c where c.user_id = (select auth.uid())
  );

  if not (v_is_business or v_is_customer) then
    raise exception 'not authorized to reschedule this booking' using errcode = '42501';
  end if;

  if v_appointment.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled' using errcode = '22023';
  end if;

  if p_starts_at <= now() then
    raise exception 'the new time must be in the future' using errcode = '22023';
  end if;

  v_barber_id := coalesce(p_barber_id, v_appointment.barber_id);

  -- A different professional must still belong to this shop and still be
  -- eligible for this service. Never trusted from the caller.
  if v_barber_id <> v_appointment.barber_id then
    if not exists (
      select 1
      from public.barbers b
      join public.staff_profiles sp on sp.id = b.staff_profile_id
      join public.barber_services bs on bs.barber_id = b.id and bs.service_id = v_appointment.service_id
      where b.id = v_barber_id
        and b.organization_id = v_appointment.organization_id
        and b.is_bookable and sp.is_active and sp.is_public
    ) then
      raise exception 'that professional is not available for this service' using errcode = '22023';
    end if;
  end if;

  -- Duration comes from the SNAPSHOT on the appointment, not from the service
  -- as it stands today: a price list edited since booking must not silently
  -- change the length of an appointment already agreed.
  v_duration := (extract(epoch from (v_appointment.ends_at - v_appointment.starts_at)) / 60)::integer;
  v_ends_at := p_starts_at + make_interval(mins => v_duration);

  -- The shop owns its diary; a customer is asking. A customer move re-opens
  -- the decision, and the expiry trigger re-derives the window because the row
  -- is entering pending from a different state.
  v_new_status := case when v_is_business then v_appointment.status else 'pending' end;

  -- Raised for exactly this UPDATE, after the ownership and availability
  -- checks above. Lets the LOT 11 column guard know this is the sanctioned
  -- reschedule path rather than a barber editing a time directly.
  perform set_config('fadeup.appointment_reschedule', 'on', true);

  -- One statement. The GiST exclusion constraint is the authority on whether
  -- the destination is free; if it raises, nothing here has changed.
  update public.appointments
    set starts_at = p_starts_at,
        ends_at = v_ends_at,
        barber_id = v_barber_id,
        status = v_new_status,
        expires_at = case when v_new_status = 'pending' then null else expires_at end,
        decided_at = case when v_is_business then now() else null end,
        decided_by = case when v_is_business then (select auth.uid()) else null end
    where id = p_appointment_id
    returning * into v_appointment;

  perform set_config('fadeup.appointment_reschedule', 'off', true);

  perform private.emit_booking_notification(
    v_appointment, 'booking_rescheduled',
    case when v_is_business then 'customer' else 'business' end,
    'Appointment moved',
    v_appointment.customer_name,
    'booking_rescheduled',
    -- A reschedule can legitimately happen more than once, so the dedupe key
    -- includes the destination. Replaying the SAME move stays a no-op;
    -- a genuinely new move notifies again, which is correct.
    ':' || extract(epoch from p_starts_at)::bigint::text
  );

  return v_appointment;
end;
$$;

comment on function public.reschedule_appointment(uuid, timestamptz, uuid) is
  'Moves an appointment in place. Business callers keep the current status; customer callers return it to pending, because the shop is the authority on its own diary. Atomic by construction — the same row is updated, so two appointments never exist at once and a GiST violation leaves the original untouched.';

revoke execute on function public.reschedule_appointment(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Expiry sweep
--
--    Runs on a schedule, never on a page load. The previous opportunistic
--    no-show pattern (fire it when staff happen to open the schedule) cannot
--    work here: the whole failure mode is a shop that is NOT looking.
--
--    Batched with `for update skip locked` so it never blocks a staff member
--    accepting a request — the sweep simply leaves a locked row for the next
--    pass, by which time it will have been answered.
-- ---------------------------------------------------------------------------

create or replace function public.expire_pending_appointments(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_count integer := 0;
begin
  for v_appointment in
    select * from public.appointments a
    where a.status = 'pending'
      and a.expires_at is not null
      and a.expires_at <= now()
    order by a.expires_at
    limit greatest(p_limit, 0)
    for update skip locked
  loop
    update public.appointments
      set status = 'cancelled',
          resolution = 'expired',
          decided_at = now()
      where id = v_appointment.id
        -- Re-checked under the lock: if a staff member confirmed between the
        -- select and here, this matches nothing and the row is left alone.
        and status = 'pending'
      returning * into v_appointment;

    if found then
      perform private.emit_booking_notification(
        v_appointment, 'booking_expired', 'customer',
        'Your booking request expired',
        null, 'booking_expired'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.expire_pending_appointments(integer) is
  'Transitions unanswered booking requests past their deadline to cancelled/expired, freeing the slot. Idempotent and re-entrant: batched with FOR UPDATE SKIP LOCKED and re-checked under the lock, so it never blocks or overwrites a staff decision, and running it twice changes nothing the second time.';

revoke execute on function public.expire_pending_appointments(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. The scheduler's entry point and its least-privileged role
--
--     One callable surface for background maintenance, so the scheduler needs
--     EXECUTE on exactly one function and nothing else. Deliberately separate
--     from prospect_worker: booking lifecycle must not be coupled to the
--     frozen acquisition pipeline, and neither should be able to act as the
--     other.
-- ---------------------------------------------------------------------------

create or replace function public.run_booking_maintenance()
returns table (expired_requests integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select public.expire_pending_appointments(500);
end;
$$;

comment on function public.run_booking_maintenance() is
  'The scheduler''s single entry point. Kept separate from the acquisition job queue so booking lifecycle never depends on Worker V2.';

revoke execute on function public.run_booking_maintenance() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fadeup_scheduler') then
    -- NOLOGIN here; the operator sets a password when deploying the scheduler,
    -- exactly as infra/worker/bootstrap-worker-db.sh does for prospect_worker.
    -- A password in a migration would be a password in git.
    create role fadeup_scheduler nologin;
  end if;
end $$;

grant usage on schema public to fadeup_scheduler;
grant execute on function public.run_booking_maintenance() to fadeup_scheduler;

comment on role fadeup_scheduler is
  'Background scheduler. Holds EXECUTE on run_booking_maintenance() and nothing else — no table privileges, no other function.';

-- ---------------------------------------------------------------------------
-- 11. Reads for the two new surfaces
-- ---------------------------------------------------------------------------

-- get_my_appointments: adds the lifecycle fields the customer's screen needs
-- to say "waiting", "not accepted" or "expired" rather than "cancelled".
-- Return shape changes, so DROP + CREATE — same precedent as 20260813160000.
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
  price_cents integer,
  resolution public.appointment_resolution,
  resolution_note text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.organization_id, o.name, o.slug, a.location_id, l.name,
    a.barber_id, sp.display_name, a.service_id, s.name,
    a.starts_at, a.ends_at, a.status, s.price_cents,
    a.resolution, a.resolution_note, a.expires_at, a.created_at
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
  'The signed-in customer''s own appointments across every organization. Still never returns appointments.notes — that column is shared with staff-authored internal notes. resolution/expires_at are what let the UI distinguish waiting, declined and expired.';

revoke execute on function public.get_my_appointments() from public, anon;
grant execute on function public.get_my_appointments() to authenticated;

-- get_booking_requests: the professional inbox, in one query rather than the
-- N+1 of joining names client-side.
create or replace function public.get_booking_requests(p_organization_id uuid)
returns table (
  id uuid,
  location_id uuid,
  location_name text,
  barber_id uuid,
  barber_display_name text,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  price_cents integer,
  customer_name text,
  customer_phone text,
  customer_email text,
  notes text,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    a.id, a.location_id, l.name, a.barber_id, sp.display_name,
    a.service_id, s.name,
    (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
    s.price_cents,
    a.customer_name, a.customer_phone, a.customer_email, a.notes,
    a.starts_at, a.ends_at, a.expires_at, a.created_at
  from public.appointments a
  join public.locations l on l.id = a.location_id
  left join public.barbers b on b.id = a.barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.status = 'pending'
    -- Already past its deadline but not yet swept: showing it would offer an
    -- Accept that confirm_booking_request would then refuse.
    and (a.expires_at is null or a.expires_at > now())
    and (select private.can_manage_appointments(p_organization_id))
  order by a.expires_at nulls last, a.created_at;
$$;

comment on function public.get_booking_requests(uuid) is
  'Pending booking requests awaiting a decision, for staff who may decide them. Returns nothing — rather than raising — for a caller without the role, so it is safe to call from a shared layout. Hides requests already past their deadline, since accepting one would fail.';

revoke execute on function public.get_booking_requests(uuid) from public, anon;
grant execute on function public.get_booking_requests(uuid) to authenticated;

-- Notification reads -----------------------------------------------------------
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id and n.user_id = (select auth.uid());
$$;

comment on function public.mark_notification_read(uuid) is
  'Marks one of the caller''s own notifications read. security invoker on purpose — the RLS update policy is the check, not a second one written here.';

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  with updated as (
    update public.notifications n set read_at = now()
      where n.user_id = (select auth.uid()) and n.read_at is null
      returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Realtime
--
--     Two tables, two audiences, and the difference matters.
--
--     Postgres Changes is RLS-aware: a subscriber receives an event only for
--     rows its own policies would let it SELECT. Staff have appointments_select
--     through org membership, so the request inbox can subscribe to
--     `appointments` directly. Customers deliberately have NO select policy on
--     appointments — their reads go through curated RPCs so internal columns
--     stay unreachable — so they would receive nothing. They subscribe to
--     `notifications` instead, which is owner-scoped and which every booking
--     transition already writes.
--
--     Either way the payload is a SIGNAL, never the source of truth: both
--     clients invalidate and refetch through the authorized RPC.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Team invitation delivery
--
--     The secure token architecture is already right: 32 random bytes chosen
--     by the client, single-use, expiring, and redeemable only by an account
--     whose auth email matches. What was missing was delivery — the owner was
--     shown the link once and had to send it themselves.
--
--     An AFTER INSERT trigger closes that without touching the token model or
--     the RBAC around it.
--
--     The raw token is NOT written into the email payload. The dispatcher
--     builds the URL from the path below and the canonical public origin it
--     already holds, so a token never sits in a queue table that platform
--     staff can read — which they can, by design, to observe delivery
--     failures.
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_name text;
  v_inviter text;
begin
  select o.name into v_org_name from public.organizations o where o.id = new.organization_id;
  select p.full_name into v_inviter from public.profiles p where p.id = new.invited_by;

  insert into public.email_outbox (to_email, template, payload)
  values (
    new.email,
    'team_invitation',
    jsonb_build_object(
      'invitation_id', new.id,
      'organization_name', v_org_name,
      'role', new.role,
      'invited_by', v_inviter,
      'expires_at', new.expires_at,
      -- Path only. The dispatcher prepends the canonical FadeUp origin and
      -- appends the token it reads from public.invitations under its own
      -- privileged connection.
      'accept_path', '/invite/'
    )
  );
  return new;
end;
$$;

comment on function public.notify_new_invitation() is
  'AFTER INSERT on invitations: queues the invitation email. Deliberately omits the raw token from the payload — platform staff can read email_outbox to observe delivery failures, and an invitation token is not theirs to see.';

drop trigger if exists invitations_notify_new on public.invitations;
create trigger invitations_notify_new
  after insert on public.invitations
  for each row execute function public.notify_new_invitation();

-- ---------------------------------------------------------------------------
-- 14. Realtime for team acceptance
--
--     So an owner watching the Team screen sees an invitation disappear the
--     moment it is accepted. memberships is org-scoped by RLS, so a member
--     receives events only for their own organizations.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memberships'
  ) then
    alter publication supabase_realtime add table public.memberships;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Let the sanctioned reschedule path through the LOT 11 column guard
--
--     restrict_appointment_self_update (20260809170000) exists to stop a
--     BARBER editing an appointment's time, customer or assignment through
--     PostgREST — it lets a non-managing caller change only status and notes.
--     That is still exactly right for direct table writes.
--
--     But triggers fire for SECURITY DEFINER functions too, so it also blocked
--     public.reschedule_appointment() when a CUSTOMER called it — which is the
--     one path where changing starts_at is the entire point, and which has
--     already done its own full authorization, availability and ownership
--     checks before reaching the UPDATE.
--
--     Found by the LOT C verification suite, not reasoned about: the customer
--     reschedule test failed with "a barber may only update status and notes".
--
--     The fix is the pattern this schema already uses twice — a
--     transaction-local flag that only a trusted DEFINER function can
--     meaningfully set (fadeup.skip_org_owner_membership in 20260813170000,
--     fadeup.org_creation_authorized in 20260818200000). Every other write
--     path is restricted exactly as before.
-- ---------------------------------------------------------------------------

create or replace function public.restrict_appointment_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Managing roles keep full edit rights untouched by this trigger.
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  -- public.reschedule_appointment() raises this for the single UPDATE it
  -- performs, after verifying the caller owns the appointment or manages the
  -- organization. current_setting(..., true) yields null when it was never
  -- set, so every ordinary path falls through to the restriction below.
  if coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on' then
    return new;
  end if;

  -- Everyone else who could reach this far already passed RLS as "the
  -- assigned barber" (appointments_update_self) — restrict them to status
  -- and notes only.
  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.chair_id is distinct from old.chair_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.buffer_before_minutes is distinct from old.buffer_before_minutes
    or new.buffer_after_minutes is distinct from old.buffer_after_minutes
  then
    raise exception 'a barber may only update status and notes on their own appointments';
  end if;

  return new;
end;
$$;

comment on function public.restrict_appointment_self_update() is
  'BEFORE UPDATE column guard. Unchanged for every direct write path: a non-managing caller may still only touch status and notes. Stands down for public.reschedule_appointment(), which sets fadeup.appointment_reschedule after doing its own ownership and authorization checks.';
