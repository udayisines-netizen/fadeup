-- FadeUp — OS-3 : les insights professionnels.
--
-- RÔLE D'APPLICATION : postgres (fonctions NEUVES, aucune redéfinition).
--
-- POURQUOI CE FICHIER EXISTE
--
-- R3 a construit le moteur d'analytique (`analytics_events`, quatre contrats
-- de lecture). Aucun écran ne l'affiche, et trois rapports le signalent comme
-- le levier commercial manquant. OS-3 ouvre l'écran — mais pas en branchant
-- `get_organization_analytics_summary` tel quel, pour trois raisons nommées :
--
-- 1. LA BASE DE CALCUL. Le contrat R3 compte des ÉVÉNEMENTS : il commence à la
--    date de sa migration, ne rattrape rien, et B5 dé-identifie ses acteurs à
--    l'effacement d'un compte. `private.customer_visit_stats` (OS-2) compte
--    des LIGNES de `appointments`/`queue_entries` : tout l'historique. Un
--    écran qui mélange les deux affiche deux totaux différents du même
--    nombre. OS-3 choisit UNE base par chiffre et le dit : état pour tout ce
--    que l'état porte, événement pour ce que seul l'événement porte (les vues
--    de profil, qui ne laissent aucune trace en base).
--
-- 2. LE RÔLE. `get_organization_analytics_summary` exige owner/manager. Un
--    barber salarié doit pouvoir ouvrir ses insights — sans y voir le revenu
--    du salon (réglage OS-1). Un écran qui appelle le contrat R3 rendrait un
--    42501 à un barber au lieu d'une page sans revenu. La garde d'ici est
--    donc `private.is_org_member`, et le MASQUAGE du revenu est un
--    `private.can_view_revenue` par colonne — NULL, jamais zéro.
--
-- 3. LE REVENU N'EXISTE NULLE PART. Aucune agrégation de `price_cents`
--    n'existe en base (vérifié : zéro `sum(price_cents)` dans toutes les
--    migrations). Le revenu calculé du jour, sur l'accueil, est une somme
--    CÔTÉ CLIENT des prix des prestations terminées. Un barber sans droit
--    reçoit déjà `price_cents` à NULL de `get_calendar_appointments`, donc la
--    somme client était sûre ; sur une PÉRIODE, sommer côté client
--    obligerait à télécharger tous les rendez-vous du mois. La somme monte
--    donc en base, avec la même garde.
--
-- CE QUE CE FICHIER NE FAIT PAS
--
-- Il ne touche à AUCUNE fonction existante : ni le contrat R3, ni
-- `get_service_duration_insights`, ni `list_organization_customers`. Rien
-- n'est redéfini, donc aucune ACL n'est à re-matérialiser.
--
-- AUCUN CHIFFRE INVENTÉ. `first_activity_at` dit depuis quand l'organisation
-- a une vie mesurable ; `analytics_since` dit depuis quand les VUES sont
-- mesurées (l'instrumentation R3 est postérieure à la plupart des comptes) ;
-- `comparison_available` dit si une tendance a le droit d'exister. L'écran
-- n'affiche une variation que si ce booléen est vrai — c'est le « pas de
-- +12 % sur trois jours d'historique » du contrat de design, décidé en base
-- plutôt que deviné à l'écran.
--
-- LE MOTIF NUL (X3) : l'organisation est résolue PUIS testée `is null` avant
-- toute garde ; `private.is_org_member` et `private.can_view_revenue`
-- évaluent une EXISTENCE (elles ne comparent jamais une colonne à
-- `auth.uid()` en laissant NULL passer). La fenêtre est bornée AVANT usage.

begin;

-- ---------------------------------------------------------------------------
-- 1. La fenêtre — bornée, et sa jumelle immédiatement précédente
-- ---------------------------------------------------------------------------
-- `private.analytics_window` (R3) fait déjà ce travail mais est réservée aux
-- contrats R3 et ne rend pas la fenêtre précédente. Plutôt que de la
-- redéfinir — elle appartient à R3 et ses quatre appelants en dépendent —
-- OS-3 l'APPELLE et ajoute le décalage. Les bornes R3 (30 jours par défaut,
-- 730 jours au maximum, `from < to`) valent donc aussi ici.

