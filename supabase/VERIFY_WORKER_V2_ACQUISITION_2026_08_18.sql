-- ============================================================================
-- FadeUp — VERIFY: Worker V2 / Platform Acquisition Intelligence
--
-- Companion to MASTER_WORKER_V2_ACQUISITION_2026_08_18.sql.
--
-- Emits one row per check:  check_name | status  where status is
--   PASS  the property holds
--   FAIL  the property is violated — investigate before going further
--   INFO  contextual, not a pass/fail assertion
--
-- Expected result: 0 FAIL rows.
--
-- This is deliberately BEHAVIOURAL, not structural. Asserting that a
-- policy row exists proves nothing about who can actually read a table,
-- so the security sections below SET ROLE and genuinely attempt the
-- access, then assert on what happened. Structural checks (columns,
-- indexes, constraints) are included too, but they are the cheap half.
--
-- Safe to run repeatedly: every fixture is created inside a transaction
-- that is rolled back at the end, so this script leaves no rows behind.
--
-- Run:
--   psql -U postgres -d postgres -f supabase/VERIFY_WORKER_V2_ACQUISITION_2026_08_18.sql
-- ============================================================================

\pset pager off
\pset tuples_only off
\set ON_ERROR_STOP off

-- Created OUTSIDE the transaction below, and deliberately WITHOUT
-- `on commit drop`: a temp table created inside the fixture transaction
-- would be destroyed by the closing rollback before the results could be
-- printed. Created here, it survives the rollback (though its rows do
-- not) — which is why the result set is selected BEFORE the rollback.
-- It disappears when the psql session ends.
drop table if exists verify_results;

create temporary table verify_results (
  seq serial primary key,
  check_name text not null,
  status text not null check (status in ('PASS', 'FAIL', 'INFO')),
  detail text
);

-- SECURITY DEFINER so the recorder still works after `SET ROLE anon` /
-- `SET ROLE prospect_worker` in the behavioural sections below. Without
-- it, the very act of recording a result would fail under a restricted
-- role and abort the transaction. It writes only to this session's temp
-- table, so the elevated context grants nothing else.
create or replace function pg_temp.record(p_check text, p_status text, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail) values (p_check, p_status, p_detail);
$$;

/** Records PASS when p_condition is true, FAIL otherwise. */
create or replace function pg_temp.expect(p_check text, p_condition boolean, p_detail text default null)
returns void language sql security definer as $$
  insert into verify_results (check_name, status, detail)
  values (p_check, case when p_condition then 'PASS' else 'FAIL' end, p_detail);
$$;

begin;

-- ============================================================================
-- SECTION 1 — Structure: tables, columns, constraints, indexes
-- ============================================================================

do $$
declare
  t text;
  expected_tables text[] := array[
    'booking_providers', 'booking_provider_observations', 'prospect_identity_matches',
    'prospect_features', 'prospect_data_quality', 'prospect_fit_scores',
    'prospect_score_rulesets', 'prospect_segments', 'prospect_segment_definitions',
    'prospect_locales', 'prospect_searches', 'prospect_search_partitions',
    'outreach_sales_angles', 'outreach_templates', 'prospect_outreach_eligibility',
    'outreach_channel_policies', 'outreach_campaigns', 'outreach_recipients',
    'outreach_events', 'whatsapp_accounts', 'whatsapp_template_mappings',
    'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
    'outreach_experiments', 'outreach_experiment_arms', 'outreach_assignments',
    'ml_feature_schemas', 'ml_datasets', 'ml_model_versions', 'ml_training_runs',
    'ml_predictions', 'ml_metrics'
  ];
begin
  foreach t in array expected_tables loop
    perform pg_temp.expect(
      format('table public.%s exists', t),
      to_regclass('public.' || t) is not null
    );
  end loop;
end $$;

do $$
declare
  v_type text;
  expected_types text[] := array[
    'prospect_tribool', 'prospect_identity_match_state', 'booking_provider_detection_method',
    'prospect_locale_source', 'prospect_search_partition_status', 'prospect_fit_class',
    'outreach_channel_kind', 'outreach_template_status', 'outreach_campaign_status',
    'outreach_recipient_state', 'outreach_event_type', 'outreach_opt_in_status',
    'whatsapp_message_direction', 'whatsapp_message_status', 'ml_model_target'
  ];
begin
  foreach v_type in array expected_types loop
    perform pg_temp.expect(
      format('enum public.%s exists', v_type),
      exists (select 1 from pg_type where typname = v_type)
    );
  end loop;
end $$;

-- The tri-state enum must have exactly the four documented values.
select pg_temp.expect(
  'prospect_tribool has TRUE/FALSE/UNKNOWN/NOT_APPLICABLE',
  (select array_agg(enumlabel::text order by enumsortorder)
   from pg_enum where enumtypid = 'public.prospect_tribool'::regtype)
  = array['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE']
);

-- ml_model_target must NOT contain delivered/read: optimising for those
-- is explicitly forbidden.
select pg_temp.expect(
  'ml_model_target excludes the vanity metrics delivered/read',
  not exists (
    select 1 from pg_enum
    where enumtypid = 'public.ml_model_target'::regtype
      and enumlabel in ('delivered', 'read')
  )
);

-- Denormalized columns added to the pre-existing prospects table.
do $$
declare
  c text;
  expected_columns text[] := array[
    'current_booking_provider_id', 'fadeup_fit_score', 'fadeup_fit_class',
    'migration_potential_score', 'migration_potential_class',
    'rating', 'review_count', 'estimated_barber_count'
  ];
begin
  foreach c in array expected_columns loop
    perform pg_temp.expect(
      format('prospects.%s exists', c),
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'prospects' and column_name = c
      )
    );
  end loop;
end $$;

select pg_temp.expect(
  'prospect_jobs.job_type accepts the new acquisition job types',
  (select pg_get_constraintdef(oid) from pg_constraint
   where conname = 'prospect_jobs_job_type_check' and conrelid = 'public.prospect_jobs'::regclass)
  like '%outreach_preparation%'
);

select pg_temp.expect(
  'prospect_jobs.job_type still accepts every original job type',
  (select bool_and(
     (select pg_get_constraintdef(oid) from pg_constraint
      where conname = 'prospect_jobs_job_type_check' and conrelid = 'public.prospect_jobs'::regclass)
     like '%' || original || '%')
   from unnest(array['discovery', 'enrichment', 'dedup_scan', 'scoring', 'website_crawl', 'instagram_enrich']) as original)
);

-- Critical unique indexes: these are the duplicate/idempotency guards.
do $$
declare
  i text;
  expected_indexes text[] := array[
    'booking_provider_observations_one_current',
    'prospect_fit_scores_one_current',
    'prospect_features_unique',
    'whatsapp_messages_idempotency_unique',
    'whatsapp_messages_provider_id_unique',
    'whatsapp_webhook_events_provider_unique',
    'ml_model_versions_one_active',
    'outreach_events_provider_event_unique',
    'prospect_score_rulesets_one_active',
    'outreach_experiment_arms_one_control'
  ];
