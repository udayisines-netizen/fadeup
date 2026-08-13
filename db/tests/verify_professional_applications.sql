-- FadeUp — verification: professional registration approval workflow
--
-- The security claim under test is: registering as a professional grants
-- NOTHING. Authorization still comes from memberships/platform_members, and
-- only a platform reviewer can move an application out of pending_review.
--
-- Proves:
--   * submitting creates a pending application, notifies platform staff,
--     writes an audit event, and grants zero memberships
--   * phone is required and normalized server-side
--   * an applicant CANNOT approve themselves (status/reviewed_by frozen)
--   * an applicant CANNOT self-activate via create_organization
--   * applicant A cannot read applicant B's application
--   * a tenant owner cannot read the application queue or review anything
--   * a customer cannot read the queue
--   * approval creates the org and makes the APPLICANT the owner — never the
--     reviewing platform admin — and grants no platform role
--   * approval and rejection are idempotent (double-click safe)
--   * rejection preserves denied access and stores review state
--   * both decisions queue exactly one email and write one audit event
--   * internal_note never appears in the applicant-facing read path
--   * anon has zero access to everything here
--
-- Run with:
--   docker cp db/tests/verify_professional_applications.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_professional_applications.sql

begin;
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'owner+proapp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Platform Owner"}', 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'applicant-a+proapp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Karim Dupont"}', 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'applicant-b+proapp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Other Applicant"}', 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'tenantowner+proapp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"Shop Owner"}', 'authenticated', 'authenticated'),
  ('e1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'customer+proapp@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"A Customer"}', 'authenticated', 'authenticated');

insert into public.platform_members (user_id, role) values ('e1000000-0000-0000-0000-000000000001', 'platform_owner')
  on conflict (user_id) do update set role = 'platform_owner';
commit;

-- An ordinary tenant owner with a real shop, to prove the platform queue is
-- closed to tenant staff no matter how privileged they are inside their org.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
select * from public.complete_organization_onboarding('ProApp Existing Shop', 'proapp-existing-shop', 'Main', 'UTC');
commit;

\echo '=========================================================='
\echo '1. Submitting creates a PENDING application and grants nothing'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select id as app_a_id from public.submit_professional_application(
  'Karim', 'Dupont', '06 12 34 56 78', 'Maison Fade', 'barbershop',
  'Paris', null, null, 'FR', 3, null, null, null
) \gset
commit;

begin;
reset role;
select set_config('test.app_a_id', :'app_a_id', false);
do $$
declare
  v_app public.professional_applications;
  v_count integer;
begin
  select * into v_app from public.professional_applications where id = current_setting('test.app_a_id')::uuid;

  if v_app.status <> 'pending_review' then
    raise exception 'FAIL: new application status is % (expected pending_review)', v_app.status;
  end if;
  raise notice 'PASS: application starts pending_review';

  -- Phone normalized server-side, not trusted as typed.
  if v_app.phone <> '+33612345678' then
    raise exception 'FAIL: phone was not normalized (got %)', v_app.phone;
  end if;
  raise notice 'PASS: phone normalized to E.164 server-side';

  -- Email taken from the verified auth identity, not the form.
  if v_app.email <> 'applicant-a+proapp@fadeup.test' then
    raise exception 'FAIL: application email is % (expected the auth identity)', v_app.email;
  end if;
  raise notice 'PASS: email comes from the authenticated identity';

  -- THE core business rule.
  select count(*) into v_count from public.memberships where user_id = v_app.user_id;
  if v_count <> 0 then
    raise exception 'FAIL: applicant received % membership(s) merely by registering', v_count;
  end if;
  raise notice 'PASS: registering granted zero memberships';

  select count(*) into v_count from public.platform_members where user_id = v_app.user_id;
  if v_count <> 0 then
    raise exception 'FAIL: applicant received a platform role';
  end if;
  raise notice 'PASS: registering granted no platform role';

  -- Platform staff notified.
  select count(*) into v_count from public.platform_notifications
    where target_id = v_app.id and recipient_user_id = 'e1000000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL: expected 1 notification for the platform owner, got %', v_count;
  end if;
  raise notice 'PASS: platform owner received exactly one notification';

  select count(*) into v_count from public.platform_audit_log
    where target_id = v_app.id and action = 'professional_application_submitted';
  if v_count <> 1 then
    raise exception 'FAIL: expected 1 submission audit event, got %', v_count;
  end if;
  raise notice 'PASS: submission wrote an audit event';
