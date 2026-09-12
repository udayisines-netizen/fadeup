-- FadeUp — PLAT-3 (1/4) : les défauts plateforme.
--
-- À APPLIQUER EN postgres (règle 1 de DB_OWNERSHIP.md). Propriétaires vérifiés
-- avant écriture : `location_service_settings`, `feed_ranking_weights`,
-- `prospects` et les quatre fonctions redéfinies appartiennent toutes à
-- `postgres`. Aucune moitié de migration possible.
--
-- CE QUE LE CAHIER DES CHARGES CROIT, ET CE QUI EST VRAI
--
-- PLAT-3 §2 dit « ils sont déjà en base — plusieurs lots l'ont vérifié ». Ce
-- n'est vrai que de DEUX des six réglages. Mesuré avant d'écrire une ligne :
--
--   capacité de file        location_service_settings.queue_capacity_per_barber
--                           (défaut 20, borne 1..200) — EN BASE, par lieu
--   délai de grâce          location_service_settings.queue_call_grace_minutes
--                           (défaut 5, borne 0..120) — EN BASE, par lieu
--   réservations futures    constante `c_max_future_bookings := 5` DANS LE CORPS
--                           de book_public_appointment — PAS en base
--   fenêtre de réservation   `BOOKING_WINDOW_DAYS = 90` dans slots.ts — PAS en
--                           base, et le serveur n'impose AUCUN horizon : un
--                           appel direct réserve à cinq ans
--   délai d'annulation      `FREE_CANCEL_HOURS = 12` dans deadline.ts — PAS en
--                           base ; aucune garde serveur (l'annulation tardive
--                           est AUTORISÉE par le produit, seulement consignée)
--   seuils du score de       n'existent pas : search_public_professionals n'a
--   recherche               AUCUN score (départage déterministe). Les seuls
--                           poids réglables en base sont ceux du FIL
--                           (feed_ranking_weights), lus par get_feed.
--
-- Ce fichier pose donc le socle qui manquait, et BRANCHE ce qu'il pose. Un
-- réglage qui ne change rien serait un mensonge d'interface : chacun de ceux
-- que cette migration installe est lu par un consommateur réel, nommé en face.
--
-- CE QUE CE FICHIER NE FAIT PAS
--
-- La grille tarifaire n'est PAS ici. Elle reste dans `commercial_plans`, que
-- B3 a construite et qui fait autorité (MASTER_SPEC §4). Aucun prix n'entre
-- dans `platform_settings`, et la contrainte de famille l'interdit.
--
-- HÉRITAGE PLUTÔT QUE DUPLICATION
--
-- Les deux réglages de file vivent déjà PAR LIEU. Les recopier dans
-- `platform_settings` créerait deux sources de vérité. À la place : le défaut
-- plateforme est PROPAGÉ aux lieux qui ne l'ont pas surchargé, et un lieu
-- qui appelle `set_location_queue_thresholds` lève `queue_thresholds_overridden`
-- et cesse de suivre. `private.queue_capacity` et `run_queue_grace_maintenance`
-- ne sont PAS touchées : elles continuent de lire la colonne, qui porte
-- toujours la valeur effective.
--
-- LE CAS NUL, partout. `private.platform_can()` rend un booléen strict ; chaque
-- garde écrit quand même `v_actor is null or not ...`. X3 a payé deux fois
-- pour cette omission.

begin;

