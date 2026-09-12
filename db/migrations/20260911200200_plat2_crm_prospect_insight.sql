-- FadeUp — PLAT-2 (3/4) : ce que le commercial doit voir avant d'appeler.
--
-- À APPLIQUER EN postgres. Aucun objet existant n'est redéfini : ce fichier
-- n'ajoute que deux fonctions de lecture et un résumé de pipeline. Aucune
-- policy n'est touchée, aucune table n'est créée.
--
-- POURQUOI CE FICHIER EXISTE
--
-- R3 a construit le moteur d'événements ; `analytics_events` porte
-- `professional_id`, `organization_id` et `prospect_id`. MASTER_SPEC §5 dit
-- « Les statistiques du prospect — vues réelles, follows, tentatives de
-- réservation — lui sont montrées : c'est un levier commercial de premier
-- plan. » AUCUN écran ne les montrait.
--
-- CE QUE CES FONCTIONS NE FONT JAMAIS
--
-- Elles ne fabriquent rien. Un prospect qui n'est pas publié n'a pas de vues :
-- la fonction rend `is_published = false` et des ZÉROS, jamais une estimation.
-- C'est la règle « données réelles » du CLAUDE.md, et c'est aussi ce qui rend
-- l'argument de vente utilisable : un commercial qui cite un chiffre inventé
-- le découvre au pire moment.
--
-- LA GARDE. `private.platform_prospect_visible()` de PLAT-1 tranche en trois
-- issues explicites et traite le cas nul. Le support, le modérateur et
-- l'extérieur obtiennent `false` ; le stagiaire, seulement ses zones et ses
-- propres saisies. La même question qu'ailleurs, pas une deuxième.

begin;

create or replace function public.get_prospect_acquisition_stats(
  p_prospect_id uuid,
  p_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_professional_id uuid;
  v_is_public boolean := false;
  v_claim public.professional_claim_state;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
begin
  -- Le cas nul EXPLICITEMENT, avant toute lecture.
  if v_actor is null or p_prospect_id is null
     or not (select private.platform_prospect_visible(p_prospect_id)) then
    raise exception 'ce prospect n''est pas visible avec votre rôle'
      using errcode = '42501', detail = 'fadeup_crm_refusal=prospect_not_visible';
  end if;

  select pp.professional_id, pr.is_public, pr.claim_state
    into v_professional_id, v_is_public, v_claim
  from public.prospect_professionals pp
  join public.professionals pr on pr.id = pp.professional_id
  where pp.prospect_id = p_prospect_id;

  return jsonb_build_object(
    'prospect_id', p_prospect_id,
    'window_days', greatest(coalesce(p_days, 90), 1),
    'since', v_since,
    -- CE QUI EXPLIQUE LES ZÉROS. Sans ce drapeau, un commercial lit « 0 vue »
    -- et croit que le salon n'intéresse personne, alors que sa fiche n'est
    -- pas en ligne.
    'is_published', v_professional_id is not null and coalesce(v_is_public, false),
    'professional_id', v_professional_id,
    'claim_state', v_claim,
    'profile_views', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.analytics_events e
      where e.event_name = 'public_profile_viewed'
        and e.professional_id = v_professional_id
        and e.occurred_at >= v_since) end,
    'profile_views_all_time', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.analytics_events e
      where e.event_name = 'public_profile_viewed'
        and e.professional_id = v_professional_id) end,
    'last_profile_view_at', case when v_professional_id is null then null else (
      select max(e.occurred_at) from public.analytics_events e
      where e.event_name = 'public_profile_viewed'
        and e.professional_id = v_professional_id) end,
    -- TENTATIVES DE RÉSERVATION. Deux sources, distinctes et toutes deux
    -- réelles : le tunnel ouvert (`booking_started`) et la demande d'intérêt
    -- effectivement déposée (B2). La seconde est l'argument le plus fort —
    -- c'est un client qui a laissé ses coordonnées.
    'booking_started', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.analytics_events e
      where e.event_name = 'booking_started'
        and e.professional_id = v_professional_id
        and e.occurred_at >= v_since) end,
    'interest_requests', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.professional_interest_requests r
      where r.professional_id = v_professional_id
        and r.created_at >= v_since) end,
    'interest_requests_pending', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.professional_interest_requests r
      where r.professional_id = v_professional_id
        and r.status = 'pending' and r.expires_at > now()) end,
    'followers', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.professional_follows f
      where f.professional_id = v_professional_id and f.state = 'following') end,
    'search_result_views', case when v_professional_id is null then 0 else (
      select count(*)::integer from public.analytics_events e
      where e.event_name = 'search_result_viewed'
        and e.professional_id = v_professional_id
        and e.occurred_at >= v_since) end
  );
end;
$function$;

comment on function public.get_prospect_acquisition_stats(uuid, integer) is
  'PLAT-2 : les statistiques RÉELLES d''un prospect (R3). Un prospect non publié rend is_published=false et des zéros — jamais une estimation.';

