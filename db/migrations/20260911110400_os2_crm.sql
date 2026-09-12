-- FadeUp — OS-2 : les fiches clients.
--
-- RÔLE D'APPLICATION : postgres (fonctions NEUVES).
--
-- CE QUE TRANCHE CE FICHIER
--
-- 1. QUI EST UN CLIENT DU SALON. `customers` (une ligne par personne et par
--    organisation) est la source ; ses prestations réellement TERMINÉES
--    sont l'union des rendez-vous `completed` et des passages de file
--    `completed`. Compter les deux est la seule façon honnête : un salon
--    qui travaille surtout en walk-in aurait sinon des clients à zéro
--    prestation.
--
-- 2. « CLIENT VÉRIFIÉ » N'EST PAS « CLIENT DU SALON ». Loi produit
--    (PRODUCT_CONSTITUTION §3.2, MASTER_SPEC §9) : un client vérifié est un
--    FAIT — une prestation délivrée à une personne qui a une identité
--    FadeUp — et il se lit dans `customer_professional_relationships`,
--    jamais dans un abonnement ni dans un compteur de visites. Un
--    habitué sans compte reste un vrai client du salon et n'est PAS
--    « vérifié ». Les deux nombres sont rendus séparément et ne sont jamais
--    agrégés.
--
-- 3. LES CLIENTS QUI NE SONT PAS REVENUS. La donnée existe déjà ; il
--    suffisait de la lire à l'envers. Pour chaque client d'au moins TROIS
--    prestations, l'intervalle moyen observé est
--    (dernière − première) / (nombre − 1) ; le retour attendu est
--    dernière + cet intervalle. Un client est « en retard » quand il a
--    dépassé 1,75 fois son propre intervalle ET au moins 30 jours. Trois
--    prestations parce qu'en dessous il n'y a pas d'intervalle à observer —
--    et FadeUp ne devine pas. Rien n'est inventé : un client à une seule
--    visite n'a pas de cycle, et la RPC rend NULL, pas une moyenne de
--    salon plaquée sur lui.
--
-- 4. MINIMISATION. Les deux RPC sont bornées à l'organisation du client
--    demandé et exigent `private.is_org_member`. Aucune n'accepte de
--    filtre inter-organisation. Les NOTES ne passent pas par ici : elles
--    ont leur propre RPC tracée (`list_customer_notes`, migration
--    20260911110000).
--
-- LE MOTIF NUL : l'organisation est résolue PUIS testée `is null` avant
-- toute garde ; un client inconnu reçoit le même refus qu'un client
-- d'autrui, pour ne pas servir d'oracle d'existence.

begin;

-- ---------------------------------------------------------------------------
-- 1. Le calcul commun — une seule définition de « prestation terminée »
-- ---------------------------------------------------------------------------

