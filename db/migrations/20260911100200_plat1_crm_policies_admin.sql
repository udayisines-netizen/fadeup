-- FadeUp — PLAT-1 (3/3) : le reste du CRM passe par la grille.
--
-- Même réécriture que la section 12 de 20260911100100, sur les 33 tables du
-- CRM qui appartiennent à supabase_admin et non à postgres — outreach_*, ml_*,
-- whatsapp_*, booking_provider*, et la moitié « science des données » des
-- prospect_*. Une policy ne se refait que par le propriétaire de sa table :
-- séparer les deux fichiers est ce qui évite la moitié de migration que la
-- règle 3 de DB_OWNERSHIP interdit.
--
-- Aucune de ces tables ne reçoit la visibilité par zone : un stagiaire n'a
-- rien à y faire, et `crm.read` l'en tient dehors entièrement. Le support et
-- le modérateur non plus — c'est le changement voulu.
--
-- À APPLIQUER EN supabase_admin (propriétaire des 33 tables — vérifié) :
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < db/migrations/20260911100200_plat1_crm_policies_admin.sql
--
-- Après 20260911100100 (private.platform_can committée).
-- Idempotent : sans risque à rejouer.

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
  r record;
  v_expr text;
  v_done integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.roles
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(v_tables)
      and (p.policyname like '%\_select\_platform\_staff' or p.policyname like '%\_select\_platform'
        or p.policyname like '%\_write\_platform\_admin' or p.policyname like '%\_insert\_platform\_admin'
        or p.policyname like '%\_update\_platform\_admin' or p.policyname like '%\_delete\_platform\_admin')
    order by p.tablename, p.policyname
  loop
    if r.roles <> '{authenticated}'::name[] then
      raise exception 'policy %.% cible % et non authenticated — réécriture interrompue',
        r.tablename, r.policyname, r.roles;
    end if;

    v_expr := case when r.cmd = 'SELECT' then 'crm.read' else 'crm.write' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.cmd = 'SELECT' then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    elsif r.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    elsif r.cmd = 'UPDATE' then
      execute format(
        'create policy %I on public.%I for update to authenticated using ((select private.platform_can(%L))) with check ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr, v_expr);
    elsif r.cmd = 'DELETE' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select private.platform_can(%L)))',
        r.policyname, r.tablename, v_expr);
    else
      raise exception 'commande % inattendue sur %.%', r.cmd, r.tablename, r.policyname;
    end if;

    v_done := v_done + 1;
  end loop;

  raise notice 'PLAT-1 : % policies CRM réécrites (supabase_admin)', v_done;

  if v_done = 0 then
    raise exception 'aucune policy CRM réécrite — la liste ne correspond plus au schéma';
  end if;
end $$;

commit;
