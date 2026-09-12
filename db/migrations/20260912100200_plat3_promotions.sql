-- FadeUp — PLAT-3 (3/4) : les promotions.
--
-- À APPLIQUER EN postgres (règle 1 de DB_OWNERSHIP.md). Tous les objets créés
-- sont neufs ; les deux tables lues (`commercial_plans`, `organization_billing`)
-- appartiennent à `postgres` — vérifié avant écriture. Aucune fonction de B3
-- n'est redéfinie : voir « LE CONTRAT AVEC LE BILLING » ci-dessous.
--
-- CE QUI EXISTAIT AVANT CE FICHIER : RIEN.
--
-- Mesuré, pas supposé : zéro colonne, zéro table, zéro fonction et zéro ligne
-- de migration contenant `coupon`, `promotion_code`, `percent_off`,
-- `amount_off` ou `discount`. La fonction Edge `stripe-billing` crée ses
-- sessions Checkout SANS `discounts[...]` et SANS `allow_promotion_codes`.
-- `private.process_stripe_event` ne lit ni `discount` ni `total` : une remise
-- posée aujourd'hui à la main dans Stripe serait INVISIBLE pour FadeUp.
--
-- POURQUOI STRIPE ET PAS UN COMPTEUR MAISON
--
-- Le lot l'impose et B3 a raison : la remise doit être portée par l'objet qui
-- facture. Une table FadeUp qui dirait « -20 % » pendant que Stripe encaisse
-- le plein tarif serait pire qu'une absence de promotion. Ce fichier crée donc
-- un VRAI coupon Stripe, par pg_net, avec un identifiant DÉTERMINISTE
-- (`fadeup_promo_<code>`) — connu avant l'appel, donc stockable sans attendre
-- la réponse — et une vérification explicite (`verify_promotion_sync`) qui lit
-- la réponse dans `net._http_response` et refuse de prétendre que c'est fait.
-- Tant que `stripe_confirmed_at` est nul, l'écran dit « en attente », jamais
-- « actif ».
--
-- LE CONTRAT AVEC LE BILLING D'OS-3 — lu par l'autre lot, à ne pas casser
--
--   * AUCUNE fonction de B3 n'est modifiée. `prepare_billing_checkout`,
--     `get_billing_catalog`, `assign_commercial_plan`, `request_plan_change`
--     gardent leur signature ET leur corps. Un `drop` + `create` sur une
--     `returns table` aurait obligé à re-matérialiser les ACL, et OS-3 appelle
--     ces fonctions pendant que ce lot tourne.
--   * Trois points d'entrée NEUFS, que l'écran de billing consomme sans rien
--     changer de ce qu'il appelle déjà :
--       - `public.get_my_organization_promotion(uuid)` — ce que CE salon a,
--         et rien d'autre. À afficher à côté du prix du catalogue.
--       - `public.redeem_promotion_code(uuid, text)` — le champ « j'ai un
--         code » de l'écran de billing.
--       - `public.resolve_checkout_discount(uuid)` — ce que la fonction Edge
--         doit ajouter à la session Checkout (`discounts[0][coupon]`).
--   * Le prix affiché reste celui du catalogue. Une promotion ne réécrit
--     JAMAIS `commercial_plans` : elle se pose à côté, comme chez Stripe.
--
-- LE CAS NUL, partout : chaque garde écrit `v_actor is null or not ...`.

begin;

