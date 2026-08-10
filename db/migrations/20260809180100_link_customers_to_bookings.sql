-- FadeUp — LOT 12: customer CRM
-- Migration: link customers to appointments/queue_entries
--
-- Adds a nullable customer_id to both booking tables and a BEFORE INSERT
-- trigger that auto-links (find-or-create, matched by phone then email) a
-- customers row — without requiring every existing insert path
-- (book_public_appointment, join_public_queue, the staff booking dialog's
-- plain insert) to change at all. This is deliberately non-invasive: LOT
-- 8/9/10's already-shipped, already-tested insert code keeps working
-- completely unmodified; customer_id simply gets populated automatically.
--
-- Idempotent: safe to re-run.

alter table public.appointments add column if not exists customer_id uuid references public.customers (id) on delete set null;
alter table public.queue_entries add column if not exists customer_id uuid references public.customers (id) on delete set null;

create index if not exists appointments_customer_id_idx on public.appointments (customer_id) where customer_id is not null;
create index if not exists queue_entries_customer_id_idx on public.queue_entries (customer_id) where customer_id is not null;

comment on column public.appointments.customer_id is
  'Auto-linked by link_customer_from_contact_info (find-or-create by phone/email) at insert time. Nullable: a booking with neither phone nor email stays unlinked.';
comment on column public.queue_entries.customer_id is
  'Auto-linked by link_customer_from_contact_info (find-or-create by phone/email) at insert time. Nullable: a walk-in with no phone stays unlinked.';

-- link_customer_from_contact_info --------------------------------------------
-- SECURITY DEFINER so customer auto-linking works regardless of whether the
-- specific role that can INSERT into appointments/queue_entries also has
-- direct customers INSERT rights — today those role sets are identical
-- (owner/manager/receptionist for both), but decoupling this now avoids a
-- silent landmine if that ever changes. If the caller explicitly supplied a
-- customer_id (a future CRM UI linking a booking to an existing customer
-- directly), it is validated against organization_id instead of being
-- overwritten — the auto-link path only fires when customer_id is null.
create or replace function public.link_customer_from_contact_info()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  -- This trigger is shared across appointments (which has customer_email)
  -- and queue_entries (which does not — walk-ins are phone-only). new.<col>
  -- is resolved against the row type of whichever table fired the trigger,
  -- so a bare `new.customer_email` reference throws "record new has no
  -- field customer_email" the moment this fires on queue_entries. Going
  -- through to_jsonb(new) sidesteps that: a missing key just yields NULL.
  v_customer_phone text := (to_jsonb(new) ->> 'customer_phone');
  v_customer_email text := (to_jsonb(new) ->> 'customer_email');
begin
  if new.customer_id is not null then
    if not exists (
      select 1 from public.customers c
      where c.id = new.customer_id and c.organization_id = new.organization_id
    ) then
      raise exception 'customer_id must belong to the same organization_id';
    end if;
    return new;
  end if;

  if v_customer_phone is null and v_customer_email is null then
    return new;
  end if;

  if v_customer_phone is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and phone = v_customer_phone
      limit 1;
  end if;

  if v_customer_id is null and v_customer_email is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
      limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (organization_id, name, phone, email)
    values (new.organization_id, new.customer_name, v_customer_phone, v_customer_email)
    on conflict do nothing
    returning id into v_customer_id;

    -- A concurrent booking may have won the customers_org_phone_unique /
    -- customers_org_email_unique race between our SELECT and INSERT above
    -- (ON CONFLICT DO NOTHING then returns no row) — re-select rather than
    -- leave this booking unlinked over a benign, expected race.
    if v_customer_id is null then
      if v_customer_phone is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and phone = v_customer_phone limit 1;
      end if;
      if v_customer_id is null and v_customer_email is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and lower(email) = lower(v_customer_email) limit 1;
      end if;
    end if;
  end if;

  new.customer_id := v_customer_id;
  return new;
end;
$$;

comment on function public.link_customer_from_contact_info() is
  'BEFORE INSERT trigger: find-or-create a customers row matched by phone then email, and set customer_id. Only fires when customer_id is null; validates an explicitly-supplied customer_id belongs to the same org instead. INSERT-only, not a general resync — a later contact-info edit does not retroactively relink.';

drop trigger if exists appointments_link_customer on public.appointments;
create trigger appointments_link_customer
  before insert on public.appointments
  for each row execute function public.link_customer_from_contact_info();

drop trigger if exists queue_entries_link_customer on public.queue_entries;
create trigger queue_entries_link_customer
  before insert on public.queue_entries
  for each row execute function public.link_customer_from_contact_info();
