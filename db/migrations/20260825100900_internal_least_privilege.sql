-- FadeUp — R1A: three over-grants of internal data
--
-- 1. THE COLD-OUTREACH WORKER CAN READ EVERY TENANT'S TRANSACTIONAL EMAIL
--
--    20260813170000_professional_applications.sql grants prospect_worker
--    SELECT on email_outbox with a `using (true)` policy. email_outbox has no
--    organization_id and no anchor of any kind, and private.emit_booking_
--    notification writes recipient address plus a payload carrying customer
--    name, organization name, service and appointment time — for every
--    booking, in every tenant.
--
--    The grant is not merely broad, it is unnecessary: private.claim_next_email
--    is SECURITY DEFINER and `returns setof public.email_outbox`, so the worker
--    already receives exactly the rows it claimed. Nothing breaks when the
--    standing grant is removed.
--
--    Mitigating, and why this is HIGH rather than CRITICAL: `authenticator` is
--    not a member of prospect_worker, so no JWT can reach it. The exposure
--    requires compromise of the worker's own credential — and the worker's job
--    is fetching and parsing third-party scraped content, which is a materially
--    higher-risk surface than the customer API.
--
-- 2. AN APPLICANT CAN READ THE INTERNAL NOTE WRITTEN ABOUT THEM
--
--    professional_applications.internal_note is documented "Platform-only.
--    Never returned by any applicant-facing read path", and
--    get_my_professional_application does omit it. But the SELECT policy is
--    row-level (`user_id = auth.uid() or is_platform_admin()`) and
--    `authenticated` holds table-wide SELECT, so one
--    `.select('internal_note')` returns it.
--
--    The existing column-guard convention (`is distinct from` triggers) covers
--    UPDATE and has no SELECT analogue. The only mechanism that protects a
--    column against SELECT is a table-level revoke plus a selective re-grant —
--    verified to work here, contrary to an earlier reading that table-level
--    grants make column ACLs impossible. They do, which is exactly why the
--    table-level grant must go first.
--
-- 3. A PROSPECT EXISTENCE ORACLE
--
--    prospect_effective_locale(uuid) is SECURITY DEFINER, granted to
--    authenticated, and has no role check — any signed-in user can confirm
--    whether a UUID is a real prospect and read its locale. No PII, no
--    mutation, so LOW; it is fixed here because it costs one line and it is
--    the only genuine instance of the pattern an earlier audit wrongly
--    attributed to several other acquisition RPCs, all of which do re-derive
--    is_platform_admin() in-body.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- 1 -------------------------------------------------------------------------
drop policy if exists email_outbox_worker_select on public.email_outbox;
revoke select on public.email_outbox from prospect_worker;

-- 2 -------------------------------------------------------------------------
revoke select on public.professional_applications from authenticated, anon;
grant select (id, user_id, first_name, last_name, email, phone, business_name,
              professional_type, city, address_line1, postal_code, country,
              staff_count, website, instagram, business_identifier, status,
              submitted_at, reviewed_at, reviewed_by, rejection_reason,
              organization_id, created_at, updated_at)
  on public.professional_applications to authenticated;

comment on column public.professional_applications.internal_note is
  'Platform-only reviewer note. Withheld from `authenticated` by column grant, not merely omitted from an RPC: the SELECT policy is row-level and the applicant''s own row matches it, so without the grant restriction a single .select(''internal_note'') returned the reviewer''s private assessment to its subject. Platform staff read it through their own path.';

-- 3 -------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prospect_effective_locale'
  ) then
    execute 'revoke execute on function public.prospect_effective_locale(uuid) from authenticated';
  end if;
end $$;