-- ---------------------------------------------------------------------------
-- 1. Les droits
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('promotions.manage', 'Créer, arrêter et suivre les promotions commerciales, et révoquer une remise déjà posée.'),
  ('promotions.apply',  'Appliquer une promotion existante à un salon, dans les bornes de son rôle.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key)
select r.role, 'promotions.manage'
from (values ('platform_owner'::public.platform_role), ('platform_admin'::public.platform_role)) as r(role)
on conflict do nothing;

insert into public.platform_role_permissions (role, permission_key)
select r.role, 'promotions.apply'
from (values ('platform_owner'::public.platform_role), ('platform_admin'::public.platform_role),
             ('platform_sales'::public.platform_role)) as r(role)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Les types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.promotion_kind as enum ('percent', 'amount');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.promotion_duration as enum ('once', 'repeating', 'forever');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.promotion_status as enum ('active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.promotion_application as enum ('code', 'staff');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Le plafond par rôle — une TABLE, pas un `case` dans une fonction
-- ---------------------------------------------------------------------------
--
-- Un plafond codé dans un corps de fonction se change par migration ; un
-- plafond en table se lit, s'audite et se corrige. Et il se TESTE, ce qui est
-- la vraie raison.

create table if not exists public.promotion_role_limits (
  role                  public.platform_role primary key,
  max_percent_off       numeric(5,2) not null,
  max_amount_off_minor  integer not null,
  max_duration_months   integer not null,
  -- « Pour toujours » n'est pas une durée plus longue : c'est une AUTRE
  -- décision. La dériver d'un nombre de mois obligeait à choisir un nombre
  -- arbitraire et rendait le plafond du fondateur incohérent avec lui-même.
  -- Elle est donc explicite, et elle se lit.
  may_grant_forever     boolean not null default false,
  constraint promotion_role_limits_percent_range check (max_percent_off > 0 and max_percent_off <= 100),
  constraint promotion_role_limits_amount_positive check (max_amount_off_minor > 0),
  constraint promotion_role_limits_duration_range check (max_duration_months between 1 and 36)
);

comment on table public.promotion_role_limits is
  'Ce que chaque rôle interne a le droit d''accorder. Un rôle absent de cette table n''accorde RIEN : le défaut est le refus, jamais un plafond implicite.';

insert into public.promotion_role_limits (role, max_percent_off, max_amount_off_minor, max_duration_months, may_grant_forever) values
  -- Le fondateur décide, sans plafond utile : 100 % pour toujours reste
  -- possible, parce que c'est SA décision et qu'elle est tracée.
  ('platform_owner', 100.00, 100000, 36, true),
  -- Un admin accorde un geste commercial, pas une gratuité perpétuelle.
  ('platform_admin',  50.00,  20000, 12, false),
  -- Le commercial : exactement l'exemple du cahier des charges à l'envers —
  -- il ne fait PAS 90 % sur un an. Vingt pour cent, trois mois, cinquante
  -- euros. Au-delà, il demande.
  ('platform_sales',  20.00,   5000,  3, false)
on conflict (role) do nothing;

alter table public.promotion_role_limits enable row level security;
alter table public.promotion_role_limits force row level security;

drop policy if exists promotion_role_limits_select on public.promotion_role_limits;
create policy promotion_role_limits_select on public.promotion_role_limits
  for select to authenticated
  using ((select private.platform_can('promotions.apply')));

revoke insert, update, delete, truncate on public.promotion_role_limits from anon, authenticated;
revoke all on public.promotion_role_limits from anon;
grant select on public.promotion_role_limits to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Les promotions
-- ---------------------------------------------------------------------------

create table if not exists public.promotions (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  kind                  public.promotion_kind not null,
  percent_off           numeric(5,2),
  amount_off_minor      integer,
  currency              text not null default 'EUR',
  duration              public.promotion_duration not null,
  duration_in_months    integer,
  starts_at             timestamptz not null default now(),
  ends_at               timestamptz,
  max_redemptions       integer,
  redeemed_count        integer not null default 0,
  -- Vide = tous les plans payants. Une liste = ces plans seulement.
  eligible_plan_keys    text[] not null default '{}',
  status                public.promotion_status not null default 'active',
  note                  text,
  -- Le miroir Stripe. `stripe_coupon_id` est DÉTERMINISTE et posé avant
  -- l'appel ; `stripe_confirmed_at` n'est posé que par verify_promotion_sync,
  -- après lecture de la réponse HTTP réelle.
  stripe_coupon_id      text,
  stripe_request_id     bigint,
  stripe_confirmed_at   timestamptz,
  stripe_error          text,
  livemode              boolean not null default false,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  ended_at              timestamptz,
  ended_by              uuid references auth.users (id) on delete set null,
  end_reason            text,

  constraint promotions_code_shape check (code ~ '^[A-Z0-9]{4,24}$'),
  constraint promotions_kind_shape check (
    (kind = 'percent' and percent_off is not null and amount_off_minor is null)
    or (kind = 'amount' and amount_off_minor is not null and percent_off is null)
  ),
  constraint promotions_percent_range check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  constraint promotions_amount_positive check (amount_off_minor is null or amount_off_minor > 0),
  constraint promotions_duration_shape check (
    (duration = 'repeating' and duration_in_months between 1 and 36)
    or (duration <> 'repeating' and duration_in_months is null)
  ),
  constraint promotions_window_ordered check (ends_at is null or ends_at > starts_at),
  constraint promotions_max_redemptions_positive check (max_redemptions is null or max_redemptions > 0),
  constraint promotions_redeemed_count_positive check (redeemed_count >= 0),
  constraint promotions_note_length check (note is null or char_length(note) <= 500),
  constraint promotions_ended_shape check (
    status <> 'ended'
    or (ended_at is not null and ended_by is not null
        and nullif(btrim(coalesce(end_reason, '')), '') is not null)
  )
);

create unique index if not exists promotions_code_unique on public.promotions (code);
create index if not exists promotions_status_idx on public.promotions (status, starts_at desc);

comment on table public.promotions is
  'Une promotion FadeUp, miroir d''un coupon Stripe. La remise est portée par Stripe : cette table dit QUI a le droit de l''utiliser, JUSQU''À QUAND et COMBIEN DE FOIS. Elle ne calcule aucun prix.';
comment on column public.promotions.eligible_plan_keys is
  'Vide = tous les plans payants du catalogue. Une liste = ces clés de plan seulement. Jamais `free` : on n''offre pas une remise sur zéro euro.';
comment on column public.promotions.stripe_confirmed_at is
  'Posé UNIQUEMENT par verify_promotion_sync, après lecture de la réponse Stripe. Tant qu''il est nul, la promotion n''est pas opposable : l''écran dit « en attente de Stripe », pas « active ».';

alter table public.promotions enable row level security;
alter table public.promotions force row level security;

-- Un salon n'ÉNUMÈRE JAMAIS les promotions : il ne peut en connaître une que
-- par son code, ou parce qu'on la lui a appliquée. Cette policy est donc
-- réservée au personnel interne ; le salon passe par
-- get_my_organization_promotion, SECURITY DEFINER, qui ne rend que la sienne.
drop policy if exists promotions_select on public.promotions;
create policy promotions_select on public.promotions
  for select to authenticated
  using ((select private.platform_can('promotions.apply')));

revoke insert, update, delete, truncate on public.promotions from anon, authenticated;
revoke all on public.promotions from anon;
grant select on public.promotions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Les applications
-- ---------------------------------------------------------------------------

create table if not exists public.promotion_redemptions (
  id                  uuid primary key default gen_random_uuid(),
  promotion_id        uuid not null references public.promotions (id) on delete restrict,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  applied_via         public.promotion_application not null,
  applied_by          uuid references auth.users (id) on delete set null,
  applied_at          timestamptz not null default now(),
  reason              text,
  -- L'instantané de la remise au moment où elle a été posée. Si la promotion
  -- change plus tard, ce qui a été accordé reste lisible tel qu'il l'était.
  percent_off         numeric(5,2),
  amount_off_minor    integer,
  status              public.promotion_status not null default 'active',
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users (id) on delete set null,
  revoke_reason       text,
  stripe_request_id   bigint,

  constraint promotion_redemptions_reason_length check (reason is null or char_length(reason) <= 500),
  constraint promotion_redemptions_revoked_shape check (
    status <> 'ended'
    or (revoked_at is not null
        and nullif(btrim(coalesce(revoke_reason, '')), '') is not null)
  ),
  -- Une application par un commercial EXIGE un motif : « pourquoi » fait
  -- partie de la trace que le lot demande.
  constraint promotion_redemptions_staff_reason check (
    applied_via <> 'staff'
    or nullif(btrim(coalesce(reason, '')), '') is not null
  )
);

-- PAS DE CUMUL. La règle vit dans un index unique, pas dans un `if` : un `if`
-- laisse passer deux transactions concurrentes, un index non.
create unique index if not exists promotion_redemptions_one_active_per_org
  on public.promotion_redemptions (organization_id) where status = 'active';
create index if not exists promotion_redemptions_promotion_idx
  on public.promotion_redemptions (promotion_id, applied_at desc);

comment on table public.promotion_redemptions is
  'Qui a appliqué quelle remise, à quel salon, quand et pourquoi. L''index promotion_redemptions_one_active_per_org porte la règle de non-cumul : une seule promotion active par organisation, garantie par la base et non par une fonction.';

alter table public.promotion_redemptions enable row level security;
alter table public.promotion_redemptions force row level security;

-- Le salon voit CE QUI LE CONCERNE, et rien d'autre. Le personnel interne
-- voit tout, sous le droit d'application.
drop policy if exists promotion_redemptions_select on public.promotion_redemptions;
create policy promotion_redemptions_select on public.promotion_redemptions
  for select to authenticated
  using (
    (select private.platform_can('promotions.apply'))
    or (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
  );

revoke insert, update, delete, truncate on public.promotion_redemptions from anon, authenticated;
revoke all on public.promotion_redemptions from anon;
grant select on public.promotion_redemptions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Les aides
-- ---------------------------------------------------------------------------

-- Le plafond de l'appelant : le PLUS PERMISSIF de ses rôles, ou rien du tout.
-- `max()` sur zéro ligne rend NULL, et chaque appelant traite le NULL comme un
-- refus — c'est la forme que X3 exige.
create or replace function private.promotion_actor_limits()
returns table (max_percent_off numeric, max_amount_off_minor integer, max_duration_months integer, may_grant_forever boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  select max(l.max_percent_off), max(l.max_amount_off_minor), max(l.max_duration_months),
         bool_or(l.may_grant_forever)
  from public.platform_members pm
  join public.promotion_role_limits l on l.role = pm.role
  where pm.user_id = (select auth.uid());
$function$;

revoke all on function private.promotion_actor_limits() from public, anon, authenticated;

-- Le coupon Stripe, créé par pg_net. Même motif que B3 : les paramètres
-- passent par la CHAÎNE DE REQUÊTE, parce que pg_net ne poste que du JSON et
-- que l'API Stripe le refuse. L'identifiant est déterministe, donc connu avant
-- la réponse.
create or replace function private.stripe_create_promotion_coupon(p_promotion_id uuid)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_p public.promotions;
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  select * into v_p from public.promotions where id = p_promotion_id;
  if v_p.id is null then
    return null;
  end if;

  -- Environnement sans clé : rien à transmettre, pas de bruit, et surtout pas
  -- de `stripe_confirmed_at` posé à tort.
  --
  -- Le coffre PEUT LEVER, et pas seulement rendre NULL : sur une base
  -- restaurée ailleurs, la clé racine de pgsodium n'est pas celle qui a
  -- chiffré les secrets, et `decrypted_secrets` lève « invalid ciphertext ».
  -- Mesuré sur le bac d'essai de ce lot. Une promotion doit être ENREGISTRÉE
  -- quand même : elle restera simplement non confirmée, donc inapplicable —
  -- l'état honnête, plutôt qu'une création qui échoue.
  begin
    v_key := private.stripe_secret_key();
  exception when others then
    v_key := null;
  end;

  if v_key is null then
    return null;
  end if;

  v_url := 'https://api.stripe.com/v1/coupons'
        || '?id=' || v_p.stripe_coupon_id
        || '&name=' || v_p.code
        || '&duration=' || v_p.duration::text;

  if v_p.duration = 'repeating' then
    v_url := v_url || '&duration_in_months=' || v_p.duration_in_months::text;
  end if;

  if v_p.kind = 'percent' then
    v_url := v_url || '&percent_off=' || trim(to_char(v_p.percent_off, 'FM990.99'));
  else
    v_url := v_url || '&amount_off=' || v_p.amount_off_minor::text
                   || '&currency=' || lower(v_p.currency);
  end if;

  if v_p.ends_at is not null then
    v_url := v_url || '&redeem_by=' || extract(epoch from v_p.ends_at)::bigint::text;
  end if;

  if v_p.max_redemptions is not null then
    v_url := v_url || '&max_redemptions=' || v_p.max_redemptions::text;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 15000)
  into v_request_id;

  return v_request_id;
end;
$function$;

revoke all on function private.stripe_create_promotion_coupon(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Les RPC de gestion
-- ---------------------------------------------------------------------------

create or replace function public.create_promotion(
  p_code text,
  p_kind public.promotion_kind,
  p_percent_off numeric default null,
  p_amount_off_minor integer default null,
  p_duration public.promotion_duration default 'once',
  p_duration_in_months integer default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_max_redemptions integer default null,
  p_eligible_plan_keys text[] default '{}',
  p_note text default null
)
returns public.promotions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_code text;
  v_row public.promotions;
  v_limits record;
  v_months integer;
  v_bad text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('promotions.manage')) then
    raise exception 'creating a promotion is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code !~ '^[A-Z0-9]{4,24}$' then
    raise exception 'a promotion code is 4 to 24 letters or digits'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=bad_code';
  end if;

  -- LE PLAFOND DU RÔLE, à la création comme à l'application.
  select * into v_limits from private.promotion_actor_limits();
  if v_limits.max_percent_off is null then
    raise exception 'no promotion ceiling is defined for your role'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=no_ceiling';
  end if;

  if p_kind = 'percent' then
    if p_percent_off is null or p_percent_off <= 0 or p_percent_off > 100 then
      raise exception 'a percentage discount is between 0 and 100'
        using errcode = '22023', detail = 'fadeup_promotion_refusal=bad_percent';
    end if;
    if p_percent_off > v_limits.max_percent_off then
      raise exception 'your role may not grant more than % percent off', v_limits.max_percent_off
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
  else
    if p_amount_off_minor is null or p_amount_off_minor <= 0 then
      raise exception 'an amount discount must be positive'
        using errcode = '22023', detail = 'fadeup_promotion_refusal=bad_amount';
    end if;
    if p_amount_off_minor > v_limits.max_amount_off_minor then
      raise exception 'your role may not grant more than % minor units off', v_limits.max_amount_off_minor
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
  end if;

  v_months := case when p_duration = 'repeating' then p_duration_in_months else null end;
  if p_duration = 'repeating' and (v_months is null or v_months < 1 or v_months > 36) then
    raise exception 'a repeating promotion lasts between 1 and 36 months'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=bad_duration';
  end if;

  -- « Pour toujours » compte comme la durée maximale du rôle : un commercial
  -- borné à trois mois ne contourne pas la borne en choisissant `forever`.
  if p_duration = 'forever' and not coalesce(v_limits.may_grant_forever, false) then
    raise exception 'your role may not grant a permanent discount'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
  end if;

  if coalesce(v_months, 1) > v_limits.max_duration_months then
    raise exception 'your role may not grant a discount lasting that long'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
  end if;

  -- Les plans éligibles doivent EXISTER et être payants. Une promotion sur
  -- `free` est une promotion sur zéro euro.
  if p_eligible_plan_keys is not null and array_length(p_eligible_plan_keys, 1) is not null then
    select string_agg(k, ', ') into v_bad
    from unnest(p_eligible_plan_keys) k
    where not exists (
      select 1 from public.commercial_plans cp
      where cp.plan_key = k and cp.is_available and cp.price_minor > 0
    );
    if v_bad is not null then
      raise exception 'unknown or non-payable plan(s): %', v_bad
        using errcode = '22023', detail = 'fadeup_promotion_refusal=bad_plan';
    end if;
  end if;

  insert into public.promotions (
    code, kind, percent_off, amount_off_minor, duration, duration_in_months,
    starts_at, ends_at, max_redemptions, eligible_plan_keys, note,
    stripe_coupon_id, livemode, created_by
  )
  values (
    v_code, p_kind,
    case when p_kind = 'percent' then p_percent_off end,
    case when p_kind = 'amount' then p_amount_off_minor end,
    p_duration, v_months,
    coalesce(p_starts_at, now()), p_ends_at, p_max_redemptions,
    coalesce(p_eligible_plan_keys, '{}'), nullif(btrim(coalesce(p_note, '')), ''),
    'fadeup_promo_' || lower(v_code), private.billing_livemode(), v_actor
  )
  returning * into v_row;

  update public.promotions
     set stripe_request_id = private.stripe_create_promotion_coupon(v_row.id)
   where id = v_row.id
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'promotion_created', 'promotions', v_row.id,
          jsonb_build_object('code', v_row.code, 'kind', v_row.kind,
                             'percent_off', v_row.percent_off,
                             'amount_off_minor', v_row.amount_off_minor,
                             'duration', v_row.duration,
                             'duration_in_months', v_row.duration_in_months,
                             'ends_at', v_row.ends_at,
                             'max_redemptions', v_row.max_redemptions,
                             'eligible_plan_keys', to_jsonb(v_row.eligible_plan_keys)));

  return v_row;
end;
$function$;

comment on function public.create_promotion(text, public.promotion_kind, numeric, integer, public.promotion_duration, integer, timestamptz, timestamptz, integer, text[], text) is
  'Crée une promotion ET son coupon Stripe. Refuse au-delà du plafond du rôle, refuse un plan inconnu ou gratuit. Le coupon Stripe n''est pas réputé créé tant que verify_promotion_sync n''a pas lu la réponse.';

-- La vérification, qui refuse de prétendre.
create or replace function public.verify_promotion_sync(p_promotion_id uuid)
returns public.promotions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.promotions;
  v_status integer;
  v_body text;
begin
  if (select auth.uid()) is null or not (select private.platform_can('promotions.manage')) then
    raise exception 'checking a promotion is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  select * into v_row from public.promotions where id = p_promotion_id;
  if v_row.id is null then
    raise exception 'promotion not found' using errcode = '42704';
  end if;

  if v_row.stripe_confirmed_at is not null then
    return v_row;
  end if;

  if v_row.stripe_request_id is null then
    update public.promotions
       set stripe_error = 'no Stripe request was issued — is the secret key installed?',
           updated_at = now()
     where id = p_promotion_id
    returning * into v_row;
    return v_row;
  end if;

  select r.status_code, left(r.content, 500) into v_status, v_body
  from net._http_response r
  where r.id = v_row.stripe_request_id;

  if v_status is null then
    -- La réponse n'est pas encore là : on ne conclut rien, et surtout pas
    -- « échec ». L'écran affichera « en attente ».
    return v_row;
  end if;

  if v_status between 200 and 299 then
    update public.promotions
       set stripe_confirmed_at = now(), stripe_error = null, updated_at = now()
     where id = p_promotion_id
    returning * into v_row;
  else
    update public.promotions
       set stripe_error = 'HTTP ' || v_status::text || ' — ' || coalesce(v_body, ''),
           updated_at = now()
     where id = p_promotion_id
    returning * into v_row;
  end if;

  return v_row;
end;
$function$;

create or replace function public.end_promotion(p_promotion_id uuid, p_reason text)
returns public.promotions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_reason text;
  v_row public.promotions;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('promotions.manage')) then
    raise exception 'ending a promotion is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'ending a promotion requires a reason'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=reason_required';
  end if;

  update public.promotions
     set status = 'ended', ended_at = now(), ended_by = v_actor,
         end_reason = v_reason, updated_at = now()
   where id = p_promotion_id and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no active promotion with that identifier'
      using errcode = '42704', detail = 'fadeup_promotion_refusal=not_active';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'promotion_ended', 'promotions', v_row.id,
          jsonb_build_object('code', v_row.code, 'reason', v_reason));

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Les deux chemins d'application
-- ---------------------------------------------------------------------------