begin
  foreach i in array expected_indexes loop
    perform pg_temp.expect(
      format('unique index %s exists', i),
      exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
    );
  end loop;
end $$;

select pg_temp.expect(
  'outreach_recipients has the (campaign, prospect) duplicate-send guard',
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.outreach_recipients'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%campaign_id%prospect_id%'
  )
);

-- ============================================================================
-- SECTION 2 — Functions and grants
-- ============================================================================

do $$
declare
  f text;
  expected_functions text[] := array[
    'public.outreach_block_reason(uuid,public.outreach_channel_kind)',
    'public.prospect_effective_locale(uuid)',
    'public.approve_outreach_template(uuid)',
    'public.set_outreach_template_paused(uuid,boolean)',
    'public.promote_ml_model(uuid,text)',
    'public.retire_ml_model(uuid)',
    'public.suppress_prospect_outreach(uuid,text)',
    'public.set_outreach_campaign_status(uuid,public.outreach_campaign_status)',
    'public.classify_outreach_reply(uuid,boolean,text)',
    'public.override_prospect_locale(uuid,text)',
    'public.override_prospect_booking_provider(uuid,text,text)',
    'private.tribool_is_true(public.prospect_tribool)',
    'private.tribool_is_false(public.prospect_tribool)',
    'private.assert_whatsapp_sendable()'
  ];
begin
  foreach f in array expected_functions loop
    perform pg_temp.expect(
      format('function %s exists', f),
      to_regprocedure(f) is not null
    );
  end loop;
end $$;

-- Every SECURITY DEFINER function this migration adds must pin its
-- search_path. Without it, a caller-controlled search_path can redirect an
-- unqualified reference inside a definer function to a hostile object.
select pg_temp.expect(
  'every new SECURITY DEFINER function pins search_path',
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and p.proname in (
        'outreach_block_reason', 'prospect_effective_locale', 'approve_outreach_template',
        'set_outreach_template_paused', 'promote_ml_model', 'retire_ml_model',
        'suppress_prospect_outreach', 'set_outreach_campaign_status', 'classify_outreach_reply',
        'override_prospect_locale', 'override_prospect_booking_provider',
        'assert_whatsapp_sendable', 'cancel_outreach_on_conversion',
        'booking_provider_observations_maintain_current', 'prospect_fit_scores_maintain_current',
        'prospects_sync_booking_provider', 'prospects_sync_fit_scores',
        'prospect_search_partitions_enforce_limits', 'assert_experiment_exposure_limits',
        'outreach_templates_stamp_approval'
      )
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) as cfg where cfg like 'search_path=%'
      ))
  ),
  'a SECURITY DEFINER function without a pinned search_path is a privilege-escalation vector'
);

-- anon must not be able to execute any of the acquisition RPCs.
select pg_temp.expect(
  'anon cannot execute the outreach/ML control RPCs',
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'approve_outreach_template', 'promote_ml_model', 'retire_ml_model',
        'suppress_prospect_outreach', 'set_outreach_campaign_status',
        'classify_outreach_reply', 'override_prospect_locale',
        'override_prospect_booking_provider', 'outreach_block_reason'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  )
);

-- ============================================================================
-- SECTION 3 — RLS is enabled AND forced on every new table
-- ============================================================================

do $$
declare
  t text;
  all_tables text[] := array[
    'booking_providers', 'booking_provider_observations', 'prospect_identity_matches',
    'prospect_features', 'prospect_data_quality', 'prospect_fit_scores',
    'prospect_score_rulesets', 'prospect_segments', 'prospect_segment_definitions',
    'prospect_locales', 'prospect_searches', 'prospect_search_partitions',
    'outreach_sales_angles', 'outreach_templates', 'prospect_outreach_eligibility',
    'outreach_channel_policies', 'outreach_campaigns', 'outreach_recipients',
    'outreach_events', 'whatsapp_accounts', 'whatsapp_template_mappings',
    'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
    'outreach_experiments', 'outreach_experiment_arms', 'outreach_assignments',
    'ml_feature_schemas', 'ml_datasets', 'ml_model_versions', 'ml_training_runs',
    'ml_predictions', 'ml_metrics'
  ];
begin
  foreach t in array all_tables loop
    perform pg_temp.expect(
      format('%s has RLS enabled and forced', t),
      (select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass)
    );

    perform pg_temp.expect(
      format('%s has at least one policy', t),
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = t)
    );

    -- No policy may target anon or PUBLIC: this is internal data.
    perform pg_temp.expect(
      format('%s has no anon/PUBLIC policy', t),
      not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t
          and ('anon' = any(roles) or roles = '{public}')
      )
    );
  end loop;
end $$;

-- Append-only surfaces must not be updatable/deletable by clients.
select pg_temp.expect(
  'outreach_events is append-only for authenticated',
  not has_table_privilege('authenticated', 'public.outreach_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.outreach_events', 'DELETE')
);

select pg_temp.expect(
  'ml_predictions is append-only (prediction history is never rewritten)',
  not has_table_privilege('authenticated', 'public.ml_predictions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ml_predictions', 'DELETE')
  and not has_table_privilege('prospect_worker', 'public.ml_predictions', 'UPDATE')
);

select pg_temp.expect(
  'booking_provider_observations history cannot be deleted',
  not has_table_privilege('authenticated', 'public.booking_provider_observations', 'DELETE')
  and not has_table_privilege('prospect_worker', 'public.booking_provider_observations', 'DELETE')
);

select pg_temp.expect(
  'prospect_identity_matches audit trail cannot be deleted',
  not has_table_privilege('authenticated', 'public.prospect_identity_matches', 'DELETE')
);

-- ============================================================================
-- SECTION 4 — Fixtures for the behavioural tests
-- ============================================================================