-- L'ÉTAT DES RELANCES. B2 tient la cadence lui-même (trois touches, heures
-- calmes 8 h–21 h dans le fuseau du destinataire, désabonnement définitif).
-- Le commercial doit VOIR où en est chaque prospect — et surtout voir POURQUOI
-- une relance n'est pas partie — au lieu de relancer à la main par-dessus.
create or replace function public.get_prospect_outreach_state(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_prospect public.prospects;
begin
  if v_actor is null or p_prospect_id is null
     or not (select private.platform_prospect_visible(p_prospect_id)) then
    raise exception 'ce prospect n''est pas visible avec votre rôle'
      using errcode = '42501', detail = 'fadeup_crm_refusal=prospect_not_visible';
  end if;

  select * into v_prospect from public.prospects where id = p_prospect_id;
  if not found then
    raise exception 'prospect introuvable' using errcode = '42704';
  end if;

  return jsonb_build_object(
    'prospect_id', p_prospect_id,
    'do_not_contact', v_prospect.do_not_contact,
    'has_email', v_prospect.email is not null,
    'suppressed', exists (
      select 1 from public.prospect_suppressions s
      where s.scope = 'prospect' and s.prospect_id = p_prospect_id),
    -- Le motif de blocage calculé par B2 lui-même : une seconde implémentation
    -- ici finirait par diverger de celle qui décide vraiment.
    'block_reason', (select public.outreach_block_reason(p_prospect_id, 'email')),
    -- LES TOUCHES, telles que B2 les compte : une ligne d'email_outbox par
    -- touche, repérée par son dedupe_key `interest:<demande>:<n>`.
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_id', r.id,
               'status', r.status,
               'service_label', r.service_label,
               'preferred_starts_at', r.preferred_starts_at,
               'expires_at', r.expires_at,
               'touches_sent', (
                 select count(*)::integer from public.email_outbox o
                 where o.dedupe_key like 'interest:' || r.id::text || ':%'),
               'touches', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'touch', split_part(o.dedupe_key, ':', 3),
                          'template', o.template,
                          'status', o.status,
                          'created_at', o.created_at,
                          'sent_at', o.sent_at,
                          'delivered_at', o.delivered_at,
                          'opened_at', o.opened_at,
                          'bounced_at', o.bounced_at)
                        order by o.created_at)
                 from public.email_outbox o
                 where o.dedupe_key like 'interest:' || r.id::text || ':%'), '[]'::jsonb))
             order by r.created_at desc)
      from public.professional_interest_requests r
      join public.prospect_professionals pp on pp.professional_id = r.professional_id
      where pp.prospect_id = p_prospect_id
    ), '[]'::jsonb),
    -- Les échanges saisis à la main par un commercial, qui ne sont PAS des
    -- relances automatiques et ne doivent pas se confondre avec elles.
    'logged_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', po.id, 'channel', po.channel, 'direction', po.direction,
               'summary', po.summary, 'occurred_at', po.occurred_at)
             order by po.occurred_at desc)
      from public.prospect_outreach po where po.prospect_id = p_prospect_id
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.get_prospect_outreach_state(uuid) is
  'PLAT-2 : où en sont les trois relances automatiques de B2 pour ce prospect, et pourquoi la prochaine ne part pas.';

-- LE PIPELINE, avec LES DEUX ORIGINES QUE PLAT-1 A DISTINGUÉES. Un salon vu
-- de ses yeux par un stagiaire ne vaut pas une fiche scrapée, et le
-- commercial doit le savoir AVANT d'appeler — donc dans le comptage, pas
-- seulement sur la fiche.
create or replace function public.get_sales_pipeline_summary()
returns table (
  status public.prospect_pipeline_stage,
  origin public.prospect_origin,
  prospect_count integer,
  published_count integer,
  contacted_count integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    p.status,
    p.origin,
    count(*)::integer,
    count(*) filter (where exists (
      select 1 from public.prospect_professionals pp
      join public.professionals pr on pr.id = pp.professional_id
      where pp.prospect_id = p.id and pr.is_public))::integer,
    count(*) filter (where exists (
      select 1 from public.prospect_outreach po where po.prospect_id = p.id))::integer
  from public.prospects p
  where (select private.platform_can('crm.read'))
  group by p.status, p.origin
  order by p.status, p.origin;
$function$;

comment on function public.get_sales_pipeline_summary() is
  'PLAT-2 : le tunnel d''acquisition (MASTER_SPEC §5) compté par statut ET par origine (worker / terrain). Réservé à crm.read — un stagiaire n''a pas de vue d''ensemble.';

revoke all on function public.get_prospect_acquisition_stats(uuid, integer) from public, anon;
grant execute on function public.get_prospect_acquisition_stats(uuid, integer) to authenticated;

revoke all on function public.get_prospect_outreach_state(uuid) from public, anon;
grant execute on function public.get_prospect_outreach_state(uuid) to authenticated;

revoke all on function public.get_sales_pipeline_summary() from public, anon;
grant execute on function public.get_sales_pipeline_summary() to authenticated;

commit;