-- Le tronc commun : tout ce qui doit être vrai pour qu'une remise se pose.
create or replace function private.assert_promotion_applicable(
  p_promotion public.promotions,
  p_organization_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_plan text;
begin
  if p_promotion.id is null then
    raise exception 'unknown promotion code'
      using errcode = '42704', detail = 'fadeup_promotion_refusal=unknown_code';
  end if;

  if p_promotion.status <> 'active' then
    raise exception 'this promotion has ended'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=ended';
  end if;

  if p_promotion.starts_at > now() then
    raise exception 'this promotion has not started yet'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=not_started';
  end if;

  if p_promotion.ends_at is not null and p_promotion.ends_at <= now() then
    raise exception 'this promotion has expired'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=expired';
  end if;

  if p_promotion.max_redemptions is not null
     and p_promotion.redeemed_count >= p_promotion.max_redemptions then
    raise exception 'this promotion has reached its redemption limit'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=exhausted';
  end if;

  -- Une promotion non confirmée chez Stripe ne s'applique pas : elle
  -- promettrait une remise que la facture ne porterait pas.
  if p_promotion.stripe_confirmed_at is null then
    raise exception 'this promotion is not confirmed by Stripe yet'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=not_synced';
  end if;

  if p_organization_id is null then
    raise exception 'an organization is required'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=missing_organization';
  end if;

  if array_length(p_promotion.eligible_plan_keys, 1) is not null then
    select s.plan_key into v_plan
    from public.organization_commercial_state s
    where s.organization_id = p_organization_id;
    -- Le plan COURANT peut être `free` : le salon s'abonnera ensuite. On
    -- vérifie donc l'éligibilité seulement quand il est DÉJÀ sur un plan
    -- payant, et on laisse passer sinon — la remise ne s'applique de toute
    -- façon qu'à un abonnement.
    if v_plan is not null and v_plan <> 'free' and not (v_plan = any (p_promotion.eligible_plan_keys)) then
      raise exception 'this promotion does not cover the current plan'
        using errcode = 'P0001', detail = 'fadeup_promotion_refusal=plan_not_eligible';
    end if;
  end if;

  -- PAS DE CUMUL. L'index unique le garantit ; ce refus le NOMME, pour que
  -- l'écran dise « ce salon a déjà une remise » et non « conflit de clé ».
  if exists (
    select 1 from public.promotion_redemptions r
    where r.organization_id = p_organization_id and r.status = 'active'
  ) then
    raise exception 'this organization already has an active promotion'
      using errcode = 'P0001', detail = 'fadeup_promotion_refusal=already_discounted';
  end if;
end;
$function$;

revoke all on function private.assert_promotion_applicable(public.promotions, uuid) from public, anon, authenticated;

-- L'écriture commune, une fois la décision prise.
create or replace function private.record_promotion_redemption(
  p_promotion public.promotions,
  p_organization_id uuid,
  p_via public.promotion_application,
  p_reason text
)
returns public.promotion_redemptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_red public.promotion_redemptions;
  v_sub text;
  v_key text;
  v_request bigint;
begin
  begin
    v_key := private.stripe_secret_key();
  exception when others then
    v_key := null;
  end;

  insert into public.promotion_redemptions (
    promotion_id, organization_id, applied_via, applied_by, reason,
    percent_off, amount_off_minor
  )
  values (
    p_promotion.id, p_organization_id, p_via, v_actor,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_promotion.percent_off, p_promotion.amount_off_minor
  )
  returning * into v_red;

  update public.promotions
     set redeemed_count = redeemed_count + 1, updated_at = now()
   where id = p_promotion.id;

  -- Un abonnement VIVANT reçoit la remise tout de suite. Un salon encore sans
  -- abonnement la recevra à la création de sa session Checkout, par
  -- resolve_checkout_discount.
  select b.stripe_subscription_id into v_sub
  from public.organization_billing b
  where b.organization_id = p_organization_id
    and b.subscription_status in ('active', 'trialing', 'past_due');

  if v_sub is not null and v_key is not null then
    select net.http_post(
      url := 'https://api.stripe.com/v1/subscriptions/' || v_sub
          || '?coupon=' || p_promotion.stripe_coupon_id,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 15000)
    into v_request;

    update public.promotion_redemptions set stripe_request_id = v_request where id = v_red.id
    returning * into v_red;
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'promotion_applied', 'promotion_redemptions', v_red.id,
          jsonb_build_object('promotion_id', p_promotion.id, 'code', p_promotion.code,
                             'organization_id', p_organization_id,
                             'applied_via', p_via,
                             'percent_off', p_promotion.percent_off,
                             'amount_off_minor', p_promotion.amount_off_minor,
                             'reason', nullif(btrim(coalesce(p_reason, '')), ''),
                             'pushed_to_subscription', v_sub is not null));

  return v_red;