create or replace function private.customer_visit_stats(p_organization_id uuid)
returns table (
  customer_id uuid,
  completed_count integer,
  first_completed_at timestamptz,
  last_completed_at timestamptz,
  usual_barber_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with visits as (
    select a.customer_id, coalesce(a.completed_at, a.ends_at) as at, a.barber_id
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.status = 'completed'
      and a.customer_id is not null
    union all
    select q.customer_id, q.completed_at, q.barber_id
    from public.queue_entries q
    where q.organization_id = p_organization_id
      and q.status = 'completed'
      and q.completed_at is not null
      and q.customer_id is not null
  ),
  aggregated as (
    select v.customer_id,
           count(*)::integer as completed_count,
           min(v.at) as first_completed_at,
           max(v.at) as last_completed_at
    from visits v
    group by v.customer_id
  ),
  usual as (
    select distinct on (v.customer_id) v.customer_id, v.barber_id
    from visits v
    where v.barber_id is not null
    group by v.customer_id, v.barber_id
    order by v.customer_id, count(*) desc, max(v.at) desc
  )
  select a.customer_id, a.completed_count, a.first_completed_at, a.last_completed_at, u.barber_id
  from aggregated a
  left join usual u on u.customer_id = a.customer_id;
$$;

comment on function private.customer_visit_stats(uuid) is
  'Prestations RÉELLEMENT terminées par client d''une organisation : rendez-vous completed + passages de file completed. Une seule définition, partagée par la liste et la fiche, pour que les deux écrans ne racontent jamais deux histoires.';

revoke all on function private.customer_visit_stats(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. La liste
-- ---------------------------------------------------------------------------

create or replace function public.list_organization_customers(
  p_organization_id uuid,
  p_search text default null,
  p_segment text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  display_name text,
  phone text,
  email text,
  user_id uuid,
  is_verified_client boolean,
  completed_count integer,
  first_completed_at timestamptz,
  last_completed_at timestamptz,
  days_since_last integer,
  average_interval_days integer,
  expected_return_at timestamptz,
  is_lapsed boolean,
  usual_barber_id uuid,
  usual_barber_name text,
  upcoming_at timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segment text := lower(coalesce(nullif(btrim(p_segment), ''), 'all'));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_organization_id is null
     or not (select private.is_org_member(p_organization_id)) then
    raise exception 'not authorized to read this customer list'
      using errcode = '42501', detail = 'fadeup_crm_refusal=not_authorized';
  end if;

  if v_segment not in ('all', 'regular', 'lapsed', 'new', 'verified') then
    raise exception 'unknown segment'
      using errcode = '22023', detail = 'fadeup_crm_refusal=unknown_segment';
  end if;

  return query
  with stats as (
    select * from private.customer_visit_stats(p_organization_id)
  ),
  rows_all as (
    select
      c.id as customer_id,
      c.name as display_name,
      c.phone,
      c.email,
      c.user_id,
      exists (
        select 1 from public.customer_professional_relationships r
        where r.organization_id = p_organization_id
          and c.user_id is not null
          and r.customer_user_id = c.user_id
      ) as is_verified_client,
      coalesce(s.completed_count, 0) as completed_count,
      s.first_completed_at,
      s.last_completed_at,
      case when s.last_completed_at is null then null
           else greatest(0, (extract(epoch from now() - s.last_completed_at) / 86400.0)::integer)
      end as days_since_last,
      -- L'intervalle moyen n'a de sens qu'à partir de deux intervalles
      -- observés, donc trois prestations.
      case when coalesce(s.completed_count, 0) >= 3
                and s.last_completed_at > s.first_completed_at
           then greatest(1, round(
                  (extract(epoch from s.last_completed_at - s.first_completed_at) / 86400.0)
                  / (s.completed_count - 1))::integer)
           else null
      end as average_interval_days,
      s.usual_barber_id,
      sp.display_name as usual_barber_name,
      (select min(a.starts_at) from public.appointments a
        where a.customer_id = c.id
          and a.organization_id = p_organization_id
          and a.starts_at > now()
          and a.status in ('pending', 'confirmed')) as upcoming_at
    from public.customers c
    left join stats s on s.customer_id = c.id
    left join public.barbers b on b.id = s.usual_barber_id
    left join public.staff_profiles sp on sp.id = b.staff_profile_id
    where c.organization_id = p_organization_id
      and (
        v_search is null
        or c.name ilike '%' || v_search || '%'
        or coalesce(c.phone, '') ilike '%' || v_search || '%'
        or coalesce(c.email, '') ilike '%' || v_search || '%'
      )
  ),
  rows_scored as (
    select r.*,
           case when r.average_interval_days is null then null
                else r.last_completed_at + make_interval(days => r.average_interval_days)
           end as expected_return_at,
           (r.average_interval_days is not null
            and r.days_since_last >= 30
            and r.days_since_last > (r.average_interval_days * 1.75)) as is_lapsed
    from rows_all r
  ),
  rows_filtered as (
    select * from rows_scored r
    where case v_segment
            when 'regular'  then r.completed_count >= 3
            when 'lapsed'   then r.is_lapsed
            when 'new'      then r.completed_count <= 1
            when 'verified' then r.is_verified_client
            else true
          end
  )
  select
    f.customer_id, f.display_name, f.phone, f.email, f.user_id, f.is_verified_client,
    f.completed_count, f.first_completed_at, f.last_completed_at, f.days_since_last,
    f.average_interval_days, f.expected_return_at, f.is_lapsed,
    f.usual_barber_id, f.usual_barber_name, f.upcoming_at,
    (select count(*)::integer from rows_filtered)
  from rows_filtered f
  order by
    -- Le segment « en retard » se lit du plus en retard au moins ; partout
    -- ailleurs, la dernière visite d'abord — c'est ce que le comptoir
    -- cherche.
    case when v_segment = 'lapsed' then f.days_since_last end desc nulls last,
    f.last_completed_at desc nulls last,
    f.display_name
  limit v_limit offset v_offset;
end;
$$;

comment on function public.list_organization_customers(uuid, text, text, integer, integer) is
  'Les clients d''un salon, avec leur fréquence observée, leur dernière visite et leur nombre de prestations terminées. Segments : all, regular (3 prestations et plus), lapsed (a dépassé 1,75 fois SON propre intervalle et 30 jours), new (0 ou 1), verified (a une identité FadeUp et une prestation délivrée). Bornée à une organisation, réservée à ses membres. Ne rend AUCUNE note : elles ont leur RPC tracée.';

revoke all on function public.list_organization_customers(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_organization_customers(uuid, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La fiche
-- ---------------------------------------------------------------------------

create or replace function public.get_organization_customer(p_customer_id uuid)
returns table (
  customer_id uuid,
  organization_id uuid,
  display_name text,
  phone text,
  email text,
  user_id uuid,
  is_verified_client boolean,
  verified_since timestamptz,
  completed_count integer,
  first_completed_at timestamptz,
  last_completed_at timestamptz,
  days_since_last integer,
  average_interval_days integer,
  expected_return_at timestamptz,
  is_lapsed boolean,
  usual_barber_id uuid,
  usual_barber_name text,
  note_count integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select c.organization_id into v_organization_id
  from public.customers c where c.id = p_customer_id;

  if v_organization_id is null
     or not (select private.is_org_member(v_organization_id)) then
    raise exception 'not authorized to read this customer'
      using errcode = '42501', detail = 'fadeup_crm_refusal=not_authorized';
  end if;

  return query
  with s as (
    select * from private.customer_visit_stats(v_organization_id) st
    where st.customer_id = p_customer_id
  )
  select
    c.id,
    c.organization_id,
    c.name,
    c.phone,
    c.email,
    c.user_id,
    r.id is not null,
    r.first_completed_at,
    coalesce(s.completed_count, 0),
    s.first_completed_at,
    s.last_completed_at,
    case when s.last_completed_at is null then null
         else greatest(0, (extract(epoch from now() - s.last_completed_at) / 86400.0)::integer)
    end,
    v.average_interval_days,
    case when v.average_interval_days is null then null
         else s.last_completed_at + make_interval(days => v.average_interval_days)
    end,
    (v.average_interval_days is not null
     and (extract(epoch from now() - s.last_completed_at) / 86400.0) >= 30
     and (extract(epoch from now() - s.last_completed_at) / 86400.0) > (v.average_interval_days * 1.75)),
    s.usual_barber_id,
    sp.display_name,
    (select count(*)::integer from public.customer_notes n where n.customer_id = c.id),
    c.created_at
  from public.customers c
  left join s on true
  left join lateral (
    select case when coalesce(s.completed_count, 0) >= 3
                     and s.last_completed_at > s.first_completed_at
                then greatest(1, round(
                       (extract(epoch from s.last_completed_at - s.first_completed_at) / 86400.0)
                       / (s.completed_count - 1))::integer)
                else null end as average_interval_days
  ) v on true
  left join public.barbers b on b.id = s.usual_barber_id
  left join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join lateral (
    select rel.id, rel.first_completed_at
    from public.customer_professional_relationships rel
    where rel.organization_id = c.organization_id
      and c.user_id is not null
      and rel.customer_user_id = c.user_id
    order by rel.first_completed_at
    limit 1
  ) r on true
  where c.id = p_customer_id;
end;
$$;

comment on function public.get_organization_customer(uuid) is
  'La fiche d''un client du salon : identité, compteurs réels, barber habituel, statut de client vérifié (relation FadeUp, jamais déduite d''un abonnement) et NOMBRE de notes — pas leur contenu, qui passe par list_customer_notes.';

revoke all on function public.get_organization_customer(uuid) from public, anon;
grant execute on function public.get_organization_customer(uuid) to authenticated;


create or replace function public.get_organization_customer_history(
  p_customer_id uuid,
  p_limit integer default 30
)
returns table (
  kind text,
  source_id uuid,
  occurred_at timestamptz,
  status text,
  service_id uuid,
  service_name text,
  barber_id uuid,
  barber_name text,
  price_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  select c.organization_id into v_organization_id
  from public.customers c where c.id = p_customer_id;

  if v_organization_id is null
     or not (select private.is_org_member(v_organization_id)) then
    raise exception 'not authorized to read this customer'
      using errcode = '42501', detail = 'fadeup_crm_refusal=not_authorized';
  end if;

  return query
  select * from (
    select
      'appointment'::text as kind,
      a.id as source_id,
      a.starts_at as occurred_at,
      a.status::text as status,
      a.service_id as service_id,
      s.name as service_name,
      a.barber_id as barber_id,
      sp.display_name as barber_name,
      -- Le prix COURANT du catalogue, pas un instantané : OS-1 §12.8 a posé
      -- la question, elle reste ouverte pour OS-3. L'interface le nomme
      -- « prix catalogue », jamais « payé ».
      s.price_cents as price_cents
    from public.appointments a
    left join public.services s on s.id = a.service_id
    left join public.barbers b on b.id = a.barber_id
    left join public.staff_profiles sp on sp.id = b.staff_profile_id
    where a.customer_id = p_customer_id
      and a.organization_id = v_organization_id

    union all

    select
      'queue'::text as kind,
      q.id as source_id,
      coalesce(q.completed_at, q.called_at, q.created_at) as occurred_at,
      q.status::text as status,
      q.service_id as service_id,
      s.name as service_name,
      q.barber_id as barber_id,
      sp.display_name as barber_name,
      s.price_cents as price_cents
    from public.queue_entries q
    left join public.services s on s.id = q.service_id
    left join public.barbers b on b.id = q.barber_id
    left join public.staff_profiles sp on sp.id = b.staff_profile_id
    where q.customer_id = p_customer_id
      and q.organization_id = v_organization_id
  ) history
  order by history.occurred_at desc
  limit v_limit;
end;
$$;

comment on function public.get_organization_customer_history(uuid, integer) is
  'L''historique d''un client dans CE salon : rendez-vous et passages de file confondus, du plus récent au plus ancien. Le montant rendu est le prix COURANT du catalogue — pas un instantané de facturation (OS-1 §12.8, à trancher avec OS-3) — et l''interface le nomme comme tel.';

revoke all on function public.get_organization_customer_history(uuid, integer) from public, anon;
grant execute on function public.get_organization_customer_history(uuid, integer) to authenticated;

commit;
