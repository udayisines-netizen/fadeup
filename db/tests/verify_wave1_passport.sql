-- FadeUp — Wave 1 verification: Fade Passport
--
-- Proves the strategic security properties of the Passport: strict customer
-- ownership (A cannot read/edit B's), share links are read-only,
-- time-limited, revocable and hash-verified (raw token never stored), an
-- expired or revoked share stops working and reports a useful status, the
-- shared view exposes only curated fields (never phone/email/photos), and
-- anon has zero direct access to any passport table.
--
-- Run with:
--   docker cp db/tests/verify_wave1_passport.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_wave1_passport.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'customer-a+w1pp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer A"}', 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'customer-b+w1pp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Customer B"}', 'authenticated', 'authenticated');
commit;

\echo '=========================================================='
\echo '1. Customer A creates their profile + Passport'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
insert into public.customer_profiles (user_id, display_name, phone, email)
  values ((select auth.uid()), 'Customer A', '+15559990001', 'a+w1pp@example.com');
insert into public.customer_passports (user_id, usual_haircut, fade_type, side_length, top_length, beard_preferences, preferences_notes)
  values ((select auth.uid()), 'Mid fade', 'mid', '1', '4 on top', 'Keep the beard short', 'Please go easy on the neckline');
commit;

\echo '=========================================================='
\echo '2. Customer B cannot read or edit Customer A''s Passport'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
  v_updated integer;
begin
  select count(*) into v_count from public.customer_passports;
  if v_count <> 0 then
    raise exception 'FAIL: Customer B saw % Passport row(s) belonging to someone else', v_count;
  end if;

  update public.customer_passports set usual_haircut = 'Hijacked';
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'FAIL: Customer B updated % Passport row(s) belonging to someone else', v_updated;
  end if;

  raise notice 'PASS: Customer B can neither read nor edit Customer A''s Passport';
end $$;
commit;

\echo '=========================================================='
\echo '3. Customer A creates a share; the raw token is never persisted'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select share_id as share_id, token as share_token from public.create_passport_share('Test share', 24) \gset
commit;

begin;
reset role;
select set_config('test.share_token', :'share_token', false);
select set_config('test.share_id', :'share_id', false);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.customer_passport_shares where token_hash = current_setting('test.share_token');
  if v_count <> 0 then
    raise exception 'FAIL: the RAW token was stored in token_hash';
  end if;

  select count(*) into v_count from public.customer_passport_shares
  where token_hash = encode(extensions.digest(current_setting('test.share_token'), 'sha256'), 'hex');
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 share row matching the sha256 hash, got %', v_count;
  end if;

  raise notice 'PASS: only the sha256 hash is persisted, never the raw token';
end $$;
commit;

\echo '=========================================================='
\echo '4. anon can read the shared Passport (curated fields only) while valid'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_status text;
  v_haircut text;
  v_name text;
begin
  select status, usual_haircut, display_name into v_status, v_haircut, v_name
  from public.get_shared_passport(current_setting('test.share_token'));

  if v_status <> 'active' then
    raise exception 'FAIL: expected status active, got %', v_status;
  end if;
  if v_haircut <> 'Mid fade' then
    raise exception 'FAIL: expected the real Passport data, got %', v_haircut;
  end if;
  if v_name <> 'Customer A' then
    raise exception 'FAIL: expected the customer display name, got %', v_name;
  end if;

  raise notice 'PASS: a valid share returns status=active plus curated Passport fields';
end $$;
commit;

\echo '=========================================================='
\echo '5. The shared view is READ-ONLY and leaks no contact/internal data'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_result text;
begin
  -- Prove by the function's own signature that no phone/email/photo column
  -- can ever come back through the share surface, regardless of caller.
  select pg_get_function_result(p.oid) into v_result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_shared_passport';

  if position('phone' in lower(v_result)) > 0 or position('email' in lower(v_result)) > 0 then
    raise exception 'FAIL: get_shared_passport can return contact data: %', v_result;
  end if;
  if position('photo' in lower(v_result)) > 0 then
    raise exception 'FAIL: get_shared_passport can return photo data: %', v_result;
  end if;

  raise notice 'PASS: the share surface structurally cannot return phone/email/photo data';
end $$;

do $$
declare
  v_count integer;
begin
  -- A share viewer is anon; anon has no write path to any passport table.
  begin
    update public.customer_passports set usual_haircut = 'Hijacked by share viewer';
    get diagnostics v_count = row_count;
    if v_count <> 0 then
      raise exception 'FAIL: an anon share viewer modified % Passport row(s)', v_count;
    end if;
    raise notice 'PASS: an anon share viewer cannot modify the Passport (read-only)';
  exception when insufficient_privilege then
    raise notice 'PASS: an anon share viewer has no privilege to modify the Passport';
  end;
end $$;
commit;