end;
$function$;

revoke all on function private.record_promotion_redemption(public.promotions, uuid, public.promotion_application, text) from public, anon, authenticated;

-- CHEMIN 1 — le salon saisit un code.
create or replace function public.redeem_promotion_code(p_organization_id uuid, p_code text)
returns public.promotion_redemptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_promo public.promotions;
begin
  perform private.assert_not_in_support_view('redeem_promotion_code');
  -- Le propriétaire SEUL : une remise change ce que l'organisation paie, et
  -- c'est la même garde que tous les gestes de paiement de B3.
  perform private.assert_billing_owner(p_organization_id);

  select * into v_promo from public.promotions
  where code = upper(btrim(coalesce(p_code, '')));

  perform private.assert_promotion_applicable(v_promo, p_organization_id);

  return private.record_promotion_redemption(v_promo, p_organization_id, 'code', null);
end;
$function$;

comment on function public.redeem_promotion_code(uuid, text) is
  'Le champ « j''ai un code » de l''écran de billing. Propriétaire seulement, refusé en vue empruntée. Un code inconnu, échu, épuisé ou non confirmé chez Stripe est refusé en le nommant.';

-- CHEMIN 2 — un commercial applique une offre.
create or replace function public.apply_promotion(
  p_organization_id uuid,
  p_promotion_id uuid,
  p_reason text
)
returns public.promotion_redemptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_promo public.promotions;
  v_limits record;
  v_reason text;