insert into auth.users (id, instance_id, email, aud, role)
values
  ('11110000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'verify-owner@fadeup.test', 'authenticated', 'authenticated'),
  ('11110000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'verify-support@fadeup.test', 'authenticated', 'authenticated'),
  ('11110000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'verify-barber@fadeup.test', 'authenticated', 'authenticated'),
  ('11110000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'verify-customer@fadeup.test', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- Platform staff.
insert into public.platform_members (user_id, role)
values
  ('11110000-0000-0000-0000-000000000001', 'platform_owner'),
  ('11110000-0000-0000-0000-000000000002', 'platform_support')
on conflict do nothing;

-- Two ordinary, non-platform users: a barber and a customer. Neither is in
-- platform_members, which is exactly the point.

insert into public.prospects (id, type, canonical_name, country, phone_e164, rating, review_count)
values
  ('22220000-0000-0000-0000-000000000001', 'barbershop', 'Verify Barbier Paris', 'FR', '+33600000101', 4.7, 180),
  ('22220000-0000-0000-0000-000000000002', 'barbershop', 'Verify Suppressed Shop', 'FR', '+33600000102', 4.1, 12),
  ('22220000-0000-0000-0000-000000000003', 'barbershop', 'Verify Converted Shop', 'FR', '+33600000103', 4.9, 400)
on conflict (id) do nothing;

insert into public.prospect_locales (prospect_id, detected_country, detected_language, locale, language_source, language_confidence)
values
  ('22220000-0000-0000-0000-000000000001', 'FR', 'fr', 'fr-FR', 'business_address', 0.9),
  ('22220000-0000-0000-0000-000000000002', 'FR', 'fr', 'fr-FR', 'business_address', 0.9),
  ('22220000-0000-0000-0000-000000000003', 'FR', 'fr', 'fr-FR', 'business_address', 0.9)
on conflict (prospect_id) do nothing;

insert into public.prospect_outreach_eligibility
  (prospect_id, channel, destination, is_eligible, opt_in_status, opt_in_source, opt_in_at)
values
  ('22220000-0000-0000-0000-000000000001', 'whatsapp', '+33600000101', true, 'confirmed', 'verify-fixture', now()),
  ('22220000-0000-0000-0000-000000000002', 'whatsapp', '+33600000102', true, 'confirmed', 'verify-fixture', now()),
  ('22220000-0000-0000-0000-000000000003', 'whatsapp', '+33600000103', true, 'confirmed', 'verify-fixture', now())
on conflict (prospect_id, channel) do nothing;

insert into public.outreach_templates
  (id, key, name, channel, locale, body, allowed_variables, status, approved_by, approved_at)
values
  ('33330000-0000-0000-0000-000000000001', 'verify_fr_v1', 'Verify FR', 'whatsapp', 'fr-FR',
   'Bonjour {{business_name}}', array['business_name'], 'approved',
   '11110000-0000-0000-0000-000000000001', now()),
  ('33330000-0000-0000-0000-000000000002', 'verify_en_v1', 'Verify EN', 'whatsapp', 'en-GB',
   'Hello {{business_name}}', array['business_name'], 'approved',
   '11110000-0000-0000-0000-000000000001', now()),
  ('33330000-0000-0000-0000-000000000003', 'verify_draft_fr_v1', 'Verify draft FR', 'whatsapp', 'fr-FR',
   'Bonjour {{business_name}}', array['business_name'], 'draft', null, null)
on conflict (id) do nothing;

insert into public.whatsapp_accounts (id, label, waba_id, phone_number_id, provider_mode)
values ('44440000-0000-0000-0000-000000000001', 'Verify mock account', '100200300', '400500600', 'mock')
on conflict (id) do nothing;

insert into public.outreach_campaigns (id, name, channel, status, whatsapp_account_id)
values ('55550000-0000-0000-0000-000000000001', 'Verify campaign', 'whatsapp', 'draft',
        '44440000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ============================================================================
-- SECTION 5 — Eligibility gate (behavioural)
-- ============================================================================

select pg_temp.expect(
  'an eligible prospect with a resolved locale is contactable',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000001', 'whatsapp') is null,
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000001', 'whatsapp'), '(null)')
);

-- Queue one legitimate recipient.
do $$
begin
  insert into public.outreach_recipients
    (id, campaign_id, prospect_id, state, template_id, rendered_body, destination)
  values ('66660000-0000-0000-0000-000000000001', '55550000-0000-0000-0000-000000000001',
          '22220000-0000-0000-0000-000000000001', 'queued',
          '33330000-0000-0000-0000-000000000001', 'Bonjour Verify Barbier Paris', '+33600000101');
  perform pg_temp.record('an eligible prospect CAN be queued', 'PASS');
exception when others then
  perform pg_temp.record('an eligible prospect CAN be queued', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect(
  'queueing stamps locale and queued_at server-side',
  (select locale = 'fr-FR' and queued_at is not null
   from public.outreach_recipients where id = '66660000-0000-0000-0000-000000000001')
);

-- Duplicate (campaign, prospect) must be refused.
do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000001', 'queued',
          '33330000-0000-0000-0000-000000000001', 'Bonjour again');
  perform pg_temp.record('DUPLICATE (campaign, prospect) is refused', 'FAIL', 'the duplicate insert succeeded');
exception when unique_violation then
  perform pg_temp.record('DUPLICATE (campaign, prospect) is refused', 'PASS');
when others then
  perform pg_temp.record('DUPLICATE (campaign, prospect) is refused', 'FAIL', sqlerrm);
end $$;

-- Wrong-language template must be refused, even though it is approved.
do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002', 'queued',
          '33330000-0000-0000-0000-000000000002', 'Hello Verify Suppressed Shop');
  perform pg_temp.record('WRONG-LANGUAGE template is refused for an fr-FR prospect', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record(
    'WRONG-LANGUAGE template is refused for an fr-FR prospect',
    case when sqlerrm like '%wrong language%' then 'PASS' else 'FAIL' end,
    sqlerrm
  );
end $$;

-- Unapproved template must be refused.
do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002', 'queued',
          '33330000-0000-0000-0000-000000000003', 'Bonjour');
  perform pg_temp.record('UNAPPROVED template is refused', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record(
    'UNAPPROVED template is refused',
    case when sqlerrm like '%only approved templates%' then 'PASS' else 'FAIL' end,
    sqlerrm
  );
end $$;

-- Queueing with no template at all must be refused.
do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002', 'queued', 'raw text');
  perform pg_temp.record('queueing WITHOUT a template is refused', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('queueing WITHOUT a template is refused', 'PASS', sqlerrm);
end $$;

-- SUPPRESSED contact must not be queueable.
insert into public.prospect_suppressions (scope, prospect_id, reason)
values ('prospect', '22220000-0000-0000-0000-000000000002', 'verify fixture')
on conflict do nothing;

select pg_temp.expect(
  'a SUPPRESSED prospect is reported as blocked',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000002', 'whatsapp') in ('do_not_contact', 'suppressed_prospect'),
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000002', 'whatsapp'), '(null)')
);

do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002', 'queued',
          '33330000-0000-0000-0000-000000000001', 'Bonjour');
  perform pg_temp.record('SUPPRESSED contact CANNOT be queued', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('SUPPRESSED contact CANNOT be queued', 'PASS', sqlerrm);
end $$;

-- INELIGIBLE contact (is_eligible = false) must not be queueable.
update public.prospect_outreach_eligibility
set is_eligible = false
where prospect_id = '22220000-0000-0000-0000-000000000003' and channel = 'whatsapp';

select pg_temp.expect(
  'an INELIGIBLE contact is reported as not_eligible',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000003', 'whatsapp') = 'not_eligible',
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000003', 'whatsapp'), '(null)')
);

do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000003', 'queued',
          '33330000-0000-0000-0000-000000000001', 'Bonjour');
  perform pg_temp.record('INELIGIBLE contact CANNOT be queued', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('INELIGIBLE contact CANNOT be queued', 'PASS', sqlerrm);
end $$;

-- A prospect with NO locale must be blocked, never sent a default language.
insert into public.prospects (id, type, canonical_name, country, phone_e164)
values ('22220000-0000-0000-0000-000000000004', 'barbershop', 'Verify No Locale', 'FR', '+33600000104')
on conflict (id) do nothing;

insert into public.prospect_outreach_eligibility (prospect_id, channel, destination, is_eligible, opt_in_status, opt_in_at, opt_in_source)
values ('22220000-0000-0000-0000-000000000004', 'whatsapp', '+33600000104', true, 'confirmed', now(), 'verify-fixture')
on conflict (prospect_id, channel) do nothing;

select pg_temp.expect(
  'an UNRESOLVED locale blocks outreach rather than defaulting to a language',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp') = 'locale_unresolved',
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp'), '(null)')
);

-- A locale flagged for review blocks too.
insert into public.prospect_locales (prospect_id, locale, language_source, language_confidence, language_review_required)
values ('22220000-0000-0000-0000-000000000004', 'fr-FR', 'website_language', 0.9, true)
on conflict (prospect_id) do update set language_review_required = true;

select pg_temp.expect(
  'a locale flagged for REVIEW blocks outreach',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp') = 'locale_review_required',
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp'), '(null)')
);

-- A human locale override clears the review block.
update public.prospect_locales
set override_locale = 'fr-FR'
where prospect_id = '22220000-0000-0000-0000-000000000004';

select pg_temp.expect(
  'a human locale OVERRIDE clears the review block',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp') is null,
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp'), '(null)')
);

-- ============================================================================
-- SECTION 6 — Conversion stops prospecting
-- ============================================================================

insert into public.outreach_recipients (id, campaign_id, prospect_id, state)
values ('66660000-0000-0000-0000-000000000009', '55550000-0000-0000-0000-000000000001',
        '22220000-0000-0000-0000-000000000004', 'pending')
on conflict do nothing;

insert into public.prospect_jobs (id, job_type, status, payload)
values ('77770000-0000-0000-0000-000000000001', 'website_enrichment', 'queued',
        jsonb_build_object('prospectId', '22220000-0000-0000-0000-000000000004'))
on conflict (id) do nothing;

update public.prospects set status = 'customer' where id = '22220000-0000-0000-0000-000000000004';

select pg_temp.expect(
  'CONVERTED prospect: pending outreach is blocked',
  (select state = 'blocked' and blocked_reason = 'prospect_converted'
   from public.outreach_recipients where id = '66660000-0000-0000-0000-000000000009')
);

select pg_temp.expect(
  'CONVERTED prospect: queued prospecting jobs are cancelled',
  (select status = 'cancelled' from public.prospect_jobs where id = '77770000-0000-0000-0000-000000000001')
);

select pg_temp.expect(
  'CONVERTED prospect: future outreach is blocked by the gate',
  public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp') = 'already_customer',
  coalesce(public.outreach_block_reason('22220000-0000-0000-0000-000000000004', 'whatsapp'), '(null)')
);

-- ============================================================================
-- SECTION 7 — Competitor observation history
-- ============================================================================

insert into public.booking_provider_observations
  (prospect_id, provider_id, detection_method, evidence, confidence)
select '22220000-0000-0000-0000-000000000001', id, 'script_domain', 'planity.com/widget.js', 0.95
from public.booking_providers where key = 'PLANITY';

select pg_temp.expect(
  'a competitor detection becomes the prospect''s current provider',
  (select bp.key from public.prospects p
   join public.booking_providers bp on bp.id = p.current_booking_provider_id
   where p.id = '22220000-0000-0000-0000-000000000001') = 'PLANITY'
);

-- Re-observing the SAME provider must extend the window, not append a row.
insert into public.booking_provider_observations
  (prospect_id, provider_id, detection_method, evidence, confidence)
select '22220000-0000-0000-0000-000000000001', id, 'booking_url', 'planity.com/le-barbier', 0.97
from public.booking_providers where key = 'PLANITY';

select pg_temp.expect(
  'RE-DETECTING the same provider does not append a duplicate row',
  (select count(*) from public.booking_provider_observations o
   join public.booking_providers bp on bp.id = o.provider_id
   where o.prospect_id = '22220000-0000-0000-0000-000000000001' and bp.key = 'PLANITY') = 1
);

-- A provider CHANGE must retire the old row and keep it as history.
insert into public.booking_provider_observations
  (prospect_id, provider_id, detection_method, evidence, confidence)
select '22220000-0000-0000-0000-000000000001', id, 'booking_url', 'booksy.com/b/123', 0.98
from public.booking_providers where key = 'BOOKSY';

select pg_temp.expect(
  'a provider CHANGE retires the previous observation but keeps it as history',
  (select count(*) from public.booking_provider_observations
   where prospect_id = '22220000-0000-0000-0000-000000000001') = 2
  and (select count(*) from public.booking_provider_observations
       where prospect_id = '22220000-0000-0000-0000-000000000001' and is_current) = 1
);

select pg_temp.expect(
  'the prospect''s current provider follows the change',
  (select bp.key from public.prospects p
   join public.booking_providers bp on bp.id = p.current_booking_provider_id
   where p.id = '22220000-0000-0000-0000-000000000001') = 'BOOKSY'
);

select pg_temp.expect(
  'the competitor registry contains every provider the spec names',
  (select count(*) from public.booking_providers
   where key in ('PLANITY', 'BOOKSY', 'FRESHA', 'TREATWELL', 'KIUTE', 'RESERVIO',
                 'SUMUP_BOOKINGS', 'SQUIRE', 'PHOREST', 'SALONIZED', 'TIMIFY', 'TIMELY',
                 'CUSTOM_BOOKING', 'OTHER', 'NO_BOOKING', 'UNKNOWN')) = 16
);

select pg_temp.expect(
  'NO_BOOKING and UNKNOWN are distinct sentinel rows',
  (select count(*) from public.booking_providers where is_sentinel and key in ('NO_BOOKING', 'UNKNOWN')) = 2
);

select pg_temp.expect(
  'no provider is marked compliant-discoverable without an explicit assessment',
  not exists (
    select 1 from public.booking_providers
    where supports_compliant_discovery = true and coalesce(discovery_notes, '') = ''
  ),
  'a provider may only be used as a discovery source once assessed and documented'
);

-- ============================================================================
-- SECTION 8 — Tri-state semantics
-- ============================================================================

select pg_temp.expect(
  'tribool: UNKNOWN is neither true nor false',
  private.tribool_is_true('UNKNOWN') = false
  and private.tribool_is_false('UNKNOWN') = false
  and private.tribool_is_known('UNKNOWN') = false
);

select pg_temp.expect(
  'tribool: NOT_APPLICABLE is neither true nor false',
  private.tribool_is_true('NOT_APPLICABLE') = false
  and private.tribool_is_false('NOT_APPLICABLE') = false
);

select pg_temp.expect(
  'tribool: TRUE and FALSE behave as expected',
  private.tribool_is_true('TRUE')
  and private.tribool_is_false('FALSE')
  and private.tribool_is_known('TRUE')
  and private.tribool_is_known('FALSE')
);

insert into public.prospect_features (prospect_id, feature_key, value_bool, evidence_source)
values ('22220000-0000-0000-0000-000000000001', 'booking_detected', 'UNKNOWN', 'website')
on conflict (prospect_id, feature_key, feature_version) do update set value_bool = 'UNKNOWN';

select pg_temp.expect(
  'a feature row can hold exactly one value kind',
  (select count(*) from public.prospect_features
   where prospect_id = '22220000-0000-0000-0000-000000000001'
     and value_bool is not null and value_numeric is null and value_text is null) = 1
);

do $$
begin
  insert into public.prospect_features (prospect_id, feature_key, value_bool, value_numeric, evidence_source)
  values ('22220000-0000-0000-0000-000000000001', 'ambiguous_feature', 'TRUE', 42, 'test');
  perform pg_temp.record('a feature CANNOT hold two value kinds at once', 'FAIL', 'the insert succeeded');
exception when check_violation then
  perform pg_temp.record('a feature CANNOT hold two value kinds at once', 'PASS');
when others then
  perform pg_temp.record('a feature CANNOT hold two value kinds at once', 'FAIL', sqlerrm);
end $$;

-- ============================================================================
-- SECTION 9 — Scoring integrity
-- ============================================================================

insert into public.prospect_fit_scores (prospect_id, score_kind, score, classification, ruleset_version)
values ('22220000-0000-0000-0000-000000000001', 'fadeup_fit', 55, 'WARM', 'fadeup-fit-v1'),
       ('22220000-0000-0000-0000-000000000001', 'fadeup_fit', 81, 'HOT', 'fadeup-fit-v1'),
       ('22220000-0000-0000-0000-000000000001', 'migration_potential', 76, 'HOT', 'migration-potential-v1');

select pg_temp.expect(
  'only the newest score of each kind is current',
  (select count(*) from public.prospect_fit_scores
   where prospect_id = '22220000-0000-0000-0000-000000000001' and is_current) = 2
);

select pg_temp.expect(
  'score history is retained, not overwritten',
  (select count(*) from public.prospect_fit_scores
   where prospect_id = '22220000-0000-0000-0000-000000000001' and score_kind = 'fadeup_fit') = 2
);

select pg_temp.expect(
  'the two scores are stored INDEPENDENTLY on the prospect',
  (select fadeup_fit_score = 81 and migration_potential_score = 76
   from public.prospects where id = '22220000-0000-0000-0000-000000000001')
);

do $$
begin
  insert into public.prospect_fit_scores (prospect_id, score_kind, score, classification, ruleset_version)
  values ('22220000-0000-0000-0000-000000000001', 'fadeup_fit', 140, 'HOT', 'x');
  perform pg_temp.record('a score outside 0-100 is refused', 'FAIL', 'the insert succeeded');
exception when check_violation then
  perform pg_temp.record('a score outside 0-100 is refused', 'PASS');
when others then
  perform pg_temp.record('a score outside 0-100 is refused', 'FAIL', sqlerrm);
end $$;

-- ============================================================================
-- SECTION 10 — Search planner limits
-- ============================================================================

insert into public.prospect_searches (id, country, city, max_partitions, max_depth)
values ('88880000-0000-0000-0000-000000000001', 'FR', 'Paris', 2, 1);

insert into public.prospect_search_partitions (search_id, source_key, country, depth)
values ('88880000-0000-0000-0000-000000000001', 'osm', 'FR', 0),
       ('88880000-0000-0000-0000-000000000001', 'geoapify', 'FR', 0);

do $$
begin
  insert into public.prospect_search_partitions (search_id, source_key, country, depth)
  values ('88880000-0000-0000-0000-000000000001', 'osm', 'FR', 1);
  perform pg_temp.record('max_partitions is enforced by the database', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record(
    'max_partitions is enforced by the database',
    case when sqlerrm like '%maximum of%partitions%' then 'PASS' else 'FAIL' end,
    sqlerrm
  );
end $$;

do $$
begin
  delete from public.prospect_search_partitions where search_id = '88880000-0000-0000-0000-000000000001';
  insert into public.prospect_search_partitions (search_id, source_key, country, depth)
  values ('88880000-0000-0000-0000-000000000001', 'osm', 'FR', 5);
  perform pg_temp.record('max_depth is enforced by the database', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record(
    'max_depth is enforced by the database',
    case when sqlerrm like '%exceeds search max_depth%' then 'PASS' else 'FAIL' end,
    sqlerrm
  );
end $$;

-- ============================================================================
-- SECTION 11 — Identity resolution integrity
-- ============================================================================

do $$
begin
  insert into public.prospect_identity_matches
    (prospect_id, state, matching_rule, confidence, merge_applied)
  values ('22220000-0000-0000-0000-000000000001', 'REVIEW_REQUIRED', 'fuzzy_name_geo', 0.62, true);
  perform pg_temp.record('an ambiguous match CANNOT claim a merge was applied', 'FAIL', 'the insert succeeded');
exception when check_violation then
  perform pg_temp.record('an ambiguous match CANNOT claim a merge was applied', 'PASS');
when others then
  perform pg_temp.record('an ambiguous match CANNOT claim a merge was applied', 'FAIL', sqlerrm);
end $$;

do $$
begin
  insert into public.prospect_identity_matches
    (prospect_id, state, matching_rule, confidence, merge_applied)
  values ('22220000-0000-0000-0000-000000000001', 'MATCHED', 'exact_siret', 1.0, true);
  perform pg_temp.record('a confident match CAN record an applied merge', 'PASS');
exception when others then
  perform pg_temp.record('a confident match CAN record an applied merge', 'FAIL', sqlerrm);
end $$;

-- ============================================================================
-- SECTION 12 — WhatsApp idempotency and secret hygiene
-- ============================================================================

insert into public.whatsapp_messages
  (whatsapp_account_id, direction, idempotency_key, to_phone_e164, body)
values ('44440000-0000-0000-0000-000000000001', 'outbound', 'verify-idem-1', '+33600000101', 'Bonjour');

do $$
begin
  insert into public.whatsapp_messages
    (whatsapp_account_id, direction, idempotency_key, to_phone_e164, body)
  values ('44440000-0000-0000-0000-000000000001', 'outbound', 'verify-idem-1', '+33600000101', 'Bonjour');
  perform pg_temp.record('DUPLICATE idempotency key CANNOT send twice', 'FAIL', 'the second insert succeeded');
exception when unique_violation then
  perform pg_temp.record('DUPLICATE idempotency key CANNOT send twice', 'PASS');
when others then
  perform pg_temp.record('DUPLICATE idempotency key CANNOT send twice', 'FAIL', sqlerrm);
end $$;

insert into public.whatsapp_webhook_events (provider_event_id, event_type, payload)
values ('verify-event-1', 'status', '{}'::jsonb);

do $$
declare
  v_inserted int;
begin
  insert into public.whatsapp_webhook_events (provider_event_id, event_type, payload)
  values ('verify-event-1', 'status', '{}'::jsonb)
  on conflict (provider_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  perform pg_temp.expect('a REDELIVERED webhook event is idempotent', v_inserted = 0);
end $$;

do $$
begin
  insert into public.whatsapp_accounts (label, waba_id, phone_number_id)
  values ('leaky', 'EAAGm0PX4ZCpsBO7ZC', '123456789');
  perform pg_temp.record('an access token pasted into config is refused', 'FAIL', 'the insert succeeded');
exception when check_violation then
  perform pg_temp.record('an access token pasted into config is refused', 'PASS');
when others then
  perform pg_temp.record('an access token pasted into config is refused', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect(
  'whatsapp_accounts has no column that could hold a secret value',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_accounts'
      and column_name in ('access_token', 'app_secret', 'verify_token', 'token', 'secret')
  ),
  'tokens live in the Worker environment; the database stores only the env var NAME'
);

select pg_temp.expect(
  'whatsapp accounts default to mock mode',
  (select column_default like '%mock%' from information_schema.columns
   where table_schema = 'public' and table_name = 'whatsapp_accounts' and column_name = 'provider_mode')
);

-- ============================================================================
-- SECTION 13 — Experiment integrity
-- ============================================================================

insert into public.outreach_experiments (id, key, name, status, min_sample_per_arm, cooldown_days)
values ('99990000-0000-0000-0000-000000000001', 'verify_experiment', 'Verify experiment', 'running', 30, 0);

insert into public.outreach_experiment_arms (id, experiment_id, arm_key, template_id, is_control)
values ('99990000-0000-0000-0000-00000000000a', '99990000-0000-0000-0000-000000000001', 'A',
        '33330000-0000-0000-0000-000000000001', true),
       ('99990000-0000-0000-0000-00000000000b', '99990000-0000-0000-0000-000000000001', 'B',
        '33330000-0000-0000-0000-000000000002', false);

insert into public.outreach_assignments (experiment_id, prospect_id, arm_id, assignment_hash)
values ('99990000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000001',
        '99990000-0000-0000-0000-00000000000a', 'hash-1');

do $$
begin
  insert into public.outreach_assignments (experiment_id, prospect_id, arm_id, assignment_hash)
  values ('99990000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000001',
          '99990000-0000-0000-0000-00000000000b', 'hash-2');
  perform pg_temp.record('a prospect CANNOT be re-randomised within an experiment', 'FAIL', 'the insert succeeded');
exception when unique_violation then
  perform pg_temp.record('a prospect CANNOT be re-randomised within an experiment', 'PASS');
when others then
  perform pg_temp.record('a prospect CANNOT be re-randomised within an experiment', 'FAIL', sqlerrm);
end $$;

-- A second RUNNING experiment must refuse to enrol the same prospect while
-- max_experiments_per_prospect is 1.
insert into public.outreach_experiments (id, key, name, status, max_experiments_per_prospect, cooldown_days)
values ('99990000-0000-0000-0000-000000000002', 'verify_experiment_2', 'Verify experiment 2', 'running', 1, 0);

insert into public.outreach_experiment_arms (id, experiment_id, arm_key, template_id, is_control)
values ('99990000-0000-0000-0000-00000000000c', '99990000-0000-0000-0000-000000000002', 'A',
        '33330000-0000-0000-0000-000000000001', true);

do $$
begin
  insert into public.outreach_assignments (experiment_id, prospect_id, arm_id, assignment_hash)
  values ('99990000-0000-0000-0000-000000000002', '22220000-0000-0000-0000-000000000001',
          '99990000-0000-0000-0000-00000000000c', 'hash-3');
  perform pg_temp.record('experiment exposure limits prevent conflicting simultaneous experiments', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record(
    'experiment exposure limits prevent conflicting simultaneous experiments',
    case when sqlerrm like '%running experiment%' then 'PASS' else 'FAIL' end,
    sqlerrm
  );
end $$;

select pg_temp.expect(
  'an experiment has at most one control arm',
  (select count(*) from public.outreach_experiment_arms
   where experiment_id = '99990000-0000-0000-0000-000000000001' and is_control) = 1
);

-- ============================================================================
-- SECTION 14 — ML registry integrity
-- ============================================================================

do $$
begin
  insert into public.ml_model_versions
    (model_key, model_version, model_type, target, feature_schema_version, is_active)
  values ('template_selector', 'verify-lr-1', 'logistic_regression', 'positive_reply', 'fs-v1', true);
  perform pg_temp.record('a model CANNOT be active without a documented promotion', 'FAIL', 'the insert succeeded');
exception when check_violation then
  perform pg_temp.record('a model CANNOT be active without a documented promotion', 'PASS');
when others then
  perform pg_temp.record('a model CANNOT be active without a documented promotion', 'FAIL', sqlerrm);
end $$;

insert into public.ml_model_versions
  (id, model_key, model_version, model_type, target, feature_schema_version,
   is_active, promoted_by, promoted_at, evaluation_notes)
values ('aaaa0000-0000-0000-0000-000000000001', 'template_selector', 'verify-lr-1',
        'logistic_regression', 'positive_reply', 'fs-v1', true,
        '11110000-0000-0000-0000-000000000001', now(), 'verify fixture: documented promotion');

do $$
begin
  insert into public.ml_model_versions
    (model_key, model_version, model_type, target, feature_schema_version,
     is_active, promoted_by, promoted_at, evaluation_notes)
  values ('template_selector', 'verify-lr-2', 'logistic_regression', 'positive_reply', 'fs-v1', true,
          '11110000-0000-0000-0000-000000000001', now(), 'second active model');
  perform pg_temp.record('only ONE model can be active per decision task', 'FAIL', 'a second active model was accepted');
exception when unique_violation then
  perform pg_temp.record('only ONE model can be active per decision task', 'PASS');
when others then
  perform pg_temp.record('only ONE model can be active per decision task', 'FAIL', sqlerrm);
end $$;

select pg_temp.expect(
  'the deterministic rule baseline is registered as a fallback',
  exists (
    select 1 from public.ml_model_versions
    where model_key = 'template_selector' and model_type = 'rule_baseline'
  )
);

select pg_temp.expect(
  'the feature schema declares a data-leakage denylist',
  (select cardinality(forbidden_features) from public.ml_feature_schemas where version = 'fs-v1') >= 5
);

select pg_temp.expect(
  'the leakage denylist covers the outcome columns',
  (select forbidden_features @> array['replied', 'positive_reply', 'delivered', 'read', 'activated', 'paid']
   from public.ml_feature_schemas where version = 'fs-v1')
);

insert into public.ml_predictions
  (prospect_id, template_id, model_version_id, target, predicted_probability, selected)
values ('22220000-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000001',
        'aaaa0000-0000-0000-0000-000000000001', 'positive_reply', 0.1234, false),
       ('22220000-0000-0000-0000-000000000001', '33330000-0000-0000-0000-000000000002',
        'aaaa0000-0000-0000-0000-000000000001', 'positive_reply', 0.2141, true);

select pg_temp.expect(
  'every candidate prediction is retained, not just the winner',
  (select count(*) from public.ml_predictions
   where prospect_id = '22220000-0000-0000-0000-000000000001') = 2
  and (select count(*) from public.ml_predictions
       where prospect_id = '22220000-0000-0000-0000-000000000001' and selected) = 1
);

-- ============================================================================
-- SECTION 15 — PLATFORM OWNER SECURITY (behavioural, per role)
-- ============================================================================
-- The important half. Each block SET ROLEs, sets the JWT claim the RLS
-- helpers read, and genuinely attempts the access.

-- ---- 15a. anon ----
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    -- Two outcomes are both correct and both secure: the table grant is
    -- absent (permission denied), or RLS admits no rows for anon. Only
    -- actually returning a row is a failure.
    select count(*) into v_count from public.prospects;
    perform pg_temp.expect('ANON cannot read prospects', v_count = 0, format('RLS returned %s rows', v_count));
  exception when insufficient_privilege then
    perform pg_temp.record('ANON cannot read prospects', 'PASS', 'permission denied');
  end;
end $$;

do $$
declare
  v_count int;
begin
  begin
    -- Two outcomes are both correct and both secure: the table grant is
    -- absent (permission denied), or RLS admits no rows for anon. Only
    -- actually returning a row is a failure.
    select count(*) into v_count from public.outreach_recipients;
    perform pg_temp.expect('ANON cannot read outreach recipients', v_count = 0, format('RLS returned %s rows', v_count));
  exception when insufficient_privilege then
    perform pg_temp.record('ANON cannot read outreach recipients', 'PASS', 'permission denied');
  end;
end $$;

do $$
declare
  v_count int;
begin
  begin
    -- Two outcomes are both correct and both secure: the table grant is
    -- absent (permission denied), or RLS admits no rows for anon. Only
    -- actually returning a row is a failure.
    select count(*) into v_count from public.whatsapp_messages;
    perform pg_temp.expect('ANON cannot read WhatsApp messages', v_count = 0, format('RLS returned %s rows', v_count));
  exception when insufficient_privilege then
    perform pg_temp.record('ANON cannot read WhatsApp messages', 'PASS', 'permission denied');
  end;
end $$;

reset role;

-- ---- 15b. an ordinary authenticated user who is NOT platform staff ----
-- This is the barber/customer case: authenticated, but with no
-- platform_members row.
set local role authenticated;
-- auth.uid() in the Supabase image reads the SCALAR request.jwt.claim.sub
-- GUC, which is what PostgREST sets per request. Setting the JSON
-- request.jwt.claims form instead would leave auth.uid() null and every
-- RLS helper would silently deny — making an insecure schema look secure.
set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospects;
  perform pg_temp.expect('BARBER (non-platform) cannot read prospects', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.booking_provider_observations;
  perform pg_temp.expect('BARBER cannot read competitor intelligence', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.outreach_recipients;
  perform pg_temp.expect('BARBER cannot read outreach recipients', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.whatsapp_messages;
  perform pg_temp.expect('BARBER cannot read WhatsApp messages', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.ml_predictions;
  perform pg_temp.expect('BARBER cannot read ML predictions', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospect_outreach_eligibility;
  perform pg_temp.expect('BARBER cannot read outreach eligibility', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.outreach_templates;
  perform pg_temp.expect('BARBER cannot read outreach templates', v_count = 0, format('saw %s rows', v_count));
end $$;

-- Writes must fail too, not merely return nothing.
do $$
begin
  insert into public.outreach_templates (key, name, channel, locale, body)
  values ('barber_injected', 'Injected', 'whatsapp', 'fr-FR', 'Bonjour');
  perform pg_temp.record('BARBER cannot create an outreach template', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('BARBER cannot create an outreach template', 'PASS', sqlerrm);
end $$;

do $$
begin
  update public.prospect_outreach_eligibility set is_eligible = true;
  perform pg_temp.expect(
    'BARBER cannot grant outreach eligibility',
    (select count(*) from public.prospect_outreach_eligibility where is_eligible) = 0,
    'the UPDATE matched no rows under RLS'
  );
exception when others then
  perform pg_temp.record('BARBER cannot grant outreach eligibility', 'PASS', sqlerrm);
end $$;

reset role;

-- ---- 15c. a second ordinary user: the customer case ----
set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000004';
set local request.jwt.claim.role = 'authenticated';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospects;
  perform pg_temp.expect('CUSTOMER cannot read prospects', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospect_fit_scores;
  perform pg_temp.expect('CUSTOMER cannot read prospect scores', v_count = 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.outreach_campaigns;
  perform pg_temp.expect('CUSTOMER cannot read campaigns', v_count = 0, format('saw %s rows', v_count));
end $$;

reset role;

-- ---- 15d. platform_support: read yes, write no ----
set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000002';
set local request.jwt.claim.role = 'authenticated';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospects;
  perform pg_temp.expect('PLATFORM SUPPORT can read prospects', v_count > 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.booking_provider_observations;
  perform pg_temp.expect('PLATFORM SUPPORT can read competitor intelligence', v_count > 0, format('saw %s rows', v_count));
end $$;

do $$
begin
  insert into public.outreach_templates (key, name, channel, locale, body)
  values ('support_injected', 'Injected', 'whatsapp', 'fr-FR', 'Bonjour');
  perform pg_temp.record('PLATFORM SUPPORT cannot create a template', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('PLATFORM SUPPORT cannot create a template', 'PASS', sqlerrm);
end $$;

do $$
begin
  perform public.approve_outreach_template('33330000-0000-0000-0000-000000000003');
  perform pg_temp.record('PLATFORM SUPPORT cannot approve a template', 'FAIL', 'the RPC succeeded');
exception when others then
  perform pg_temp.record('PLATFORM SUPPORT cannot approve a template', 'PASS', sqlerrm);
end $$;

do $$
begin
  perform public.promote_ml_model('aaaa0000-0000-0000-0000-000000000001', 'support attempting promotion');
  perform pg_temp.record('PLATFORM SUPPORT cannot promote a model', 'FAIL', 'the RPC succeeded');
exception when others then
  perform pg_temp.record('PLATFORM SUPPORT cannot promote a model', 'PASS', sqlerrm);
end $$;

reset role;

-- ---- 15e. platform_owner: full access ----
set local role authenticated;
set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospects;
  perform pg_temp.expect('PLATFORM OWNER can read prospects', v_count > 0, format('saw %s rows', v_count));
end $$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.outreach_recipients;
  perform pg_temp.expect('PLATFORM OWNER can read outreach recipients', v_count > 0, format('saw %s rows', v_count));
end $$;

do $$
begin
  perform public.approve_outreach_template('33330000-0000-0000-0000-000000000003');
  perform pg_temp.record('PLATFORM OWNER can approve a template', 'PASS');
exception when others then
  perform pg_temp.record('PLATFORM OWNER can approve a template', 'FAIL', sqlerrm);
end $$;

do $$
begin
  perform public.promote_ml_model('aaaa0000-0000-0000-0000-000000000001', 'verify: owner promotion path');
  perform pg_temp.record('PLATFORM OWNER can promote a model with a documented note', 'PASS');
exception when others then
  perform pg_temp.record('PLATFORM OWNER can promote a model with a documented note', 'FAIL', sqlerrm);
end $$;

do $$
begin
  perform public.promote_ml_model('aaaa0000-0000-0000-0000-000000000001', '   ');
  perform pg_temp.record('promotion REQUIRES a non-empty evaluation note', 'FAIL', 'the RPC accepted a blank note');
exception when others then
  perform pg_temp.record('promotion REQUIRES a non-empty evaluation note', 'PASS', sqlerrm);
end $$;

reset role;

-- ---- 15f. prospect_worker: the pipeline it needs, and nothing more ----
set local role prospect_worker;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.prospects;
  perform pg_temp.expect('WORKER can read prospects', v_count > 0, format('saw %s rows', v_count));
end $$;

do $$
begin
  insert into public.prospect_features (prospect_id, feature_key, value_bool, evidence_source)
  values ('22220000-0000-0000-0000-000000000001', 'worker_write_probe', 'TRUE', 'verify')
  on conflict (prospect_id, feature_key, feature_version) do nothing;
  perform pg_temp.record('WORKER can write prospect features', 'PASS');
exception when others then
  perform pg_temp.record('WORKER can write prospect features', 'FAIL', sqlerrm);
end $$;

do $$
begin
  insert into public.booking_provider_observations (prospect_id, provider_id, detection_method, confidence)
  select '22220000-0000-0000-0000-000000000003', id, 'script_domain', 0.9
  from public.booking_providers where key = 'FRESHA';
  perform pg_temp.record('WORKER can write competitor observations', 'PASS');
exception when others then
  perform pg_temp.record('WORKER can write competitor observations', 'FAIL', sqlerrm);
end $$;

-- The Worker must NOT be able to reach ordinary tenant business data.
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from public.organizations;
    perform pg_temp.expect('WORKER cannot read tenant organizations', v_count = 0, format('saw %s rows', v_count));
  exception when insufficient_privilege then
    perform pg_temp.record('WORKER cannot read tenant organizations', 'PASS', 'permission denied');
  end;
end $$;

do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from public.appointments;
    perform pg_temp.expect('WORKER cannot read customer appointments', v_count = 0, format('saw %s rows', v_count));
  exception when insufficient_privilege then
    perform pg_temp.record('WORKER cannot read customer appointments', 'PASS', 'permission denied');
  end;
end $$;

-- The Worker must not be able to rewrite its own audit trail.
do $$
begin
  update public.ml_predictions set predicted_probability = 0.99;
  perform pg_temp.record('WORKER cannot rewrite prediction history', 'FAIL', 'the update succeeded');
exception when others then
  perform pg_temp.record('WORKER cannot rewrite prediction history', 'PASS', sqlerrm);
end $$;

-- The eligibility gate binds the Worker exactly as it binds a client.
do $$
begin
  insert into public.outreach_recipients (campaign_id, prospect_id, state, template_id, rendered_body)
  values ('55550000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000002', 'queued',
          '33330000-0000-0000-0000-000000000001', 'Bonjour');
  perform pg_temp.record('WORKER cannot bypass the eligibility gate', 'FAIL', 'the insert succeeded');
exception when others then
  perform pg_temp.record('WORKER cannot bypass the eligibility gate', 'PASS', sqlerrm);
end $$;

reset role;

-- ============================================================================
-- SECTION 16 — Prospect privacy: acquisition data is not public product data
-- ============================================================================

select pg_temp.expect(
  'a prospect is not a marketplace entity (no organization_id on prospects)',
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prospects' and column_name = 'organization_id'
  ),
  'a prospect becomes public only through the controlled claim/activation workflow'
);

select pg_temp.expect(
  'no acquisition view is exposed to anon',
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name in ('competitor_analytics', 'outreach_funnel_stats', 'template_performance',
                         'experiment_results', 'prospect_score_distribution')
  )
);

-- Views must run with the caller's privileges, or a view owned by postgres
-- would bypass every RLS policy underneath it.
do $$
declare
  v text;
  views text[] := array['competitor_analytics', 'outreach_funnel_stats', 'template_performance',
                        'experiment_results', 'prospect_score_distribution'];
begin
  foreach v in array views loop
    perform pg_temp.expect(
      format('view %s runs with security_invoker', v),
      -- Postgres stores the boolean reloption as 'on'/'true' depending on
      -- how it was written; accept either rather than asserting on the
      -- serialisation.
      (select coalesce(
         (select option_value from pg_options_to_table(c.reloptions)
          where option_name = 'security_invoker'), 'false') in ('on', 'true')
       from pg_class c where c.oid = ('public.' || v)::regclass)
    );
  end loop;
end $$;

-- ============================================================================
-- SECTION 17 — Informational context
-- ============================================================================

select pg_temp.record('acquisition tables created', 'INFO',
  (select count(*)::text from information_schema.tables
   where table_schema = 'public'
     and table_name in (
       'booking_providers', 'booking_provider_observations', 'prospect_identity_matches',
       'prospect_features', 'prospect_data_quality', 'prospect_fit_scores',
       'prospect_score_rulesets', 'prospect_segments', 'prospect_segment_definitions',
       'prospect_locales', 'prospect_searches', 'prospect_search_partitions',
       'outreach_sales_angles', 'outreach_templates', 'prospect_outreach_eligibility',
       'outreach_channel_policies', 'outreach_campaigns', 'outreach_recipients',
       'outreach_events', 'whatsapp_accounts', 'whatsapp_template_mappings',
       'whatsapp_conversations', 'whatsapp_messages', 'whatsapp_webhook_events',
       'outreach_experiments', 'outreach_experiment_arms', 'outreach_assignments',
       'ml_feature_schemas', 'ml_datasets', 'ml_model_versions', 'ml_training_runs',
       'ml_predictions', 'ml_metrics')));

select pg_temp.record('booking providers registered', 'INFO',
  (select count(*)::text from public.booking_providers));

select pg_temp.record('prospect segments defined', 'INFO',
  (select count(*)::text from public.prospect_segment_definitions));

select pg_temp.record('sales angles defined', 'INFO',
  (select count(*)::text from public.outreach_sales_angles));

select pg_temp.record('RLS policies on acquisition tables', 'INFO',
  (select count(*)::text from pg_policies
   where schemaname = 'public'
     and tablename like any (array['booking_%', 'prospect_%', 'outreach_%', 'whatsapp_%', 'ml_%'])));

select pg_temp.record('discovery sources registered', 'INFO',
  (select count(*)::text from public.prospect_sources));

-- ============================================================================
-- RESULTS
-- ============================================================================

\echo ''
\echo '=========================================================================='
\echo 'VERIFY — Worker V2 / Platform Acquisition Intelligence'
\echo '=========================================================================='

select check_name, status, coalesce(detail, '') as detail
from verify_results
order by seq;

\echo ''
\echo '--- SUMMARY ---'

select status, count(*) as count
from verify_results
group by status
order by status;

\echo ''
\echo '--- FAILURES (expected: none) ---'

select check_name, coalesce(detail, '') as detail
from verify_results
where status = 'FAIL'
order by seq;

-- Everything above ran inside a transaction; roll it back so VERIFY leaves
-- no fixture rows behind and can be run again immediately.
rollback;
