-- FadeUp — Wave 1 verification: appointment ownership + claim tokens
--
-- Regression test for the takeover vector removed in
-- 20260813150000_appointment_ownership_hardening.sql, plus proof that the
-- replacement flow actually works end to end.
--
-- THE VECTOR (must stay dead): claim_customer_records(p_phone, p_email)
-- accepted caller-supplied contact details as proof of ownership, so any
-- authenticated user could pass a stranger's email, take over that
-- stranger's unlinked public.customers row, and then read and cancel their
-- appointments through get_my_appointments/cancel_my_appointment.
--
-- Proves:
--   * the two-argument claim_customer_records no longer exists at all
--   * an anonymous booking issues a claim token, and only its hash is stored
--   * an authenticated booking is owned immediately (customer_id stamped)
--     and issues NO token
--   * a bogus token claims nothing
--   * the rightful holder redeems once and sees the appointment
--   * the same token cannot be redeemed twice, by anyone
--   * an expired token claims nothing
--   * Customer B never sees Customer A's appointment
--   * anon cannot execute redeem_appointment_claim
--   * appointment_claim_tokens is unreadable to anon AND to authenticated
--     (no RLS policies at all — SECURITY DEFINER access only)
--
-- Run with:
--   docker cp db/tests/verify_wave1_appointment_ownership.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_wave1_appointment_ownership.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'shopowner+w1own@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'customer-a+w1own@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer A"}', 'authenticated', 'authenticated'),
  ('d2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'customer-b+w1own@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer B"}', 'authenticated', 'authenticated'),
  -- Deliberately has NO customers row at the test shop: the takeover branch
  -- in section 9b is only reachable for a caller who does not already own one.
  ('d2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'attacker+w1own@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Attacker Alice"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Setup: bookable shop (all-week hours so the test never depends on which weekday it runs)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('Wave1 Ownership Shop', 'wave1-ownership-shop', 'Main', 'UTC');
insert into public.services (organization_id, name, duration_minutes, price_cents)
  select id, 'Fade', 30, 2000 from public.organizations where slug = 'wave1-ownership-shop';
update public.staff_profiles
  set location_id = (select id from public.locations where organization_id = (select id from public.organizations where slug = 'wave1-ownership-shop'))
  where organization_id = (select id from public.organizations where slug = 'wave1-ownership-shop') and user_id = (select auth.uid());
insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select sp.organization_id, sp.id, true from public.staff_profiles sp join public.organizations o on o.id = sp.organization_id
  where o.slug = 'wave1-ownership-shop' and sp.user_id = (select auth.uid());
commit;

begin;
reset role;
select id as org_id from public.organizations where slug = 'wave1-ownership-shop' \gset
select id as loc_id from public.locations where organization_id = :'org_id' \gset
select id as svc_id from public.services where organization_id = :'org_id' \gset
select id as brb_id from public.barbers where organization_id = :'org_id' \gset

insert into public.service_locations (organization_id, service_id, location_id)
  values (:'org_id'::uuid, :'svc_id'::uuid, :'loc_id'::uuid) on conflict do nothing;
insert into public.barber_services (organization_id, barber_id, service_id)
  values (:'org_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid) on conflict do nothing;
insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
  select :'org_id'::uuid, :'loc_id'::uuid, d, '00:00', '23:59' from generate_series(0, 6) d on conflict do nothing;
insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time)
  select :'org_id'::uuid, :'brb_id'::uuid, d, '00:00', '23:59' from generate_series(0, 6) d on conflict do nothing;
commit;

\echo '=========================================================='
\echo '2. The unsafe claim_customer_records(text, text) is GONE'
\echo '=========================================================='
begin;
reset role;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_customer_records';
  if v_count <> 0 then
    raise exception 'FAIL: claim_customer_records still exists (% overload(s)) — the caller-asserted-identity takeover vector is back', v_count;
  end if;
  raise notice 'PASS: claim_customer_records no longer exists in any form';
end $$;
commit;

\echo '=========================================================='
\echo '3. Anonymous booking issues a claim token; only the hash is stored'
\echo '=========================================================='
begin;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select id as anon_appt_id, claim_token as anon_token
  from public.book_public_appointment(
    'wave1-ownership-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
    now() + interval '2 days', 'Customer A', '+15552220001', 'customer-a+w1own@fadeup.test', null
  ) \gset
commit;

begin;
reset role;
select set_config('test.anon_token', :'anon_token', false);
select set_config('test.anon_appt_id', :'anon_appt_id', false);
do $$
declare
  v_token text := current_setting('test.anon_token');
  v_appt_id uuid := current_setting('test.anon_appt_id')::uuid;
  v_count integer;
  v_customer_id uuid;
begin
  if v_token is null or length(v_token) < 32 then
    raise exception 'FAIL: anonymous booking did not return a usable claim token';
  end if;
  raise notice 'PASS: anonymous booking returned a high-entropy claim token';

  -- The raw token must never be findable anywhere in the table.
  select count(*) into v_count from public.appointment_claim_tokens where token_hash = v_token;
  if v_count <> 0 then
    raise exception 'FAIL: the RAW claim token was persisted';
  end if;
  select count(*) into v_count from public.appointment_claim_tokens
    where appointment_id = v_appt_id
      and token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly one sha256-hashed token row, got %', v_count;
  end if;
  raise notice 'PASS: only the sha256 hash of the claim token is stored';

  -- The pre-existing appointments_link_customer trigger points the booking
  -- at a CRM row built from its contact info; what matters for ownership is
  -- that no ACCOUNT is attached to that row yet.
  select a.customer_id into v_customer_id from public.appointments a where a.id = v_appt_id;
  if v_customer_id is null then
    raise exception 'FAIL: expected the LOT 12 trigger to link a customers row';
  end if;
  if exists (select 1 from public.customers c where c.id = v_customer_id and c.user_id is not null) then
    raise exception 'FAIL: an anonymous booking was pre-attached to an account';
  end if;
  raise notice 'PASS: anonymous booking is linked to a CRM row owned by no account';
end $$;
commit;

\echo '=========================================================='
\echo '4. A bogus token claims nothing (and is not an existence oracle)'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_claimed boolean;
begin
  select claimed into v_claimed from public.redeem_appointment_claim('deadbeef' || repeat('0', 56));
  if v_claimed then
    raise exception 'FAIL: a made-up token claimed an appointment';
  end if;
  raise notice 'PASS: a made-up token claims nothing';

  select claimed into v_claimed from public.redeem_appointment_claim('');
  if v_claimed then
    raise exception 'FAIL: an empty token claimed an appointment';
  end if;
  raise notice 'PASS: an empty token claims nothing';
end $$;
commit;

\echo '=========================================================='
\echo '5. The rightful holder redeems once; the appointment becomes theirs'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_claimed boolean;
  v_org text;
  v_count integer;
begin
  select claimed, organization_name into v_claimed, v_org
    from public.redeem_appointment_claim(current_setting('test.anon_token'));
  if not v_claimed then
    raise exception 'FAIL: the rightful token holder could not claim their own booking';
  end if;
  if v_org <> 'Wave1 Ownership Shop' then
    raise exception 'FAIL: redeem returned the wrong organization: %', v_org;
  end if;
  raise notice 'PASS: the token holder claimed their own anonymous booking';

  select count(*) into v_count from public.get_my_appointments()
    where id = current_setting('test.anon_appt_id')::uuid;
  if v_count <> 1 then
    raise exception 'FAIL: claimed appointment does not appear in get_my_appointments (got %)', v_count;
  end if;
  raise notice 'PASS: the claimed appointment now appears in the customer app';
end $$;
commit;

\echo '=========================================================='
\echo '6. Single use: the same token cannot be redeemed again, by anyone'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_claimed boolean;
  v_count integer;
begin
  select claimed into v_claimed from public.redeem_appointment_claim(current_setting('test.anon_token'));
  if v_claimed then
    raise exception 'FAIL: Customer B re-redeemed an already-spent token and stole the appointment';
  end if;
  raise notice 'PASS: a spent token cannot be redeemed a second time';

  select count(*) into v_count from public.get_my_appointments()
    where id = current_setting('test.anon_appt_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL: Customer B can see Customer A''s appointment';
  end if;
  raise notice 'PASS: Customer B cannot see Customer A''s claimed appointment';
end $$;
commit;

\echo '=========================================================='
\echo '7. An expired token claims nothing'
\echo '=========================================================='
begin;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select claim_token as expiring_token
  from public.book_public_appointment(
    'wave1-ownership-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
    now() + interval '3 days', 'Customer C', '+15552220003', null, null
  ) \gset
commit;

begin;
reset role;
select set_config('test.expiring_token', :'expiring_token', false);
-- Age the row realistically rather than weakening the
-- appointment_claim_tokens_expires_future CHECK, which correctly applies to
-- UPDATEs too: backdate created_at and expires_at together, exactly as a
-- genuinely stale token would look.
update public.appointment_claim_tokens
  set created_at = now() - interval '10 days', expires_at = now() - interval '7 days'
  where token_hash = encode(extensions.digest(current_setting('test.expiring_token'), 'sha256'), 'hex');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_claimed boolean;
begin
  select claimed into v_claimed from public.redeem_appointment_claim(current_setting('test.expiring_token'));
  if v_claimed then
    raise exception 'FAIL: an expired claim token still worked';
  end if;
  raise notice 'PASS: an expired claim token claims nothing';
end $$;
commit;

\echo '=========================================================='
\echo '8. An authenticated booking is owned immediately, with no token issued'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select id as authed_appt_id, coalesce(claim_token, '') as authed_token
  from public.book_public_appointment(
    'wave1-ownership-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
    now() + interval '4 days', 'Customer B', '+15552220002', 'customer-b+w1own@fadeup.test', null
  ) \gset
commit;

begin;
reset role;
select set_config('test.authed_appt_id', :'authed_appt_id', false);
select set_config('test.authed_token', :'authed_token', false);
do $$
declare
  v_appt_id uuid := current_setting('test.authed_appt_id')::uuid;
  v_customer_id uuid;
  v_owner uuid;
  v_count integer;
begin
  if current_setting('test.authed_token') <> '' then
    raise exception 'FAIL: an authenticated booking issued a claim token it does not need';
  end if;
  raise notice 'PASS: an authenticated booking issues no claim token';

  select count(*) into v_count from public.appointment_claim_tokens where appointment_id = v_appt_id;
  if v_count <> 0 then
    raise exception 'FAIL: a token row was created for an authenticated booking';
  end if;

  select a.customer_id into v_customer_id from public.appointments a where a.id = v_appt_id;
  if v_customer_id is null then
    raise exception 'FAIL: an authenticated booking was not linked to a customer record';
  end if;
  select c.user_id into v_owner from public.customers c where c.id = v_customer_id;
  if v_owner <> 'd2000000-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAIL: the authenticated booking was linked to the wrong account (%)', v_owner;
  end if;
  raise notice 'PASS: an authenticated booking is owned by the booker from the moment it exists';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.get_my_appointments()
    where id = current_setting('test.authed_appt_id')::uuid;
  if v_count <> 1 then
    raise exception 'FAIL: a signed-in booking did not appear in the booker''s own appointments (got %)', v_count;
  end if;
  raise notice 'PASS: booking while signed in appears in My Appointments with no claim step at all';
end $$;
commit;

\echo '=========================================================='
\echo '8b. A signed-in booking is still owned when the phone already exists on another row'
\echo '=========================================================='
-- Regression test for the second defect fixed in 20260813160000: when the
-- caller's phone/email already sat on a DIFFERENT unlinked customers row
-- (the ordinary case — the shop had already typed them into its CRM), the
-- insert in resolve_customer_for_user hit customers_org_phone_unique,
-- returned null, and the booking was silently orphaned with no claim token
-- to recover it. The customer saw a success screen for an appointment that
-- never showed up in their app.
begin;
reset role;
insert into public.customers (organization_id, name, phone)
  values (:'org_id'::uuid, 'Marc (added by staff)', '+15558880001');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select id as collide_appt_id
  from public.book_public_appointment(
    'wave1-ownership-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
    now() + interval '5 days', 'Marc', '+15558880001', null, null
  ) \gset
commit;

begin;
reset role;
select set_config('test.collide_appt_id', :'collide_appt_id', false);
do $$
declare
  v_customer_id uuid;
  v_owner uuid;
begin
  select a.customer_id into v_customer_id from public.appointments a
    where a.id = current_setting('test.collide_appt_id')::uuid;
  if v_customer_id is null then
    raise exception 'FAIL: signed-in booking was orphaned (customer_id is null)';
  end if;
  select c.user_id into v_owner from public.customers c where c.id = v_customer_id;
  if v_owner is distinct from 'd2000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'FAIL: signed-in booking attached to a row owned by % instead of the booker', v_owner;
  end if;
  raise notice 'PASS: signed-in booking is owned even when the phone collides with an existing row';

  -- and the staff-entered row must NOT have been taken over
  if exists (select 1 from public.customers c where c.phone = '+15558880001' and c.user_id is not null) then
    raise exception 'FAIL: the pre-existing staff-entered CRM row was claimed';
  end if;
  raise notice 'PASS: the pre-existing staff-entered row was left alone';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.get_my_appointments()
    where id = current_setting('test.collide_appt_id')::uuid;
  if v_count <> 1 then
    raise exception 'FAIL: the booking the customer just made is not in their appointments (got %)', v_count;
  end if;
  raise notice 'PASS: the colliding signed-in booking appears in My Appointments';
end $$;
commit;

\echo '=========================================================='
\echo '9. appointment_claim_tokens is opaque to anon AND to authenticated'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  -- RLS is enabled+forced with no policies at all: reads silently return
  -- zero rows rather than raising. Either outcome is acceptable; a non-zero
  -- count is not.
  begin
    select count(*) into v_count from public.appointment_claim_tokens;
    if v_count > 0 then
      raise exception 'FAIL: an authenticated user read % claim token row(s)', v_count;
    end if;
    raise notice 'PASS: authenticated sees zero rows of appointment_claim_tokens';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated has no privilege on appointment_claim_tokens';
  end;
end $$;
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.appointment_claim_tokens;
    if v_count > 0 then
      raise exception 'FAIL: anon read % claim token row(s)', v_count;
    end if;
    raise notice 'PASS: anon sees zero rows of appointment_claim_tokens';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege on appointment_claim_tokens';
  end;

  begin
    perform public.redeem_appointment_claim(current_setting('test.anon_token'));
    raise exception 'FAIL: anon executed redeem_appointment_claim';
  exception
    when insufficient_privilege then raise notice 'PASS: anon has no privilege to execute redeem_appointment_claim';
    when others then
      if sqlerrm like '%requires an authenticated session%' then
        raise notice 'PASS: redeem_appointment_claim refuses an anonymous caller';
      else
        raise;
      end if;
  end;
end $$;
commit;

\echo '=========================================================='
\echo '9b. TAKEOVER: booking with someone ELSE''s phone must not hand over their record'
\echo '=========================================================='
-- Regression test for the defect found in adversarial review and fixed in
-- 20260813160000_claim_scope_fix.sql.
--
-- The appointments_link_customer trigger (LOT 12) attaches a booking to an
-- EXISTING customers row whenever the typed phone/email matches one. So an
-- attacker can book anonymously using a victim's phone, receive a claim
-- token for their own booking, and — if redemption adopted that row — walk
-- off with every appointment the victim ever had at that shop.
begin;
reset role;
-- Victim: an unlinked CRM row plus a past appointment, exactly what a
-- pre-Wave-1 customer or a staff-entered contact looks like.
insert into public.customers (organization_id, name, phone, notes)
  values (:'org_id'::uuid, 'Victim Vera', '+15559990001', 'INTERNAL: always tips well')
  returning id as victim_customer_id \gset
insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_phone, starts_at, ends_at, status)
  values (:'org_id'::uuid, :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid, :'victim_customer_id'::uuid, 'Victim Vera', '+15559990001', now() + interval '6 days', now() + interval '6 days' + interval '30 minutes', 'confirmed')
  returning id as victim_appt_id \gset
select set_config('test.victim_customer_id', :'victim_customer_id', false);
select set_config('test.victim_appt_id', :'victim_appt_id', false);
commit;

-- Attacker books anonymously, typing the victim's phone number.
begin;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select claim_token as attack_token
  from public.book_public_appointment(
    'wave1-ownership-shop', :'loc_id'::uuid, :'brb_id'::uuid, :'svc_id'::uuid,
    now() + interval '7 days', 'Attacker Alice', '+15559990001', null, null
  ) \gset
commit;

begin;
reset role;
select set_config('test.attack_token', :'attack_token', false);
do $$
declare
  v_linked uuid;
begin
  -- Sanity: confirm the trigger really did attach the attacker's booking to
  -- the victim's row. If this stops being true the test below is vacuous.
  select a.customer_id into v_linked from public.appointments a
    where a.customer_name = 'Attacker Alice';
  if v_linked is distinct from current_setting('test.victim_customer_id')::uuid then
    raise exception 'SETUP: expected the trigger to attach the attacker booking to the victim CRM row';
  end if;
  raise notice 'SETUP: attacker booking landed on the victim''s CRM row (as the trigger intends)';
end $$;
commit;

-- Attacker redeems their own token.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'd2000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
select claimed as attack_claimed from public.redeem_appointment_claim(current_setting('test.attack_token')) \gset
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.get_my_appointments()
    where id = current_setting('test.victim_appt_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL: TAKEOVER — attacker reads the victim''s appointment after redeeming a token for their own booking';
  end if;
  raise notice 'PASS: attacker cannot read the victim''s appointments';
end $$;
commit;

begin;
reset role;
do $$
declare
  v_owner uuid;
begin
  select c.user_id into v_owner from public.customers c
    where c.id = current_setting('test.victim_customer_id')::uuid;
  if v_owner is not null then
    raise exception 'FAIL: TAKEOVER — the victim''s CRM row was handed to account %', v_owner;
  end if;
  raise notice 'PASS: the victim''s CRM row is still owned by nobody';
end $$;
commit;

\echo '=========================================================='
\echo '10. Cleanup'
\echo '=========================================================='
begin;
reset role;
delete from public.appointments where customer_name in ('Victim Vera', 'Attacker Alice');
delete from public.customers where phone in ('+15559990001', '+15558880001');
delete from public.organizations where slug = 'wave1-ownership-shop';
delete from auth.users where id in ('d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000004');
commit;

begin;
reset role;
select count(*) as remaining_orgs from public.organizations where slug = 'wave1-ownership-shop';
select count(*) as remaining_tokens from public.appointment_claim_tokens
  where appointment_id in (select id from public.appointments where organization_id in (select id from public.organizations where slug = 'wave1-ownership-shop'));
select count(*) as remaining_users from auth.users where id in ('d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000003');
commit;