begin
  perform private.assert_not_in_support_view('apply_promotion');

  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('promotions.apply')) then
    raise exception 'applying a promotion is restricted to FadeUp commercial staff'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'applying a promotion requires a reason'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=reason_required';
  end if;

  select * into v_promo from public.promotions where id = p_promotion_id;

  -- LE PLAFOND DU RÔLE, REVÉRIFIÉ À L'APPLICATION. Le fondateur peut créer une
  -- remise de 90 % ; un commercial ne doit pas pouvoir la poser. Sans ce
  -- second contrôle, le plafond de création ne serait qu'un décor.
  select * into v_limits from private.promotion_actor_limits();
  if v_limits.max_percent_off is null then
    raise exception 'no promotion ceiling is defined for your role'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=no_ceiling';
  end if;

  if v_promo.id is not null then
    if v_promo.kind = 'percent' and v_promo.percent_off > v_limits.max_percent_off then
      raise exception 'your role may not apply a discount that large'
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
    if v_promo.kind = 'amount' and v_promo.amount_off_minor > v_limits.max_amount_off_minor then
      raise exception 'your role may not apply a discount that large'
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
    if v_promo.duration = 'forever' and not coalesce(v_limits.may_grant_forever, false) then
      raise exception 'your role may not apply a permanent discount'
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
    if coalesce(v_promo.duration_in_months, 1) > v_limits.max_duration_months then
      raise exception 'your role may not apply a discount lasting that long'
        using errcode = '42501', detail = 'fadeup_promotion_refusal=above_role_ceiling';
    end if;
  end if;

  perform private.assert_promotion_applicable(v_promo, p_organization_id);

  return private.record_promotion_redemption(v_promo, p_organization_id, 'staff', v_reason);