-- ---------------------------------------------------------------------------
-- 1. Le droit
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('platform.settings', 'Régler les défauts de la plateforme : file, réservation, classement, notifications. Chaque changement est tracé.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key)
select r.role, 'platform.settings'
from (values
  ('platform_owner'::public.platform_role),
  ('platform_admin'::public.platform_role)
) as r(role)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. La table
-- ---------------------------------------------------------------------------

create table if not exists public.platform_settings (
  key         text primary key,
  family      text not null,
  value       numeric not null,
  min_value   numeric not null,
  max_value   numeric not null,
  is_integer  boolean not null default true,
  unit        text,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,

  constraint platform_settings_key_shape
    check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  -- La famille est FERMÉE, et « pricing » n'y est pas : la grille tarifaire
  -- reste dans commercial_plans (MASTER_SPEC §4). Une famille ouverte
  -- laisserait un jour quelqu'un poser un prix ici.
  constraint platform_settings_family_known
    check (family in ('queue', 'booking', 'search', 'notifications')),
  constraint platform_settings_bounds_ordered
    check (max_value > min_value),
  -- LES BORNES SONT DANS LA TABLE, pas seulement dans la RPC. Une garde qui
  -- n'existe qu'en fonction disparaît le jour où quelqu'un écrit en SQL.
  constraint platform_settings_within_bounds
    check (value >= min_value and value <= max_value),
  constraint platform_settings_integer_shape
    check (not is_integer or value = trunc(value)),
  constraint platform_settings_unit_shape
    check (unit is null or char_length(unit) <= 40)
);

comment on table public.platform_settings is
  'Les défauts de la plateforme, réglables par le fondateur et les admins depuis /platform/settings. Les bornes sont portées par la table ET revérifiées par set_platform_setting. Chaque changement écrit au journal d''audit. La grille tarifaire N''EST PAS ici : elle vit dans commercial_plans.';
comment on column public.platform_settings.value is
  'Valeur effective. Numérique pour toutes les familles : un réglage booléen ou textuel demanderait une autre colonne et n''existe pas aujourd''hui.';
comment on column public.platform_settings.is_integer is
  'Vrai quand la valeur doit rester entière ; la contrainte platform_settings_integer_shape le fait respecter en base.';

alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

-- Lecture réservée aux porteurs du droit. Le client public, lui, ne lit pas
-- cette table : il passe par get_public_platform_settings(), qui ne rend que
-- le sous-ensemble qui le concerne.
drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings
  for select to authenticated
  using ((select private.platform_can('platform.settings')));

revoke insert, update, delete, truncate on public.platform_settings from anon, authenticated;
revoke all on public.platform_settings from anon;
grant select on public.platform_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Les valeurs, et la raison de chaque borne
-- ---------------------------------------------------------------------------
--
-- Les libellés et les phrases d'effet ne sont PAS en base : elles vivent dans
-- la localisation, sous `platform:settings.<clé>.label` / `.effect`, en dix
-- langues. Une base de données qui porte de l'anglais en dur est une base qui
-- ne se traduit jamais.

insert into public.platform_settings (key, family, value, min_value, max_value, is_integer, unit, sort_order) values
  -- FILE. Bornes : au-delà de 30 minutes une grâce ne protège plus personne,
  -- elle bloque la file ; en deçà d'une minute elle n'existe pas. La capacité
  -- et le rayon reprennent les bornes déjà portées par
  -- location_service_settings_queue_thresholds_range, pour qu'une propagation
  -- ne puisse jamais produire une ligne que la table refuserait.
  ('queue.capacity_per_barber',              'queue',          20,   1,  200, true, 'people',  10),
  ('queue.call_grace_minutes',               'queue',           5,   1,   30, true, 'minutes', 20),
  ('queue.geofence_meters',                  'queue',         150,  25, 2000, true, 'meters',  30),

  -- RÉSERVATION. 90 jours et 5 réservations viennent de MASTER_SPEC §6.
  ('booking.window_days',                    'booking',        90,   1,  365, true, 'days',    10),
  ('booking.max_future_per_customer',        'booking',         5,   1,   50, true, 'bookings',20),
  ('booking.free_cancel_hours',              'booking',        12,   0,  168, true, 'hours',   30),

  -- NOTIFICATIONS. Les heures calmes et les deux délais de relance sont
  -- aujourd'hui des littéraux dans private.enqueue_prospect_outreach. Le
  -- nombre de touches, lui, reste À TROIS et n'est pas réglable : c'est une
  -- loi produit (MASTER_SPEC §5), pas un curseur.
  ('notifications.quiet_hours_start',        'notifications',   8,   0,   12, true, 'hour',    10),
  ('notifications.quiet_hours_end',          'notifications',  21,  13,   24, true, 'hour',    20),
  ('notifications.prospect_touch2_delay_hours','notifications', 8,   1,   72, true, 'hours',   30),
  ('notifications.prospect_touch3_lead_hours','notifications',  2,   1,   24, true, 'hours',   40)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Les lecteurs
-- ---------------------------------------------------------------------------
--
-- `coalesce(..., défaut)` chez CHAQUE appelant : une clé absente ne doit
-- jamais casser une réservation ni une file. Le défaut codé en face de
-- l'appel est le comportement d'avant ce lot.

create or replace function private.platform_setting_num(p_key text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select s.value from public.platform_settings s where s.key = p_key;
$function$;

comment on function private.platform_setting_num(text) is
  'Valeur d''un défaut plateforme, ou NULL si la clé n''existe pas. Tout appelant DOIT coalescer vers son défaut historique : un réglage manquant ne casse rien.';

create or replace function private.platform_setting_int(p_key text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select s.value::integer from public.platform_settings s where s.key = p_key;
$function$;

revoke all on function private.platform_setting_num(text) from public, anon, authenticated;
revoke all on function private.platform_setting_int(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. L'héritage : un lieu suit le défaut tant qu'il ne l'a pas surchargé
-- ---------------------------------------------------------------------------

alter table public.location_service_settings
  add column if not exists queue_thresholds_overridden boolean not null default false;

comment on column public.location_service_settings.queue_thresholds_overridden is
  'Faux tant que le salon n''a pas réglé lui-même ses seuils de file : la ligne suit alors les défauts plateforme, qui la mettent à jour quand ils changent. set_location_queue_thresholds le passe à vrai, et le lieu cesse de suivre.';

-- ---------------------------------------------------------------------------
-- 6. Les RPC
-- ---------------------------------------------------------------------------

-- LECTURE — les défauts plus les poids du fil, en une seule liste.
--
-- Les cinq poids de `feed_ranking_weights` ne sont PAS recopiés dans
-- `platform_settings` : B4 les a posés, `get_feed` les lit, ils ont déjà leurs
-- bornes (0..100). Les dupliquer créerait le système parallèle que le lot
-- interdit. Ils sont donc EXPOSÉS ici, avec leur source nommée, et écrits
-- à leur place par la même RPC d'écriture.
create or replace function public.list_platform_settings()
returns table (
  key text,
  family text,
  source text,
  value numeric,
  min_value numeric,
  max_value numeric,
  is_integer boolean,
  unit text,
  sort_order integer,
  updated_at timestamptz,
  updated_by_email text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not (select private.platform_can('platform.settings')) then
    raise exception 'reading platform defaults is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_settings_refusal=not_authorized';
  end if;

  return query
  select s.key, s.family, 'platform_settings'::text,
         s.value, s.min_value, s.max_value, s.is_integer, s.unit, s.sort_order,
         s.updated_at, u.email::text
  from public.platform_settings s
  left join auth.users u on u.id = s.updated_by
  union all
  select 'search.weight_' || w.signal, 'search'::text, 'feed_ranking_weights'::text,
         w.weight, 0::numeric, 100::numeric, false, 'weight'::text,
         (case w.signal
            when 'relationship' then 10 when 'proximity' then 20
            when 'freshness' then 30 when 'engagement' then 40
            else 50 end),
         w.updated_at, null::text
  from public.feed_ranking_weights w
  order by 2, 9, 1;
end;
$function$;

comment on function public.list_platform_settings() is
  'Les défauts plateforme ET les poids de classement du fil, avec leurs bornes. Réservé au fondateur et aux admins. La colonne `source` dit quelle table porte la valeur — il n''y en a jamais deux.';

-- ÉCRITURE — une seule porte, bornes revérifiées, trace obligatoire.
create or replace function public.set_platform_setting(
  p_key text,
  p_value numeric,
  p_reason text default null
)
returns table (
  key text,
  value numeric,
  previous_value numeric,
  locations_propagated integer
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_reason text;
  v_old numeric;
  v_min numeric;
  v_max numeric;
  v_is_integer boolean;
  v_family text;
  v_signal text;
  v_propagated integer := 0;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('platform.settings')) then
    raise exception 'changing a platform default is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_settings_refusal=not_authorized';
  end if;

  if p_key is null or p_value is null then
    raise exception 'a key and a value are required'
      using errcode = '22023', detail = 'fadeup_settings_refusal=missing_argument';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  -- Les poids du fil : même porte, autre table.
  if p_key like 'search.weight_%' then
    v_signal := substring(p_key from 15);
    select w.weight into v_old from public.feed_ranking_weights w where w.signal = v_signal;
    if v_old is null then
      raise exception 'unknown ranking signal: %', v_signal
        using errcode = '42704', detail = 'fadeup_settings_refusal=unknown_key';
    end if;
    if p_value < 0 or p_value > 100 then
      raise exception 'a ranking weight must be between 0 and 100'
        using errcode = '22023', detail = 'fadeup_settings_refusal=out_of_range';
    end if;
    if p_value = v_old then
      raise exception 'this setting already holds that value'
        using errcode = 'P0001', detail = 'fadeup_settings_refusal=no_change';
    end if;

    update public.feed_ranking_weights w set weight = p_value, updated_at = now()
    where w.signal = v_signal;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_actor, 'platform_setting_changed', 'feed_ranking_weights', null,
            jsonb_build_object('key', p_key, 'previous_value', v_old, 'new_value', p_value,
                               'family', 'search', 'reason', v_reason));

    return query select p_key, p_value, v_old, 0;
    return;
  end if;

  select s.value, s.min_value, s.max_value, s.is_integer, s.family
    into v_old, v_min, v_max, v_is_integer, v_family
  from public.platform_settings s where s.key = p_key
  for update;

  if v_old is null then
    raise exception 'unknown platform setting: %', p_key
      using errcode = '42704', detail = 'fadeup_settings_refusal=unknown_key';
  end if;

  -- LES BORNES, CÔTÉ SERVEUR. L'écran les affiche aussi, mais un écran ne
  -- refuse rien : X3 a prouvé deux fois qu'on appelle la RPC directement.
  if p_value < v_min or p_value > v_max then
    raise exception 'value % is outside the allowed range % to % for %', p_value, v_min, v_max, p_key
      using errcode = '22023', detail = 'fadeup_settings_refusal=out_of_range';
  end if;

  if v_is_integer and p_value <> trunc(p_value) then
    raise exception 'setting % only accepts whole numbers', p_key
      using errcode = '22023', detail = 'fadeup_settings_refusal=not_an_integer';
  end if;

  if p_value = v_old then
    raise exception 'this setting already holds that value'
      using errcode = 'P0001', detail = 'fadeup_settings_refusal=no_change';
  end if;

  update public.platform_settings s
     set value = p_value, updated_at = now(), updated_by = v_actor
   where s.key = p_key;

  -- PROPAGATION. Un défaut de file ne sert à rien s'il ne descend pas : il
  -- atteint tous les lieux qui n'ont pas réglé les leurs. Ceux qui l'ont fait
  -- gardent leur valeur — c'est le sens de « surchargeable par salon ».
  if p_key = 'queue.capacity_per_barber' then
    update public.location_service_settings s
       set queue_capacity_per_barber = p_value::integer
     where not s.queue_thresholds_overridden
       and s.queue_capacity_per_barber is distinct from p_value::integer;
    get diagnostics v_propagated = row_count;
  elsif p_key = 'queue.call_grace_minutes' then
    update public.location_service_settings s
       set queue_call_grace_minutes = p_value::integer
     where not s.queue_thresholds_overridden
       and s.queue_call_grace_minutes is distinct from p_value::integer;
    get diagnostics v_propagated = row_count;
  elsif p_key = 'queue.geofence_meters' then
    update public.location_service_settings s
       set queue_geofence_meters = p_value::integer
     where not s.queue_thresholds_overridden
       and s.queue_geofence_meters is distinct from p_value::integer;
    get diagnostics v_propagated = row_count;
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'platform_setting_changed', 'platform_settings', null,
          jsonb_build_object('key', p_key, 'previous_value', v_old, 'new_value', p_value,
                             'family', v_family, 'reason', v_reason,
                             'locations_propagated', v_propagated));

  return query select p_key, p_value, v_old, v_propagated;
end;
$function$;

comment on function public.set_platform_setting(text, numeric, text) is
  'La seule porte d''écriture des défauts plateforme. Refuse hors bornes, refuse une valeur non entière là où la table l''exige, propage les défauts de file aux lieux non surchargés, et écrit toujours au journal : clé, ancienne valeur, nouvelle valeur, motif.';

-- LECTURE PUBLIQUE — le strict sous-ensemble que le client doit connaître.
--
-- Deux valeurs, toutes deux déjà visibles dans l'interface d'un client :
-- jusqu'où va le sélecteur de dates, et jusqu'à quand une annulation reste
-- libre. Rien d'opérationnel, rien de nominatif, rien qui dise quoi que ce
-- soit d'un salon. C'est la RPC qui fait passer le contrat de surface anonyme
-- de 45 à 46 entrées, et le motif est écrit dans l'allowlist.
create or replace function public.get_public_platform_settings()
returns table (
  booking_window_days integer,
  booking_free_cancel_hours integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    coalesce((select s.value::integer from public.platform_settings s where s.key = 'booking.window_days'), 90),
    coalesce((select s.value::integer from public.platform_settings s where s.key = 'booking.free_cancel_hours'), 12);
$function$;

comment on function public.get_public_platform_settings() is
  'Les deux défauts que le client doit connaître pour que son écran dise la vérité : l''horizon de réservation et la fenêtre d''annulation libre. Rien d''autre ne sort d''ici.';

revoke all on function public.list_platform_settings() from public, anon;
revoke all on function public.set_platform_setting(text, numeric, text) from public, anon;
revoke all on function public.get_public_platform_settings() from public;
grant execute on function public.list_platform_settings() to authenticated;
grant execute on function public.set_platform_setting(text, numeric, text) to authenticated;
grant execute on function public.get_public_platform_settings() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Les consommateurs
-- ---------------------------------------------------------------------------

-- 7.1 Un lieu neuf naît avec les défauts du jour, pas avec ceux de 2026-09-04.
create or replace function private.ensure_location_service_settings(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_location_id is null then
    return;
  end if;

  insert into public.location_service_settings (
    location_id, organization_id,
    queue_capacity_per_barber, queue_call_grace_minutes, queue_geofence_meters
  )
  select l.id, l.organization_id,
         coalesce(private.platform_setting_int('queue.capacity_per_barber'), 20),
         coalesce(private.platform_setting_int('queue.call_grace_minutes'), 5),
         coalesce(private.platform_setting_int('queue.geofence_meters'), 150)
  from public.locations l
  where l.id = p_location_id
  on conflict (location_id) do nothing;
end;
$function$;

-- 7.2 Un salon qui règle ses seuils cesse de suivre le défaut. Corps repris
--     VERBATIM d'OS-2, à la seule ligne `queue_thresholds_overridden` près.
create or replace function public.set_location_queue_thresholds(
  p_location_id uuid,
  p_capacity_per_barber integer default null,
  p_call_grace_minutes integer default null,
  p_geofence_meters integer default null
)
returns public.location_service_settings
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_organization_id uuid;
  v_row public.location_service_settings;
begin
  select l.organization_id into v_organization_id
  from public.locations l where l.id = p_location_id;

  -- Motif nul : v_organization_id est testé AVANT d'être passé à la garde.
  if v_organization_id is null
     or not (select private.has_org_role(v_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to manage queue settings for this location'
      using errcode = '42501', detail = 'fadeup_queue_refusal=not_authorized';
  end if;

  if p_capacity_per_barber is null
     and p_call_grace_minutes is null
     and p_geofence_meters is null then
    raise exception 'nothing to change'
      using errcode = '22023', detail = 'fadeup_queue_refusal=no_change';
  end if;

  if p_capacity_per_barber is not null
     and (p_capacity_per_barber < 1 or p_capacity_per_barber > 200) then
    raise exception 'queue capacity per barber must be between 1 and 200'
      using errcode = '22023', detail = 'fadeup_queue_refusal=capacity_out_of_range';
  end if;

  if p_call_grace_minutes is not null
     and (p_call_grace_minutes < 0 or p_call_grace_minutes > 120) then
    raise exception 'the call grace delay must be between 0 and 120 minutes'
      using errcode = '22023', detail = 'fadeup_queue_refusal=grace_out_of_range';
  end if;

  if p_geofence_meters is not null
     and (p_geofence_meters < 25 or p_geofence_meters > 2000) then
    raise exception 'the check-in radius must be between 25 and 2000 metres'
      using errcode = '22023', detail = 'fadeup_queue_refusal=geofence_out_of_range';
  end if;

  perform private.ensure_location_service_settings(p_location_id);

  update public.location_service_settings s
     set queue_capacity_per_barber = coalesce(p_capacity_per_barber, s.queue_capacity_per_barber),
         queue_call_grace_minutes  = coalesce(p_call_grace_minutes,  s.queue_call_grace_minutes),
         queue_geofence_meters     = coalesce(p_geofence_meters,     s.queue_geofence_meters),
         -- PLAT-3 : à partir d'ici, ce lieu ne suit plus le défaut plateforme.
         queue_thresholds_overridden = true
   where s.location_id = p_location_id
  returning * into v_row;

  return v_row;
end;
$function$;

commit;