create or replace function private.insights_window(
  p_from timestamptz default null,
  p_to timestamptz default null,
  out window_from timestamptz,
  out window_to timestamptz,
  out previous_from timestamptz,
  out previous_to timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_span interval;
begin
  select w.window_from, w.window_to
    into window_from, window_to
  from private.analytics_window(p_from, p_to) w;

  v_span := window_to - window_from;
  previous_to := window_from;
  previous_from := window_from - v_span;
end;
$$;

comment on function private.insights_window(timestamptz, timestamptz) is
'La fenêtre d''insights et la fenêtre de MÊME DURÉE qui la précède immédiatement. Délègue le bornage à private.analytics_window (R3) : mêmes défauts, mêmes refus.';

revoke all on function private.insights_window(timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Le revenu calculé d'une fenêtre — la somme, avec la garde d'OS-1
-- ---------------------------------------------------------------------------
-- Une prestation TERMINÉE est l'union des rendez-vous `completed` et des
-- passages de file `completed` : la définition d'OS-2
-- (`private.customer_visit_stats`), re-signée ici parce que la fenêtre
-- change la question (OS-2 agrège par client sur tout l'historique, ici on
-- agrège par organisation sur une période). Le prix est celui du CATALOGUE
-- COURANT — il n'existe aucun instantané de prix en base (OS-1 §12.8,
-- OS-2 §12.2, question ouverte) et l'interface le nomme « revenu calculé ».

create or replace function private.organization_delivered_in_window(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  delivered_at timestamptz,
  service_id uuid,
  price_cents integer,
  customer_id uuid,
  source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(a.completed_at, a.ends_at) as delivered_at,
    a.service_id,
    s.price_cents,
    a.customer_id,
    'appointment'::text
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.organization_id = p_organization_id
    and a.status = 'completed'
    and coalesce(a.completed_at, a.ends_at) >= p_from
    and coalesce(a.completed_at, a.ends_at) < p_to
  union all
  select
    q.completed_at,
    q.service_id,
    s.price_cents,
    q.customer_id,
    'queue'::text
  from public.queue_entries q
  left join public.services s on s.id = q.service_id
  where q.organization_id = p_organization_id
    and q.status = 'completed'
    and q.completed_at is not null
    and q.completed_at >= p_from
    and q.completed_at < p_to;
$$;

comment on function private.organization_delivered_in_window(uuid, timestamptz, timestamptz) is
'Les prestations réellement TERMINÉES d''une organisation sur une fenêtre : union des rendez-vous completed et des passages de file completed (la définition d''OS-2). Le prix est celui du catalogue COURANT, et peut être NULL (prestation dont le service a été supprimé) — un NULL ne devient jamais zéro.';

revoke all on function private.organization_delivered_in_window(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. LE contrat d'insights
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_insights(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  window_from timestamptz,
  window_to timestamptz,
  first_activity_at timestamptz,
  analytics_since timestamptz,
  comparison_available boolean,
  revenue_visible boolean,
  currency text,
  fadeup_bookings integer,
  fadeup_customers integer,
  counter_bookings integer,
  requests_received integer,
  requests_converted integer,
  profile_views integer,
  new_followers integer,
  services_delivered integer,
  no_show_count integer,
  revenue_cents bigint,
  average_ticket_cents integer,
  no_show_cost_cents bigint,
  new_customers integer,
  returning_customers integer,
  lapsed_customers integer,
  previous_fadeup_bookings integer,
  previous_requests_received integer,
  previous_services_delivered integer,
  previous_profile_views integer,
  previous_new_followers integer,
  previous_revenue_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_win record;
  v_sees_revenue boolean;
  v_currency text;
  v_first timestamptz;
  v_analytics_since timestamptz;
begin
  -- Le motif nul : l'argument est testé AVANT la garde, et « pas membre »,
  -- « pas à moi » et « n'existe pas » reçoivent le même refus — sinon la RPC
  -- devient un oracle d'existence d'organisation.
  if p_organization_id is null
     or not (select private.is_org_member(p_organization_id)) then
    raise exception 'not authorized to read insights for this organization'
      using errcode = '42501',
            detail = 'fadeup_insights_refusal=not_authorized';
  end if;

  select * into v_win from private.insights_window(p_from, p_to);

  -- OS-1 §3 : owner/manager voient toujours, un barber selon le réglage du
  -- patron, un réceptionniste jamais. La fonction porte la règle entière ;
  -- l'écran ne fait que ne pas rendre ce qui est NULL.
  v_sees_revenue := (select private.can_view_revenue(p_organization_id));

  select o.currency into v_currency from public.organizations o where o.id = p_organization_id;

  -- Depuis quand cette organisation a une vie mesurable. Sert à distinguer
  -- « zéro ce mois-ci » (vrai zéro) de « rien à montrer » (état vide).
  select least(
    (select min(a.created_at) from public.appointments a where a.organization_id = p_organization_id),
    (select min(q.created_at) from public.queue_entries q where q.organization_id = p_organization_id)
  ) into v_first;

  -- Depuis quand les VUES DE PROFIL sont mesurées. L'instrumentation R3 est
  -- postérieure à la plupart des organisations : dire « 0 vue » sur une
  -- période antérieure à l'instrumentation serait un mensonge.
  select min(e.occurred_at) into v_analytics_since
  from public.analytics_events e
  where e.organization_id = p_organization_id;

  return query
  with
  -- Ce que FadeUp a apporté : les réservations qui ne sont PAS entrées par le
  -- comptoir. `created_by` est NULL quand la ligne vient du tunnel public
  -- (`book_public_appointment`) et porte le membre du comptoir quand elle
  -- vient de `create_appointment_as_business`. C'est le seul discriminant
  -- honnête d'origine que la table porte.
  booked as (
    select
      a.id,
      a.created_by,
      a.was_request,
      a.status,
      a.resolution,
      coalesce(a.customer_id::text, a.booked_by_user_id::text, lower(a.customer_email), a.id::text) as identity
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.created_at >= v_win.window_from
      and a.created_at < v_win.window_to
  ),
  booked_prev as (
    select a.id, a.created_by, a.was_request
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.created_at >= v_win.previous_from
      and a.created_at < v_win.previous_to
  ),
  delivered as (
    select * from private.organization_delivered_in_window(p_organization_id, v_win.window_from, v_win.window_to)
  ),
  delivered_prev as (
    select * from private.organization_delivered_in_window(p_organization_id, v_win.previous_from, v_win.previous_to)
  ),
  -- Les absences de la fenêtre, au tarif catalogue courant.
  absences as (
    select s.price_cents
    from public.appointments a
    left join public.services s on s.id = a.service_id
    where a.organization_id = p_organization_id
      and a.status = 'no_show'
      and a.starts_at >= v_win.window_from
      and a.starts_at < v_win.window_to
  ),
  -- Nouveau / revenu : la première prestation du client, sur TOUT
  -- l'historique, tombe-t-elle dans la fenêtre ?
  visit_stats as (
    select * from private.customer_visit_stats(p_organization_id)
  ),
  customers_window as (
    select
      v.customer_id,
      v.first_completed_at,
      v.completed_count,
      v.last_completed_at
    from visit_stats v
    where v.last_completed_at >= v_win.window_from
      and v.last_completed_at < v_win.window_to
  ),
  lapsed as (
    select count(*)::integer as n
    from visit_stats v
    where v.completed_count >= 3
      and v.last_completed_at > v.first_completed_at
      -- La règle d'OS-2, à l'identique : 1,75 × l'intervalle observé du
      -- client ET au moins 30 jours. Moins de trois prestations = aucun
      -- cycle, donc jamais « en retard ».
      and (extract(epoch from (now() - v.last_completed_at)) / 86400.0) >= 30
      and (extract(epoch from (now() - v.last_completed_at)) / 86400.0)
          > 1.75 * greatest(1, round((extract(epoch from (v.last_completed_at - v.first_completed_at)) / 86400.0) / (v.completed_count - 1)))
  ),
  views as (
    select count(*)::integer as n
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.event_name = 'public_profile_viewed'
      and e.occurred_at >= v_win.window_from
      and e.occurred_at < v_win.window_to
  ),
  views_prev as (
    select count(*)::integer as n
    from public.analytics_events e
    where e.organization_id = p_organization_id
      and e.event_name = 'public_profile_viewed'
      and e.occurred_at >= v_win.previous_from
      and e.occurred_at < v_win.previous_to
  ),
  follows as (
    select count(*)::integer as n
    from public.organization_follows f
    where f.organization_id = p_organization_id
      and f.is_following
      and f.followed_at >= v_win.window_from
      and f.followed_at < v_win.window_to
  ),
  follows_prev as (
    select count(*)::integer as n
    from public.organization_follows f
    where f.organization_id = p_organization_id
      and f.is_following
      and f.followed_at >= v_win.previous_from
      and f.followed_at < v_win.previous_to
  )
  select
    v_win.window_from,
    v_win.window_to,
    v_first,
    v_analytics_since,
    -- UNE TENDANCE N'EXISTE QUE SI ELLE PEUT EXISTER : une fenêtre d'au
    -- moins sept jours, et une activité qui commence AVANT la fenêtre de
    -- comparaison. « +12 % » sur trois jours d'historique est interdit par
    -- le contrat de design ; c'est ici qu'on le refuse.
    (v_win.window_to - v_win.window_from >= interval '7 days'
      and v_first is not null
      and v_first <= v_win.previous_from),
    v_sees_revenue,
    v_currency,
    (select count(*) from booked where created_by is null)::integer,
    (select count(distinct identity) from booked where created_by is null)::integer,
    (select count(*) from booked where created_by is not null)::integer,
    (select count(*) from booked where was_request)::integer,
    (select count(*) from booked where was_request and status in ('confirmed', 'completed'))::integer,
    (select n from views),
    (select n from follows),
    (select count(*) from delivered)::integer,
    (select count(*) from absences)::integer,
    -- Le revenu, les absences en euros et le panier moyen : NULL, jamais
    -- zéro, à qui n'a pas le droit de les voir.
    case when v_sees_revenue then (select coalesce(sum(price_cents), 0) from delivered)::bigint end,
    case
      when v_sees_revenue and (select count(*) from delivered) > 0
      then round((select coalesce(sum(price_cents), 0) from delivered)::numeric / (select count(*) from delivered))::integer
    end,
    case when v_sees_revenue then (select coalesce(sum(price_cents), 0) from absences)::bigint end,
    (select count(*) from customers_window where first_completed_at >= v_win.window_from)::integer,
    (select count(*) from customers_window where first_completed_at < v_win.window_from)::integer,
    (select n from lapsed),
    (select count(*) from booked_prev where created_by is null)::integer,
    (select count(*) from booked_prev where was_request)::integer,
    (select count(*) from delivered_prev)::integer,
    (select n from views_prev),
    (select n from follows_prev),
    case when v_sees_revenue then (select coalesce(sum(price_cents), 0) from delivered_prev)::bigint end;
end;
$$;

comment on function public.get_organization_insights(uuid, timestamptz, timestamptz) is
'Les insights d''une organisation sur une fenêtre, et la fenêtre de même durée qui la précède.

BASE DE CALCUL : l''ÉTAT (appointments, queue_entries, organization_follows, customers) pour tout ce que l''état porte ; l''ÉVÉNEMENT (analytics_events) pour les seules vues de profil, que rien d''autre ne porte. Les deux bases ne sont jamais mélangées sur un même chiffre.

GARDE : private.is_org_member — un barber salarié ouvre l''écran. Le REVENU (revenue_cents, average_ticket_cents, no_show_cost_cents, previous_revenue_cents) est NULL — jamais zéro — quand private.can_view_revenue est faux (réglage OS-1, memberships.can_view_revenue).

HONNÊTETÉ : first_activity_at dit depuis quand l''organisation est mesurable, analytics_since depuis quand les vues le sont, comparison_available si une tendance a le droit d''être affichée (fenêtre ≥ 7 jours ET activité antérieure à la fenêtre de comparaison).

Le revenu est un CALCUL au tarif catalogue COURANT, pas un encaissement : aucun montant encaissé n''existe en base (MASTER_SPEC §14).';

revoke all on function public.get_organization_insights(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_organization_insights(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Durées annoncées contre durées observées, par PRESTATION
-- ---------------------------------------------------------------------------
-- `get_service_duration_insights` (F1b) existe et reste intacte : elle rend
-- une ligne par (barber, prestation), ce qu'il faut pour régler un fauteuil.
-- L'insight du §3 du prompt est une phrase sur la PRESTATION (« vous annoncez
-- 30 min, la moyenne observée est de 27 sur 34 prestations ») : une autre
-- granularité de la MÊME fonction privée, pas un second calcul. Agréger
-- côté client les lignes par barber serait une moyenne de moyennes
-- pondérées — c'est-à-dire un chiffre faux.

create or replace function public.get_organization_duration_gaps(
  p_organization_id uuid,
  p_location_id uuid default null
)
returns table (
  location_id uuid,
  location_name text,
  service_id uuid,
  service_name text,
  declared_minutes integer,
  observed_minutes numeric,
  sample_count integer,
  estimate_capped boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not (select private.is_org_member(p_organization_id)) then
    raise exception 'not authorized to read duration gaps for this organization'
      using errcode = '42501',
            detail = 'fadeup_insights_refusal=not_authorized';
  end if;

  -- Un lieu d'une AUTRE organisation reçoit le même refus qu'un lieu
  -- inexistant : la RPC ne sert pas d'oracle d'existence de lieu.
  if p_location_id is not null
     and not exists (
       select 1 from public.locations l
       where l.id = p_location_id and l.organization_id = p_organization_id
     ) then
    raise exception 'unknown location for this organization'
      using errcode = '22023',
            detail = 'fadeup_insights_refusal=unknown_location';
  end if;

  return query
  select
    pairs.location_id,
    l.name,
    pairs.service_id,
    s.name,
    s.duration_minutes,
    o.observed_minutes,
    o.sample_count,
    (o.sample_count >= 5
       and s.duration_minutes is not null
       and (o.observed_minutes > s.duration_minutes * 1.5
            or o.observed_minutes < s.duration_minutes * 0.5))
  from (
    select distinct sd.location_id, sd.service_id
    from public.service_duration_samples sd
    where sd.organization_id = p_organization_id
      and (p_location_id is null or sd.location_id = p_location_id)
  ) pairs
  join public.locations l on l.id = pairs.location_id
  join public.services s on s.id = pairs.service_id and s.is_active
  -- barber NULL = la mesure du LIEU, tous fauteuils confondus : c'est
  -- l'étage 2 de private.estimated_service_duration_minutes, celui qui sert
  -- déjà à estimer l'attente d'une file multi-barbers.
  cross join lateral private.observed_service_duration(pairs.service_id, null, pairs.location_id) o
  where o.sample_count > 0
    and o.observed_minutes is not null
  order by l.name, s.name;
end;
$$;

comment on function public.get_organization_duration_gaps(uuid, uuid) is
'L''écart entre la durée ANNONCÉE au catalogue et la durée OBSERVÉE, par prestation et par établissement — la granularité « phrase » de l''écran d''insights. get_service_duration_insights (F1b) reste la granularité « fauteuil » et n''est pas touchée. Les deux lisent la même private.observed_service_duration : aucune moyenne de moyennes.

Ne rend QUE les prestations réellement mesurées (sample_count > 0). Aucune minute inventée : une prestation sans mesure est absente, pas à zéro.';

revoke all on function public.get_organization_duration_gaps(uuid, uuid) from public, anon;
grant execute on function public.get_organization_duration_gaps(uuid, uuid) to authenticated;

commit;