end;
$function$;

comment on function public.apply_promotion(uuid, uuid, text) is
  'Un commercial pose une offre sur un salon, dans les bornes de son rôle, avec un motif obligatoire. Le plafond est revérifié ICI et pas seulement à la création : sans quoi il suffirait qu''un fondateur ait créé une remise de 90 % pour qu''un commercial la pose.';

-- La révocation.
create or replace function public.revoke_promotion_redemption(p_redemption_id uuid, p_reason text)
returns public.promotion_redemptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_reason text;
  v_red public.promotion_redemptions;
  v_sub text;
  v_key text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.platform_can('promotions.manage')) then
    raise exception 'revoking a discount is restricted to the founder and platform admins'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'revoking a discount requires a reason'
      using errcode = '22023', detail = 'fadeup_promotion_refusal=reason_required';
  end if;

  update public.promotion_redemptions
     set status = 'ended', revoked_at = now(), revoked_by = v_actor, revoke_reason = v_reason
   where id = p_redemption_id and status = 'active'
  returning * into v_red;

  if v_red.id is null then
    raise exception 'no active discount with that identifier'
      using errcode = '42704', detail = 'fadeup_promotion_refusal=not_active';
  end if;

  select b.stripe_subscription_id into v_sub
  from public.organization_billing b
  where b.organization_id = v_red.organization_id
    and b.subscription_status in ('active', 'trialing', 'past_due');

  begin
    v_key := private.stripe_secret_key();
  exception when others then
    v_key := null;
  end;

  if v_sub is not null and v_key is not null then
    perform net.http_delete(
      url := 'https://api.stripe.com/v1/subscriptions/' || v_sub || '/discount',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
      timeout_milliseconds := 15000);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'promotion_revoked', 'promotion_redemptions', v_red.id,
          jsonb_build_object('organization_id', v_red.organization_id,
                             'promotion_id', v_red.promotion_id, 'reason', v_reason));

  return v_red;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Les lectures
