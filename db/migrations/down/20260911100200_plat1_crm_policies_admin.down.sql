-- FadeUp — retour arrière de 20260911100200_plat1_crm_policies_admin.sql
--
-- Remet les 33 tables CRM possédées par supabase_admin sur les deux
-- expressions d'avant PLAT-1. À passer AVANT le retour arrière de
-- 20260911100100, qui supprime private.platform_can().
--
-- À APPLIQUER EN supabase_admin.

set lock_timeout = '5s';

begin;

do $$
declare
  v_tables text[] := array[
    'booking_provider_observations', 'booking_providers',
    'ml_datasets', 'ml_feature_schemas', 'ml_metrics', 'ml_model_versions',
    'ml_predictions', 'ml_training_runs',
    'outreach_assignments', 'outreach_campaigns', 'outreach_channel_policies',
    'outreach_events', 'outreach_experiment_arms', 'outreach_experiments',
    'outreach_recipients', 'outreach_sales_angles', 'outreach_templates',
    'prospect_data_quality', 'prospect_features', 'prospect_fit_scores',
    'prospect_identity_matches', 'prospect_locales',
    'prospect_outreach_eligibility', 'prospect_score_rulesets',
    'prospect_search_partitions', 'prospect_searches',
    'prospect_segment_definitions', 'prospect_segments',
    'whatsapp_accounts', 'whatsapp_conversations', 'whatsapp_messages',
    'whatsapp_template_mappings', 'whatsapp_webhook_events'
  ];
  v_staff text := '(select private.has_platform_role(array[''platform_owner'', ''platform_admin'', ''platform_support'']::public.platform_role[]))';
  v_admin text := '(select private.is_platform_admin())';
  r record;
  v_done integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(v_tables)
      and (p.policyname like '%\_select\_platform\_staff' or p.policyname like '%\_select\_platform'
        or p.policyname like '%\_write\_platform\_admin' or p.policyname like '%\_insert\_platform\_admin'
        or p.policyname like '%\_update\_platform\_admin' or p.policyname like '%\_delete\_platform\_admin')
    order by p.tablename, p.policyname
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    if r.cmd = 'SELECT' then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', r.policyname, r.tablename, v_staff);
    elsif r.cmd = 'INSERT' then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', r.policyname, r.tablename, v_admin);
    elsif r.cmd = 'UPDATE' then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', r.policyname, r.tablename, v_admin, v_admin);
    elsif r.cmd = 'DELETE' then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', r.policyname, r.tablename, v_admin);
    end if;
    v_done := v_done + 1;
  end loop;
  raise notice 'retour arrière PLAT-1 : % policies CRM (supabase_admin)', v_done;
end $$;

commit;
