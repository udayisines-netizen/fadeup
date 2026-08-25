-- FadeUp — R1A: an anonymous booking may never adopt an owned customer record
--
-- THE VECTOR THIS CLOSES (reproduced end-to-end before this migration)
--
-- 1. Attacker signs up and books at shop S, typing the VICTIM's phone number.
--    private.resolve_customer_for_user creates a customers row owned by the
--    attacker (user_id = attacker) carrying the victim's contact details.
--    Nothing verifies that the attacker owns that phone number.
-- 2. The victim later books ANONYMOUSLY at S with their own phone.
--    link_customer_from_contact_info() matches on (organization_id, phone)
--    and attaches the victim's appointment to the ATTACKER's customer row.
-- 3. get_my_appointments() resolves through customers.user_id, so the attacker
--    reads the victim's booking — shop, barber, service, time, price — and
--    cancel_my_appointment() cancels it.
--
-- The queue variant is cheaper still: join_public_queue needs no slot, no
-- service and no barber, and get_my_queue_status then leaks the victim's live
-- queue position to the attacker.
--
-- 20260813160000_claim_scope_fix.sql closed the ADOPTION direction — a
-- signed-in attacker taking over an existing unlinked row. It never closed the
-- PRIMING direction, where the attacker plants the contact details first on a
-- row they legitimately own.
--
-- WHY ALL FOUR LOOKUPS
--
-- The function does phone-then-email, and then, if its `insert ... on conflict
-- do nothing` yields no row, repeats phone-then-email as a fallback. Filtering
-- only the first two is useless: the insert collides with
-- customers_org_phone_unique, returns nothing, and the UNFILTERED fallback
-- lands straight back on the attacker's row. There are exactly four SELECT
-- paths and all four are filtered here.
--
-- WHAT HAPPENS INSTEAD
--
-- If the only contact match is a row already owned by an account, the booking
-- or queue entry is left with customer_id NULL — safely unlinked. For an
-- anonymous appointment, book_public_appointment then issues the single-use
-- 72h claim token, and redeem_appointment_claim re-points that one appointment
-- at a CRM row the redeemer owns. That path exists precisely for this.
--
-- UX TRADE-OFF, STATED PLAINLY
--
-- A customer who already has an account but books ANONYMOUSLY with their own
-- phone is no longer auto-linked, and must redeem the claim token to see the
-- booking in their account. That is a real cost. It is the correct trade: the
-- alternative is leaving a live takeover primitive under every future feature.
-- Signed-in bookings are unaffected — book_public_appointment and
-- join_public_queue set customer_id via resolve_customer_for_user before the
-- trigger runs, and the trigger returns early when customer_id is non-null.
--
-- NOT CHANGED: waitlist. An earlier draft claimed this vector reached
-- waitlist_entries. Independent review disproved it — waitlist_entries_insert
-- requires has_org_role(owner/manager/receptionist), there is no anon policy
-- and no public RPC, so no customer or anonymous visitor can reach this
-- trigger through waitlist. The trigger still fires there for staff-created
-- rows, and the same filter applies, but no behaviour a customer can reach
-- changes.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

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
        and user_id is null
      limit 1;
  end if;

  if v_customer_id is null and v_customer_email is not null then
    select id into v_customer_id from public.customers
      where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
        and user_id is null
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
          where organization_id = new.organization_id and phone = v_customer_phone
            and user_id is null limit 1;
      end if;
      if v_customer_id is null and v_customer_email is not null then
        select id into v_customer_id from public.customers
          where organization_id = new.organization_id and lower(email) = lower(v_customer_email)
            and user_id is null limit 1;
      end if;
    end if;
  end if;

  new.customer_id := v_customer_id;
  return new;
end;
$$;