\echo '=========================================================='
\echo '6. A revoked share stops working, with a useful status'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select public.revoke_passport_share(current_setting('test.share_id')::uuid);
commit;

begin;
set local role anon;
do $$
declare
  v_status text;
  v_haircut text;
begin
  select status, usual_haircut into v_status, v_haircut from public.get_shared_passport(current_setting('test.share_token'));
  if v_status <> 'revoked' then
    raise exception 'FAIL: expected status revoked, got %', v_status;
  end if;
  if v_haircut is not null then
    raise exception 'FAIL: a revoked share still returned Passport data';
  end if;
  raise notice 'PASS: a revoked share returns status=revoked and zero Passport data';
end $$;
commit;

\echo '=========================================================='
\echo '7. An expired share stops working, with a useful status'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select share_id as share2_id, token as share2_token from public.create_passport_share('Expiring share', 1) \gset
commit;

begin;
reset role;
select set_config('test.share2_token', :'share2_token', false);
-- Age the share realistically rather than weakening the
-- expires_at > created_at constraint (which correctly applies to UPDATEs
-- too): backdate both timestamps so this looks like a share created two
-- days ago with a 1-hour TTL — i.e. genuinely expired by the passage of
-- time, which is the only way a share expires in production.
update public.customer_passport_shares
set created_at = now() - interval '2 days', expires_at = now() - interval '47 hours'
where id = :'share2_id';
commit;

begin;
set local role anon;
do $$
declare
  v_status text;
  v_haircut text;
begin
  select status, usual_haircut into v_status, v_haircut from public.get_shared_passport(current_setting('test.share2_token'));
  if v_status <> 'expired' then
    raise exception 'FAIL: expected status expired, got %', v_status;
  end if;
  if v_haircut is not null then
    raise exception 'FAIL: an expired share still returned Passport data';
  end if;
  raise notice 'PASS: an expired share returns status=expired and zero Passport data';
end $$;

do $$
declare
  v_status text;
begin
  select status into v_status from public.get_shared_passport('completely-made-up-token');
  if v_status <> 'not_found' then
    raise exception 'FAIL: expected status not_found for a bogus token, got %', v_status;
  end if;
  raise notice 'PASS: an unknown token returns status=not_found';
end $$;
commit;

\echo '=========================================================='
\echo '8. Customer B cannot revoke Customer A''s share'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  perform public.revoke_passport_share(current_setting('test.share_id')::uuid);
  raise exception 'FAIL: Customer B revoked Customer A''s share';
exception when others then
  if position('FAIL:' in sqlerrm) > 0 then raise; end if;
  raise notice 'PASS: Customer B cannot revoke Customer A''s share';
end $$;
commit;

\echo '=========================================================='
\echo '9. anon has zero direct access to every passport table'
\echo '=========================================================='
begin;
set local role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.customer_passports;
  if v_count > 0 then raise exception 'FAIL: anon saw % customer_passports row(s)', v_count; end if;

  select count(*) into v_count from public.customer_passport_photos;
  if v_count > 0 then raise exception 'FAIL: anon saw % customer_passport_photos row(s)', v_count; end if;

  select count(*) into v_count from public.customer_passport_shares;
  if v_count > 0 then raise exception 'FAIL: anon saw % customer_passport_shares row(s)', v_count; end if;

  raise notice 'PASS: anon sees zero rows across all three passport tables';

  begin
    perform public.create_passport_share('nope', 24);
    raise exception 'FAIL: anon created a share';
  exception when insufficient_privilege then
    raise notice 'PASS: anon has no privilege to execute create_passport_share';
  end;
end $$;
commit;

\echo '=========================================================='
\echo '10. Storage: the passport-photos bucket is private with per-user policies'
\echo '=========================================================='
begin;
reset role;
do $$
declare
  v_public boolean;
  v_policies integer;
begin
  select public into v_public from storage.buckets where id = 'passport-photos';
  if v_public is null then
    raise exception 'FAIL: the passport-photos bucket does not exist';
  end if;
  if v_public then
    raise exception 'FAIL: the passport-photos bucket is PUBLIC — customer photos must not be world-readable';
  end if;

  select count(*) into v_policies from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'passport_photos_%';
  if v_policies <> 3 then
    raise exception 'FAIL: expected 3 passport_photos storage policies (select/insert/delete), found %', v_policies;
  end if;

  raise notice 'PASS: passport-photos is a private bucket with 3 per-user storage policies';
end $$;
commit;

\echo '=========================================================='
\echo '11. Cleanup'
\echo '=========================================================='
begin;
reset role;
delete from public.customer_passport_shares where user_id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
delete from public.customer_passports where user_id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
delete from public.customer_profiles where user_id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
delete from auth.users where id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
commit;

begin;
reset role;
select count(*) as remaining_passports from public.customer_passports where user_id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
select count(*) as remaining_shares from public.customer_passport_shares where user_id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
select count(*) as remaining_users from auth.users where id in ('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002');
commit;
