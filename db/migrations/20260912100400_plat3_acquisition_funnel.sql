-- FadeUp — PLAT-3 (5/5) : le tunnel d'acquisition, à l'échelle de la plateforme.
--
-- À APPLIQUER EN postgres. Ce fichier ne crée que des fonctions de LECTURE :
-- aucune table, aucune colonne, aucune policy, aucune donnée touchée.
--
-- POURQUOI PAS `get_platform_analytics_funnel`, QUI EXISTE DÉJÀ
--
-- Elle existe, elle est bonne, et elle répond à une autre question. Elle lit
-- `analytics_events`, le journal d'événements de R3. Mesuré en production le
-- 2026-09-12 : `external_profile_created`, `claim_submitted`, `claim_approved`
-- et `claim_rejected` comptent **zéro ligne** — alors que deux profils
-- externes existent bel et bien dans `prospect_professionals`. Les
-- déclencheurs d'émission existent ; les lignes, non. Construire le tunnel
-- d'acquisition sur ce journal aurait donc affiché des zéros FAUX, ce qui est
-- pire qu'un état vide honnête.
--
-- Ce fichier lit donc les TABLES OPÉRATIONNELLES, celles qui font autorité sur
-- chaque étape. `get_platform_analytics_funnel` n'est ni remplacée ni touchée :
-- elle continue de répondre à sa question (l'activité produit), celle-ci
-- répond à la sienne (la machine d'acquisition).
--
-- CE QUE LE SCHÉMA PERMET, ET OÙ IL CASSE — à lire avant de croire un chiffre
--
-- Les quatre premières étapes se rattachent à un prospect, donc à une ZONE
-- (par `prospect_locations`) et à une ORIGINE (`prospects.origin`) :
--
--   publiés   prospect_professionals -> professionals (is_public)
--   demandes  professional_interest_requests -> professional -> prospect
--   e-mails   email_outbox (stream 'prospecting') -> dedupe_key
--             'interest:<request_id>:<touche>' -> demande -> prospect
--   revendic. professional_claims -> professional -> prospect
--
-- Les DEUX DERNIÈRES, non, et c'est un défaut de schéma qu'il faut nommer
-- plutôt que masquer : rien ne relie une `organization` à un `prospect`.
-- `prospects.converted_organization_id` existe et compte **zéro ligne
-- renseignée** ; il n'y a aucune autre clé étrangère entre les deux mondes.
-- Un essai et un abonnement ne sont donc attribuables NI à une zone NI à une
-- origine. Quand on demande une ventilation, ces deux étapes rendent
-- `total = NULL` et `attributable = false` — et l'écran écrit « non
-- attribuable », jamais « 0 ».
--
-- LE SEUIL, ET LA COUPURE
--
-- Aucun taux n'est rendu au passage de `claims` à `trials` : la population
-- change de nature (un prospect d'un côté, une organisation de l'autre) et un
-- pourcentage y serait un chiffre exact répondant à une question fausse.
--
-- Aucun taux n'est rendu quand l'étape précédente compte moins de
-- `c_min_sample` cas. Vingt. Sous ce nombre, un passage de un à deux se lit
-- « +100 % » et ne veut rien dire. Le seuil est RENDU PAR LA FONCTION, pour
-- que l'écran affiche le nombre du serveur et non une constante recopiée.

begin;

create or replace function public.get_platform_acquisition_funnel(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_group_by text default 'none'
)
returns table (
  bucket_key text,
  bucket_label text,
  stage text,
  stage_order integer,
  total bigint,
  attributable boolean,
  conversion_rate numeric,
  rate_suppressed boolean,
  min_sample integer,
  window_from timestamptz,
  window_to timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  c_min_sample constant integer := 20;
  v_from timestamptz;
  v_to timestamptz;
  v_group text;
begin
  if (select auth.uid()) is null or not (select private.platform_can('crm.read')) then
    raise exception 'the acquisition funnel is restricted to FadeUp commercial staff'
      using errcode = '42501', detail = 'fadeup_funnel_refusal=not_authorized';
  end if;

  v_from := coalesce(p_from, now() - interval '90 days');
  v_to := coalesce(p_to, now());
  if v_to <= v_from then
    raise exception 'the end of the window must come after its start'
      using errcode = '22023', detail = 'fadeup_funnel_refusal=bad_window';
  end if;

  v_group := lower(coalesce(p_group_by, 'none'));
  if v_group not in ('none', 'zone', 'origin') then
    raise exception 'group_by must be none, zone or origin'
      using errcode = '22023', detail = 'fadeup_funnel_refusal=bad_group';
  end if;

  return query
  with
  -- Le rattachement d'un prospect à sa zone et à son origine, une fois pour
  -- toutes. `private.platform_zone_key` rend NULL sur une ville vide : un
  -- prospect sans ville ne tombe dans aucune zone, exactement comme dans la
  -- visibilité de PLAT-1. Une donnée manquante ne devient jamais une
  -- attribution.
  prospect_dim as (
    select
      p.id as prospect_id,
      p.origin::text as origin,
      z.id as zone_id,
      z.label as zone_label
    from public.prospects p
    left join public.prospect_locations pl
      on pl.prospect_id = p.id and pl.is_primary
    left join public.platform_zones z
      on z.country = pl.country
     and z.city_key = private.platform_zone_key(pl.city)
     and z.is_active
  ),
  professional_dim as (
    select pp.professional_id, d.zone_id, d.zone_label, d.origin
    from public.prospect_professionals pp
    join prospect_dim d on d.prospect_id = pp.prospect_id
  ),
  events as (
    -- 1. PUBLIÉS
    select 'published'::text as stage, 1 as stage_order, true as attributable,
           d.zone_id, d.zone_label, d.origin
    from public.prospect_professionals pp
    join public.professionals pro on pro.id = pp.professional_id
    join prospect_dim d on d.prospect_id = pp.prospect_id
    where pro.is_public
      and pp.created_at >= v_from and pp.created_at < v_to

    union all
    -- 2. DEMANDES REÇUES
    select 'requests', 2, true, d.zone_id, d.zone_label, d.origin
    from public.professional_interest_requests r
    join professional_dim d on d.professional_id = r.professional_id
    where r.created_at >= v_from and r.created_at < v_to

    union all
    -- 3. E-MAILS DE PROSPECTION PARTIS
    --    `sent_at` et non `created_at` : une ligne en file n'est pas un
    --    e-mail envoyé. La clé de déduplication porte l'identifiant de la
    --    demande — c'est le seul lien entre l'outbox et le prospect, l'outbox
    --    n'ayant ni prospect_id ni organization_id.
    select 'emails', 3, true, d.zone_id, d.zone_label, d.origin
    from public.email_outbox o
    join public.professional_interest_requests r
      on o.dedupe_key like 'interest:%'
     and r.id = nullif(split_part(o.dedupe_key, ':', 2), '')::uuid
    join professional_dim d on d.professional_id = r.professional_id
    where o.stream = 'prospecting'
      and o.sent_at is not null
      and o.sent_at >= v_from and o.sent_at < v_to

    union all
    -- 4. REVENDICATIONS DÉPOSÉES
    select 'claims', 4, true, d.zone_id, d.zone_label, d.origin
    from public.professional_claims c
    join professional_dim d on d.professional_id = c.professional_id
    where c.submitted_at >= v_from and c.submitted_at < v_to

    union all
    -- 5. ESSAIS DÉMARRÉS — non attribuables (voir l'en-tête).
    select 'trials', 5, false, null::uuid, null::text, null::text
    from public.organization_trials t
    where t.started_at >= v_from and t.started_at < v_to

    union all
    -- 6. ABONNEMENTS — non attribuables, même raison.
    --    La source de vérité est `commercial_plan_changes`, journal en ajout
    --    seul : on compte les passages à un plan payant PAR LA FACTURATION,
    --    jamais une concession interne (`platform_grant`), qui ne prouve
    --    aucune conversion commerciale.
    select 'subscriptions', 6, false, null::uuid, null::text, null::text
    from public.commercial_plan_changes ch
    where ch.entitlement_source = 'billing'
      and ch.new_plan_key <> 'free'
      and ch.new_status = 'active'
      and ch.created_at >= v_from and ch.created_at < v_to
  ),
  bucketed as (
    select
      case v_group
        when 'zone' then coalesce(e.zone_id::text, 'unzoned')
        when 'origin' then coalesce(e.origin, 'unknown')
        else 'all'
      end as bucket_key,
      case v_group
        when 'zone' then coalesce(e.zone_label, '')
        when 'origin' then coalesce(e.origin, '')
        else ''
      end as bucket_label,
      e.stage, e.stage_order, e.attributable
    from events e
    -- Une étape non attribuable n'entre dans AUCUN seau quand on ventile :
    -- la ranger sous « inconnu » la ferait passer pour une donnée manquante
    -- alors que c'est le schéma qui ne la porte pas.
    where v_group = 'none' or e.attributable
  ),
  counted as (
    select b.bucket_key, b.bucket_label, b.stage, b.stage_order,
           count(*)::bigint as total
    from bucketed b
    group by 1, 2, 3, 4
  ),
  buckets as (
    select distinct c.bucket_key, c.bucket_label from counted c
    union
    select 'all', '' where v_group = 'none'
  ),
  stages(stage, stage_order, attributable) as (
    values ('published', 1, true), ('requests', 2, true), ('emails', 3, true),
           ('claims', 4, true), ('trials', 5, false), ('subscriptions', 6, false)
  ),
  grid as (
    select b.bucket_key, b.bucket_label, s.stage, s.stage_order, s.attributable,
           case when v_group <> 'none' and not s.attributable then null
                else coalesce(c.total, 0) end as total
    from buckets b
    cross join stages s
    left join counted c
      on c.bucket_key = b.bucket_key and c.stage = s.stage
  ),
  with_previous as (
    select g.*,
           lag(g.total) over (partition by g.bucket_key order by g.stage_order) as previous_total,
           lag(g.attributable) over (partition by g.bucket_key order by g.stage_order) as previous_attributable
    from grid g
  )
  select
    w.bucket_key, w.bucket_label, w.stage, w.stage_order, w.total,
    -- Quand on ventile, les deux dernières étapes ne sont pas attribuables ;
    -- sans ventilation, tout l'est.
    (v_group = 'none') or w.attributable,
    -- LE TAUX, seulement au-dessus du seuil, et seulement quand les deux
    -- étapes sont comparables.
    case
      when w.previous_total is null or w.total is null then null
      -- LA COUPURE D'ATTRIBUTION N'EST PAS UNE CONVERSION. Entre
      -- `claims` (rattaché à un prospect) et `trials` (rattaché à une
      -- organisation), la POPULATION change : sur 106 essais en base, 105
      -- viennent de salons qui n'ont jamais été des prospects. Un « taux »
      -- entre ces deux étapes serait un nombre juste répondant à une question
      -- que personne ne pose. Il n'est donc pas rendu — et l'écran dit
      -- pourquoi.
      when w.previous_attributable and not w.attributable then null
      when w.previous_total < c_min_sample then null
      when w.previous_total = 0 then null
      else round(100.0 * w.total / w.previous_total, 1)
    end,
    -- « Pas assez de données » se dit, il ne se devine pas à un champ vide.
    (w.previous_total is not null and w.total is not null
     and w.previous_total > 0 and w.previous_total < c_min_sample
     and not (w.previous_attributable and not w.attributable)),
    c_min_sample,
    v_from, v_to
  from with_previous w
  order by w.bucket_key, w.stage_order;
end;
$function$;

comment on function public.get_platform_acquisition_funnel(timestamptz, timestamptz, text) is
  'Le tunnel d''acquisition de MASTER_SPEC §5, lu dans les tables opérationnelles : publiés, demandes, e-mails partis, revendications, essais, abonnements. Ventilable par zone ou par origine pour les quatre premières étapes SEULEMENT — rien ne relie une organisation à un prospect, et les deux dernières rendent NULL plutôt qu''un zéro faux. Aucun taux sous 20 cas.';

revoke all on function public.get_platform_acquisition_funnel(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.get_platform_acquisition_funnel(timestamptz, timestamptz, text) to authenticated;

commit;