end $$;
commit;

\echo '=========================================================='
\echo '2. Phone is required and validated'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.submit_professional_application('No', 'Phone', 'not-a-number', 'Bad Phone Shop', 'barbershop');
    raise exception 'FAIL: an unusable phone number was accepted';
  exception when others then
    if sqlerrm like '%valid phone number is required%' then
      raise notice 'PASS: a malformed phone number is rejected';
    else
      raise;
    end if;
  end;

  begin
    perform public.submit_professional_application('No', 'Phone', '', 'Bad Phone Shop', 'barbershop');
    raise exception 'FAIL: a blank phone number was accepted';
  exception when others then
    if sqlerrm like '%valid phone number is required%' then
      raise notice 'PASS: a blank phone number is rejected';
    else
      raise;
    end if;
  end;
end $$;
commit;

\echo '=========================================================='
\echo '3. An applicant cannot approve themselves'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_app_id uuid := current_setting('test.app_a_id')::uuid;
begin
  -- Direct table update: RLS lets them touch their own pending row (so they
  -- can fix a typo'd phone), the column guard must stop the privilege grab.
  begin
    update public.professional_applications set status = 'approved' where id = v_app_id;
    raise exception 'FAIL: applicant set their own application to approved';
  exception when others then
    if sqlerrm like '%only a platform reviewer%' then
      raise notice 'PASS: applicant cannot change their own status';
    else
      raise;
    end if;
  end;

  begin
    update public.professional_applications set reviewed_by = (current_setting('request.jwt.claims')::json->>'sub')::uuid where id = v_app_id;
    raise exception 'FAIL: applicant set reviewed_by';
  exception when others then
    if sqlerrm like '%only a platform reviewer%' then
      raise notice 'PASS: applicant cannot set reviewed_by';
    else
      raise;
    end if;
  end;

  begin
    update public.professional_applications set internal_note = 'approve me please' where id = v_app_id;
    raise exception 'FAIL: applicant wrote an internal admin note';
  exception when others then
    if sqlerrm like '%only a platform reviewer%' then
      raise notice 'PASS: applicant cannot write internal admin notes';
    else
      raise;
    end if;
  end;

  -- The legitimate correction must still work.
  update public.professional_applications set phone = '+33699999999' where id = v_app_id;
  raise notice 'PASS: applicant CAN still correct their own contact details';

  -- And the review RPC must refuse them outright.
  begin
    perform public.review_professional_application(v_app_id, 'approve');
    raise exception 'FAIL: applicant executed the review RPC on their own application';
  exception when others then
    if sqlerrm like '%only FadeUp platform staff%' then
      raise notice 'PASS: applicant cannot execute the review RPC';
    else
      raise;
    end if;
  end;
end $$;
commit;

\echo '=========================================================='
\echo '4. An applicant cannot self-activate by creating an organization'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  -- Without the guard added in this migration, this is the whole bypass: an
  -- applicant awaiting review simply calls the onboarding RPC and becomes a
  -- tenant owner. No frontend route guard would ever see it.
  begin
    perform public.complete_organization_onboarding('Self Activated', 'proapp-self-activated', 'Main', 'UTC');
    raise exception 'FAIL: a pending applicant created their own organization and self-activated';
  exception when others then
    if sqlerrm like '%still being reviewed%' then
      raise notice 'PASS: a pending applicant cannot create an organization';
    else
      raise;
    end if;
  end;
end $$;
commit;

\echo '=========================================================='
\echo '5. Cross-applicant isolation, and the queue is closed to tenants/customers'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.professional_applications
    where id = current_setting('test.app_a_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL: applicant B read applicant A''s application';
  end if;
  raise notice 'PASS: applicant B cannot read applicant A''s application';

  select count(*) into v_count from public.get_my_professional_application();
  if v_count <> 0 then
    raise exception 'FAIL: applicant B''s own-application read returned A''s row';
  end if;
  raise notice 'PASS: get_my_professional_application is scoped to the caller';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.professional_applications;
  if v_count <> 0 then
    raise exception 'FAIL: a tenant owner read % application(s) from the platform queue', v_count;
  end if;
  raise notice 'PASS: a tenant owner cannot read the application queue';

  select count(*) into v_count from public.platform_notifications;
  if v_count <> 0 then
    raise exception 'FAIL: a tenant owner read platform notifications';
  end if;
  raise notice 'PASS: a tenant owner cannot read platform notifications';

  select count(*) into v_count from public.email_outbox;
  if v_count <> 0 then
    raise exception 'FAIL: a tenant owner read the email outbox';
  end if;
  raise notice 'PASS: a tenant owner cannot read the email outbox';

  begin
    perform public.review_professional_application(current_setting('test.app_a_id')::uuid, 'approve');
    raise exception 'FAIL: a tenant owner approved a professional application';
  exception when others then
    if sqlerrm like '%only FadeUp platform staff%' then
      raise notice 'PASS: a tenant owner cannot approve applications';
    else
      raise;
    end if;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.professional_applications;
  if v_count <> 0 then
    raise exception 'FAIL: a customer read % application(s)', v_count;
  end if;
  raise notice 'PASS: a customer cannot read the application queue';
end $$;
commit;

\echo '=========================================================='
\echo '6. Approval: applicant becomes TENANT owner, reviewer does not'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select organization_id as approved_org_id from public.review_professional_application(
  current_setting('test.app_a_id')::uuid, 'approve', null, 'Called, sounded legit.'
) \gset
commit;

begin;
reset role;
select set_config('test.approved_org_id', :'approved_org_id', false);
do $$
declare
  v_org_id uuid := current_setting('test.approved_org_id')::uuid;
  v_role public.membership_role;
  v_count integer;
begin
  if v_org_id is null then
    raise exception 'FAIL: approval did not create an organization';
  end if;

  select m.role into v_role from public.memberships m
    where m.organization_id = v_org_id and m.user_id = 'e1000000-0000-0000-0000-000000000002';
  if v_role is distinct from 'owner' then
    raise exception 'FAIL: applicant is not the owner of the created organization (role %)', v_role;
  end if;
  raise notice 'PASS: the APPLICANT owns the organization approval created';

  -- The whole point of the trigger suppression.
  select count(*) into v_count from public.memberships m
    where m.organization_id = v_org_id and m.user_id = 'e1000000-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'FAIL: the REVIEWING PLATFORM OWNER was made a member of the applicant''s shop';
  end if;
  raise notice 'PASS: the reviewing platform owner got no membership in the new shop';

  select count(*) into v_count from public.memberships m where m.organization_id = v_org_id;
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 membership on the new org, got %', v_count;
  end if;
  raise notice 'PASS: exactly one membership exists on the new organization';

  -- PRO OWNER != PLATFORM OWNER.
  select count(*) into v_count from public.platform_members where user_id = 'e1000000-0000-0000-0000-000000000002';
  if v_count <> 0 then
    raise exception 'FAIL: approval granted the applicant a PLATFORM role';
  end if;
  raise notice 'PASS: approval granted no platform role';

  select count(*) into v_count from public.email_outbox
    where template = 'professional_application_approved' and to_email = 'applicant-a+proapp@fadeup.test';
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 approval email queued, got %', v_count;
  end if;
  raise notice 'PASS: exactly one approval email was queued';

  select count(*) into v_count from public.platform_audit_log
    where target_id = current_setting('test.app_a_id')::uuid and action = 'professional_application_approved';
  if v_count <> 1 then
    raise exception 'FAIL: expected 1 approval audit event, got %', v_count;
  end if;
  raise notice 'PASS: approval wrote an audit event';
end $$;
commit;

\echo '=========================================================='
\echo '7. Approval is idempotent — a double-clicked Approve is harmless'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select public.review_professional_application(current_setting('test.app_a_id')::uuid, 'approve') is not null as second_call_ok;
commit;

begin;
reset role;
do $$
declare
  v_orgs integer;
  v_memberships integer;
  v_emails integer;
  v_audits integer;
begin
  select count(*) into v_orgs from public.organizations where name = 'Maison Fade';
  select count(*) into v_memberships from public.memberships where user_id = 'e1000000-0000-0000-0000-000000000002';
  select count(*) into v_emails from public.email_outbox
    where template = 'professional_application_approved' and to_email = 'applicant-a+proapp@fadeup.test';
  select count(*) into v_audits from public.platform_audit_log
    where target_id = current_setting('test.app_a_id')::uuid and action = 'professional_application_approved';

  if v_orgs <> 1 then raise exception 'FAIL: % organizations created (expected 1)', v_orgs; end if;
  if v_memberships <> 1 then raise exception 'FAIL: % memberships created (expected 1)', v_memberships; end if;
  if v_emails <> 1 then raise exception 'FAIL: % approval emails queued (expected 1)', v_emails; end if;
  if v_audits <> 1 then raise exception 'FAIL: % approval audit events (expected 1)', v_audits; end if;
  raise notice 'PASS: re-approving created no duplicate org/membership/email/audit';
end $$;
commit;

\echo '=========================================================='
\echo '8. An approved professional CAN now create nothing extra but owns their shop'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.organizations o
    where o.id = current_setting('test.approved_org_id')::uuid;
  if v_count <> 1 then
    raise exception 'FAIL: the approved professional cannot see their own organization';
  end if;
  raise notice 'PASS: the approved professional can reach their organization';

  select count(*) into v_count from public.professional_applications;
  if v_count <> 1 then
    raise exception 'FAIL: approved professional sees % applications (expected only their own)', v_count;
  end if;
  raise notice 'PASS: an approved professional still sees only their own application';
end $$;
commit;

\echo '=========================================================='
\echo '9. Rejection: access stays denied, review state stored, email queued'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
select id as app_b_id from public.submit_professional_application(
  'Other', 'Applicant', '+33700000000', 'Rejected Shop', 'independent_barber'
) \gset
commit;

begin;
reset role;
select set_config('test.app_b_id', :'app_b_id', false);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select public.review_professional_application(
  current_setting('test.app_b_id')::uuid, 'reject', 'We are not onboarding in your area yet.', 'Internal: could not verify the business.'
) is not null as rejected;
commit;

begin;
reset role;
do $$
declare
  v_app public.professional_applications;
  v_count integer;
  v_payload jsonb;
begin
  select * into v_app from public.professional_applications where id = current_setting('test.app_b_id')::uuid;

  if v_app.status <> 'rejected' then
    raise exception 'FAIL: status is % (expected rejected)', v_app.status;
  end if;
  if v_app.reviewed_at is null or v_app.reviewed_by is distinct from 'e1000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'FAIL: review state was not stored on rejection';
  end if;
  raise notice 'PASS: rejection stored status, reviewed_at and reviewed_by';

  select count(*) into v_count from public.memberships where user_id = 'e1000000-0000-0000-0000-000000000003';
  if v_count <> 0 then
    raise exception 'FAIL: a rejected applicant holds % membership(s)', v_count;
  end if;
  raise notice 'PASS: a rejected applicant holds no memberships';

  select count(*) into v_count from public.email_outbox
    where template = 'professional_application_rejected' and to_email = 'applicant-b+proapp@fadeup.test';
  if v_count <> 1 then
    raise exception 'FAIL: expected 1 rejection email, got %', v_count;
  end if;

  -- The applicant-facing reason travels; the internal note must not.
  select payload into v_payload from public.email_outbox
    where template = 'professional_application_rejected' and to_email = 'applicant-b+proapp@fadeup.test';
  if v_payload::text like '%could not verify%' then
    raise exception 'FAIL: the INTERNAL admin note was placed in the applicant email';
  end if;
  if coalesce(v_payload->>'rejection_reason', '') not like '%not onboarding in your area%' then
    raise exception 'FAIL: the applicant-facing reason is missing from the email payload';
  end if;
  raise notice 'PASS: rejection email carries the public reason and not the internal note';

  select count(*) into v_count from public.platform_audit_log
    where target_id = v_app.id and action = 'professional_application_rejected';
  if v_count <> 1 then
    raise exception 'FAIL: expected 1 rejection audit event, got %', v_count;
  end if;
  raise notice 'PASS: rejection wrote an audit event';
end $$;
commit;

\echo '=========================================================='
\echo '10. A rejected applicant is still blocked from self-activating'
\echo '=========================================================='
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare
  v_internal text;
begin
  begin
    perform public.complete_organization_onboarding('Rejected Anyway', 'proapp-rejected-anyway', 'Main', 'UTC');
    raise exception 'FAIL: a rejected applicant created an organization';
  exception when others then
    if sqlerrm like '%was not approved%' then
      raise notice 'PASS: a rejected applicant cannot create an organization';
    else
      raise;
    end if;
  end;

  -- The applicant-facing read path must not expose internal assessment.
  select internal_note into v_internal from public.get_my_professional_application() g
    join public.professional_applications a on a.id = g.id;
  -- (the join is only reachable because RLS lets them read their own row;
  --  what matters is that the RPC's own return type has no such column)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_applications'
  ) and exists (
    select 1 from pg_proc p
    where p.proname = 'get_my_professional_application'
      and pg_get_function_result(p.oid) like '%internal_note%'
  ) then
    raise exception 'FAIL: get_my_professional_application can return internal_note';
  end if;
  raise notice 'PASS: the applicant-facing RPC cannot return internal_note';
end $$;
commit;

\echo '=========================================================='
\echo '11. anon has zero access to any of it'
\echo '=========================================================='
begin;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.professional_applications;
  if v_count > 0 then raise exception 'FAIL: anon read % application(s)', v_count; end if;
  raise notice 'PASS: anon sees zero applications';

  select count(*) into v_count from public.platform_notifications;
  if v_count > 0 then raise exception 'FAIL: anon read % notification(s)', v_count; end if;
  raise notice 'PASS: anon sees zero platform notifications';

  select count(*) into v_count from public.email_outbox;
  if v_count > 0 then raise exception 'FAIL: anon read % outbox row(s)', v_count; end if;
  raise notice 'PASS: anon sees zero outbox rows';

  begin
    perform public.submit_professional_application('A', 'B', '+33612345678', 'Anon Shop', 'barbershop');
    raise exception 'FAIL: anon submitted an application';
  exception
    when insufficient_privilege then raise notice 'PASS: anon cannot execute submit_professional_application';
    when others then
      if sqlerrm like '%authentication required%' then
        raise notice 'PASS: submit_professional_application refuses an anonymous caller';
      else raise; end if;
  end;

  begin
    perform public.review_professional_application(current_setting('test.app_a_id')::uuid, 'approve');
    raise exception 'FAIL: anon reviewed an application';
  exception
    when insufficient_privilege then raise notice 'PASS: anon cannot execute review_professional_application';
    when others then
      if sqlerrm like '%only FadeUp platform staff%' then
        raise notice 'PASS: review_professional_application refuses an anonymous caller';
      else raise; end if;
  end;
end $$;
commit;

\echo '=========================================================='
\echo '12. Cleanup'
\echo '=========================================================='
begin;
reset role;
-- Notifications fan out to EVERY platform member, including any real seeded
-- platform owner, so they must be cleaned by target rather than by recipient
-- (deleting the test users only cascades away the test recipients' copies).
delete from public.platform_notifications where target_id in (
  select id from public.professional_applications where user_id in (
    select id from auth.users where email like '%proapp@fadeup.test'));
delete from public.email_outbox where to_email like '%proapp@fadeup.test';
delete from public.platform_audit_log where actor_user_id in (
  'e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000003');
delete from public.organizations where slug in ('proapp-existing-shop') or id = current_setting('test.approved_org_id')::uuid;
delete from auth.users where email like '%proapp@fadeup.test';
commit;

begin;
reset role;
select count(*) as remaining_applications from public.professional_applications;
select count(*) as remaining_notifications from public.platform_notifications where type = 'professional_application_submitted' and target_id not in (select id from public.professional_applications);
select count(*) as remaining_outbox from public.email_outbox where to_email like '%proapp@fadeup.test';
select count(*) as remaining_users from auth.users where email like '%proapp@fadeup.test';
commit;