-- ---------------------------------------------------------------------------

create or replace function public.list_promotions(p_include_ended boolean default false)
returns table (
  id uuid,
  code text,
  kind public.promotion_kind,
  percent_off numeric,
  amount_off_minor integer,
  duration public.promotion_duration,
  duration_in_months integer,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer,
  redeemed_count integer,
  active_redemptions integer,
  eligible_plan_keys text[],
  status public.promotion_status,
  stripe_coupon_id text,
  stripe_confirmed_at timestamptz,
  stripe_error text,
  note text,
  created_at timestamptz,
  created_by_email text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not (select private.platform_can('promotions.apply')) then
    raise exception 'reading promotions is restricted to FadeUp commercial staff'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  return query
  select p.id, p.code, p.kind, p.percent_off, p.amount_off_minor,
         p.duration, p.duration_in_months, p.starts_at, p.ends_at,
         p.max_redemptions, p.redeemed_count,
         (select count(*)::integer from public.promotion_redemptions r
           where r.promotion_id = p.id and r.status = 'active'),
         p.eligible_plan_keys, p.status, p.stripe_coupon_id,
         p.stripe_confirmed_at, p.stripe_error, p.note, p.created_at,
         u.email::text
  from public.promotions p
  left join auth.users u on u.id = p.created_by
  where coalesce(p_include_ended, false) or p.status = 'active'
  order by p.created_at desc;
end;
$function$;

create or replace function public.list_promotion_redemptions(p_promotion_id uuid default null)
returns table (
  id uuid,
  promotion_id uuid,
  code text,
  organization_id uuid,
  organization_name text,
  applied_via public.promotion_application,
  applied_at timestamptz,
  applied_by_email text,
  reason text,
  percent_off numeric,
  amount_off_minor integer,
  status public.promotion_status,
  revoked_at timestamptz,
  revoke_reason text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not (select private.platform_can('promotions.apply')) then
    raise exception 'reading promotion applications is restricted to FadeUp commercial staff'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  return query
  select r.id, r.promotion_id, p.code, r.organization_id, o.name,
         r.applied_via, r.applied_at, u.email::text, r.reason,
         r.percent_off, r.amount_off_minor, r.status, r.revoked_at, r.revoke_reason
  from public.promotion_redemptions r
  join public.promotions p on p.id = r.promotion_id
  join public.organizations o on o.id = r.organization_id
  left join auth.users u on u.id = r.applied_by
  where p_promotion_id is null or r.promotion_id = p_promotion_id
  order by r.applied_at desc;
end;
$function$;

-- CE QUE LE SALON VOIT : la sienne, et rien d'autre. Pas de liste, pas de
-- catalogue, aucun moyen d'apprendre qu'une autre promotion existe.
create or replace function public.get_my_organization_promotion(p_organization_id uuid)
returns table (
  code text,
  kind public.promotion_kind,
  percent_off numeric,
  amount_off_minor integer,
  duration public.promotion_duration,
  duration_in_months integer,
  applied_at timestamptz,
  applied_via public.promotion_application
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null
     or not (select private.has_org_role(p_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to read this organization''s discount'
      using errcode = '42501', detail = 'fadeup_promotion_refusal=not_authorized';
  end if;

  return query
  select p.code, p.kind, r.percent_off, r.amount_off_minor,
         p.duration, p.duration_in_months, r.applied_at, r.applied_via
  from public.promotion_redemptions r
  join public.promotions p on p.id = r.promotion_id
  where r.organization_id = p_organization_id and r.status = 'active';
end;
$function$;

-- CE QUE LA FONCTION EDGE DOIT AJOUTER À LA SESSION CHECKOUT.
-- Même garde que prepare_billing_checkout : propriétaire, hors vue empruntée.
create or replace function public.resolve_checkout_discount(p_organization_id uuid)
returns table (stripe_coupon_id text, code text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform private.assert_not_in_support_view('resolve_checkout_discount');
  perform private.assert_billing_owner(p_organization_id);

  return query
  select p.stripe_coupon_id, p.code
  from public.promotion_redemptions r
  join public.promotions p on p.id = r.promotion_id
  where r.organization_id = p_organization_id
    and r.status = 'active'
    and p.stripe_confirmed_at is not null
    and p.livemode = private.billing_livemode();
end;
$function$;

comment on function public.resolve_checkout_discount(uuid) is
  'Le contrat avec la fonction Edge stripe-billing : ce qu''elle doit poser dans discounts[0][coupon] au moment de créer la session Checkout. Rend zéro ligne quand il n''y a pas de remise — jamais une valeur vide à interpréter.';

revoke all on function public.create_promotion(text, public.promotion_kind, numeric, integer, public.promotion_duration, integer, timestamptz, timestamptz, integer, text[], text) from public, anon;
revoke all on function public.verify_promotion_sync(uuid) from public, anon;
revoke all on function public.end_promotion(uuid, text) from public, anon;
revoke all on function public.redeem_promotion_code(uuid, text) from public, anon;
revoke all on function public.apply_promotion(uuid, uuid, text) from public, anon;
revoke all on function public.revoke_promotion_redemption(uuid, text) from public, anon;
revoke all on function public.list_promotions(boolean) from public, anon;
revoke all on function public.list_promotion_redemptions(uuid) from public, anon;
revoke all on function public.get_my_organization_promotion(uuid) from public, anon;
revoke all on function public.resolve_checkout_discount(uuid) from public, anon;

grant execute on function public.create_promotion(text, public.promotion_kind, numeric, integer, public.promotion_duration, integer, timestamptz, timestamptz, integer, text[], text) to authenticated;
grant execute on function public.verify_promotion_sync(uuid) to authenticated;
grant execute on function public.end_promotion(uuid, text) to authenticated;
grant execute on function public.redeem_promotion_code(uuid, text) to authenticated;
grant execute on function public.apply_promotion(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_promotion_redemption(uuid, text) to authenticated;
grant execute on function public.list_promotions(boolean) to authenticated;
grant execute on function public.list_promotion_redemptions(uuid) to authenticated;
grant execute on function public.get_my_organization_promotion(uuid) to authenticated;
grant execute on function public.resolve_checkout_discount(uuid) to authenticated;

commit;
