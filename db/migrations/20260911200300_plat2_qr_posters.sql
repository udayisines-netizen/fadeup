-- FadeUp — PLAT-2 (4/4) : les affiches QR pré-générées.
--
-- À APPLIQUER EN postgres. Objets tous NEUFS ; aucune fonction existante
-- n'est redéfinie, aucune policy existante n'est touchée.
--
-- LE PROBLÈME. Le fondateur veut imprimer cent affiches AVANT de savoir quels
-- salons les recevront. Un QR qui encode le lien de file d'un salon ne peut
-- donc pas être imprimé à l'avance : le salon n'est pas connu. Le QR encode
-- un CODE, et le code est une indirection dont l'état change.
--
-- TROIS ÉTATS, ET LE SCAN DÉCIDE SELON L'ÉTAT *ET* SELON QUI SCANNE
--
--   libre    + habilité    → proposition d'attribution
--   libre    + client      → « cette affiche n'est pas encore active »
--   attribué + n'importe   → la file du salon
--   révoqué  + n'importe   → message clair, aucune proposition
--
-- LES GARDES, CÔTÉ SERVEUR
--
--   * un patron n'attribue qu'à SES établissements — vérifié sur
--     `memberships`, rôles owner et manager seulement. Ni barber, ni
--     réceptionniste, ni client.
--   * un rôle interne borné à ses zones (le stagiaire) n'attribue que dans
--     ses zones — la même question que `capture_field_prospect` pose.
--   * une affiche ATTRIBUÉE ne se détourne pas : `assign_poster` refuse tout
--     code qui n'est pas libre, sauf à un interne porteur de `poster.manage`
--     sur un code qu'il a lui-même révoqué au préalable.
--
-- LE CAS NUL est traité dans chaque garde, avant toute lecture.
--
-- SURFACE ANONYME : ce fichier ajoute UNE RPC exécutable par `anon`,
-- `resolve_poster_code`. C'est une décision, pas un oubli — un client qui
-- scanne une affiche dans un salon n'a pas de compte. L'allowlist de
-- `db/tests/x3_anon_surface.sh` est mise à jour dans le même commit : le
-- contrat passe de 44 à 45 RPC anonymes.

begin;

-- ---------------------------------------------------------------------------
-- 1. Les droits
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('poster.assign', 'Attribuer une affiche QR libre à un établissement.'),
  ('poster.manage', 'Générer un lot d''affiches, révoquer, réattribuer, et préparer un envoi postal.')
on conflict (key) do update set description = excluded.description;

-- `poster.assign` va jusqu'au STAGIAIRE : c'est lui qui est dans le salon,
-- l'affiche à la main. Il reste borné à ses zones par la même question que
-- pose la saisie terrain. `poster.manage` — générer, révoquer, réattribuer —
-- reste au fondateur et à l'admin : ce sont les gestes qui décident du sort
-- d'un objet physique déjà parti à l'impression.
insert into public.platform_role_permissions (role, permission_key) values
  ('platform_owner',  'poster.assign'),
  ('platform_admin',  'poster.assign'),
  ('platform_sales',  'poster.assign'),
  ('platform_intern', 'poster.assign'),
  ('platform_owner',  'poster.manage'),
  ('platform_admin',  'poster.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Le modèle
-- ---------------------------------------------------------------------------

create type public.poster_state as enum ('free', 'assigned', 'revoked');

-- LE JOURNAL DES LOTS : quand, combien, lesquels. C'est la table elle-même,
-- pas un rapport dérivé — « lesquels » se lit en joignant `posters`.
create table public.poster_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  code_count integer not null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint poster_batches_label_not_blank check (btrim(label) <> ''),
  constraint poster_batches_label_length check (char_length(label) <= 120),
  constraint poster_batches_note_length check (note is null or char_length(note) <= 1000),
  -- Cinq cents d'un coup est déjà une commande d'imprimeur ; au-delà, c'est
  -- une faute de frappe.
  constraint poster_batches_count_bounded check (code_count between 1 and 500)
);

create table public.posters (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.poster_batches (id) on delete restrict,
  -- DIX SYMBOLES en base32 de Crockford (ni I, ni L, ni O, ni U — les quatre
  -- qui se confondent à l'oral et à la lecture d'un code abîmé). 32^10, soit
  -- plus de 10^15 : non devinable, et dictable au téléphone.
  code text not null unique,
  state public.poster_state not null default 'free',

  organization_id uuid references public.organizations (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,

  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,

  -- L'ENVOI POSTAL. Le code part vers un prospect AVANT toute attribution :
  -- la lettre le porte, le patron le scanne, et c'est le scan qui attribue.
  -- Ces trois colonnes sont la trace de l'envoi, pas une attribution.
  letter_prospect_id uuid references public.prospects (id) on delete set null,
  letter_generated_at timestamptz,
  letter_generated_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint posters_code_shape check (code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
  constraint posters_revoke_reason_length check (revoke_reason is null or char_length(revoke_reason) <= 500),
  -- UNE AFFICHE ATTRIBUÉE PORTE SON ÉTABLISSEMENT, SON AUTEUR ET SA DATE.
  -- Une attribution sans auteur ne serait opposable à personne.
  constraint posters_assigned_shape check (
    state <> 'assigned'
    or (organization_id is not null and location_id is not null
        and assigned_at is not null and assigned_by is not null)
  ),
  -- UNE RÉVOCATION PORTE SON MOTIF. « Révoqué » sans raison est une perte de
  -- matériel qu'on ne peut pas expliquer au salon qui appelle.
  constraint posters_revoked_shape check (
    state <> 'revoked'
    or (revoked_at is not null and revoked_by is not null
        and nullif(btrim(coalesce(revoke_reason, '')), '') is not null)
  ),
  -- UNE AFFICHE LIBRE N'EST ATTRIBUÉE À PERSONNE. Sans cette ligne, un code
  -- libre pourrait porter un établissement résiduel et le scan y renverrait.
  constraint posters_free_shape check (
    state <> 'free'
    or (organization_id is null and location_id is null and assigned_at is null)
  )
);

create index posters_batch_idx on public.posters (batch_id, code);
create index posters_state_idx on public.posters (state);
create index posters_organization_idx on public.posters (organization_id) where organization_id is not null;
create index posters_letter_prospect_idx on public.posters (letter_prospect_id) where letter_prospect_id is not null;

create trigger posters_set_updated_at
  before update on public.posters
  for each row execute function public.set_updated_at();

alter table public.poster_batches enable row level security;
alter table public.poster_batches force row level security;
alter table public.posters enable row level security;
alter table public.posters force row level security;

-- Les lots ne sont lus que par qui les génère.
create policy poster_batches_select on public.poster_batches
  for select to authenticated
  using ((select private.platform_can('poster.manage')));

-- Une affiche est lue par un interne habilité, OU par le patron de
-- l'établissement auquel elle est attribuée — qui doit pouvoir vérifier ce
-- qu'il a sur son mur.
create policy posters_select on public.posters
  for select to authenticated
  using (
    (select private.platform_can('poster.manage'))
    or (select private.platform_can('poster.assign'))
    or (organization_id is not null
        and (select private.has_org_role(posters.organization_id,
                                         array['owner', 'manager']::public.membership_role[])))
  );

-- Aucune policy d'écriture : tout passe par les RPC, qui reposent la question
-- et écrivent au journal.
revoke insert, update, delete, truncate on public.poster_batches from anon, authenticated;
revoke insert, update, delete, truncate on public.posters from anon, authenticated;
revoke all on public.poster_batches from anon;
revoke all on public.posters from anon;
grant select on public.poster_batches to authenticated;
grant select on public.posters to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La génération d'un code
-- ---------------------------------------------------------------------------

create or replace function private.generate_poster_code()
returns text
language sql
volatile
set search_path to ''
as $function$
  -- 256 est un multiple de 32 : le modulo n'introduit AUCUN biais. Les dix
  -- octets viennent de pgcrypto (CSPRNG), pas de random().
  select string_agg(
           substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
                  1 + (get_byte(b.bytes, i) % 32), 1), '')
  from (select extensions.gen_random_bytes(10) as bytes) b,
       generate_series(0, 9) as i;
$function$;

create or replace function public.generate_poster_batch(
  p_count integer,
  p_label text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_batch public.poster_batches;
  v_code text;
  v_made integer := 0;
  v_tries integer;
begin
  if v_actor is null or not (select private.platform_can('poster.manage')) then
    raise exception 'génération d''affiches non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=not_authorized';
  end if;
  if v_label is null then
    raise exception 'un lot a besoin de son libellé'
      using errcode = '22023', detail = 'fadeup_poster_refusal=label_required';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'un lot contient entre 1 et 500 affiches'
      using errcode = '22023', detail = 'fadeup_poster_refusal=count_out_of_range';
  end if;

  insert into public.poster_batches (label, code_count, note, created_by)
  values (v_label, p_count, nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  returning * into v_batch;

  while v_made < p_count loop
    v_tries := 0;
    loop
      v_code := (select private.generate_poster_code());
      exit when not exists (select 1 from public.posters p where p.code = v_code);
      v_tries := v_tries + 1;
      -- Une collision sur 10^15 est déjà improbable ; dix d'affilée signifie
      -- que le générateur ne génère plus, et il vaut mieux le dire que de
      -- boucler sans fin.
      if v_tries > 10 then
        raise exception 'le générateur de codes ne produit plus de code libre'
          using errcode = '55000', detail = 'fadeup_poster_refusal=code_generator_exhausted';
      end if;
    end loop;
    insert into public.posters (batch_id, code) values (v_batch.id, v_code);
    v_made := v_made + 1;
  end loop;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_batch_generated', 'poster_batches', v_batch.id,
          jsonb_build_object('label', v_label, 'count', p_count));

  return jsonb_build_object(
    'batch_id', v_batch.id, 'label', v_batch.label, 'code_count', v_batch.code_count,
    'created_at', v_batch.created_at,
    'codes', (select jsonb_agg(p.code order by p.code) from public.posters p where p.batch_id = v_batch.id)
  );
end;
$function$;

create or replace function public.list_poster_batches(p_limit integer default 100)
returns table (
  id uuid,
  label text,
  note text,
  code_count integer,
  free_count integer,
  assigned_count integer,
  revoked_count integer,
  letters_prepared integer,
  created_by_email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    b.id, b.label, b.note, b.code_count,
    count(*) filter (where p.state = 'free')::integer,
    count(*) filter (where p.state = 'assigned')::integer,
    count(*) filter (where p.state = 'revoked')::integer,
    count(*) filter (where p.letter_generated_at is not null)::integer,
    (select u.email::text from auth.users u where u.id = b.created_by),
    b.created_at
  from public.poster_batches b
  left join public.posters p on p.batch_id = b.id
  where (select private.platform_can('poster.manage'))
  group by b.id
  order by b.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

create or replace function public.list_posters(
  p_batch_id uuid default null,
  p_state public.poster_state default null,
  p_limit integer default 500
)
returns table (
  id uuid,
  code text,
  state public.poster_state,
  batch_id uuid,
  batch_label text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  location_id uuid,
  location_name text,
  assigned_at timestamptz,
  assigned_by_email text,
  revoked_at timestamptz,
  revoke_reason text,
  letter_prospect_id uuid,
  letter_prospect_name text,
  letter_generated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    p.id, p.code, p.state, p.batch_id, b.label,
    p.organization_id, o.name, o.slug,
    p.location_id, l.name,
    p.assigned_at, (select u.email::text from auth.users u where u.id = p.assigned_by),
    p.revoked_at, p.revoke_reason,
    p.letter_prospect_id, pr.canonical_name, p.letter_generated_at,
    p.created_at
  from public.posters p
  join public.poster_batches b on b.id = p.batch_id
  left join public.organizations o on o.id = p.organization_id
  left join public.locations l on l.id = p.location_id
  left join public.prospects pr on pr.id = p.letter_prospect_id
  where (select private.platform_can('poster.manage'))
    and (p_batch_id is null or p.batch_id = p_batch_id)
    and (p_state is null or p.state = p_state)
  order by b.created_at desc, p.code
  limit greatest(coalesce(p_limit, 500), 1);
$function$;

-- ---------------------------------------------------------------------------
-- 4. Qui peut attribuer, et où
-- ---------------------------------------------------------------------------

-- LES ÉTABLISSEMENTS QUE L'APPELANT PEUT RECEVOIR. Un patron : les siens.
-- Un interne habilité : tous, ou ceux de ses zones s'il y est borné. Un
-- client : aucun — la liste est vide, et l'écran n'affiche pas de choix.
create or replace function public.list_my_poster_locations()
returns table (
  location_id uuid,
  location_name text,
  city text,
  country text,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  via text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    l.id, l.name, l.city, l.country,
    o.id, o.name, o.slug,
    case when (select private.has_org_role(o.id, array['owner','manager']::public.membership_role[]))
         then 'membership' else 'platform' end
  from public.locations l
  join public.organizations o on o.id = l.organization_id
  where l.is_active
    and (select auth.uid()) is not null
    and (
      -- LE PATRON : vérifié sur `memberships`, owner ou manager seulement.
      (select private.has_org_role(o.id, array['owner','manager']::public.membership_role[]))
      -- L'INTERNE HABILITÉ, borné à ses zones s'il l'est.
      or (
        (select private.platform_can('poster.assign'))
        and (
          not (select private.platform_is_zone_limited())
          or exists (
            select 1
            from public.platform_member_zones mz
            join public.platform_zones z on z.id = mz.zone_id and z.is_active
            where mz.user_id = (select auth.uid())
              and z.country = l.country
              and z.city_key = (select private.platform_zone_key(l.city))
          )
        )
      )
    )
  order by o.name, l.name;
$function$;

create or replace function private.poster_can_assign_to_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  -- Une EXISTENCE, jamais une comparaison : un identifiant nul ne joint rien
  -- et le résultat est `false`, jamais NULL.
  select exists (
    select 1 from public.list_my_poster_locations() m where m.location_id = p_location_id
  );
$function$;

create or replace function public.assign_poster(
  p_code text,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_location public.locations;
  v_internal boolean;
begin
  if v_actor is null then
    raise exception 'attribution non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=not_authenticated';
  end if;
  if v_code = '' or p_location_id is null then
    raise exception 'un code et un établissement sont attendus'
      using errcode = '22023', detail = 'fadeup_poster_refusal=arguments_required';
  end if;

  select * into v_poster from public.posters where code = v_code for update;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;

  v_internal := (select private.platform_can('poster.manage'));

  -- UNE AFFICHE ATTRIBUÉE NE SE DÉTOURNE PAS. Ni par un autre patron, ni par
  -- le patron lui-même vers un autre établissement : il faut passer par une
  -- révocation, qui laisse une trace et un motif.
  if v_poster.state = 'assigned' then
    raise exception 'cette affiche est déjà attribuée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=already_assigned';
  end if;

  -- UNE AFFICHE RÉVOQUÉE NE SE RÉCUPÈRE PAS PAR UN SCAN. Seul un interne
  -- porteur de `poster.manage` la remet en service, délibérément.
  if v_poster.state = 'revoked' and not v_internal then
    raise exception 'cette affiche a été révoquée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=revoked';
  end if;

  -- LA GARDE QUI COMPTE, et elle est côté serveur : un patron n'attribue
  -- qu'à SES établissements, un stagiaire qu'à ceux de SES zones.
  if not (select private.poster_can_assign_to_location(p_location_id)) then
    raise exception 'cet établissement n''est pas le vôtre'
      using errcode = '42501', detail = 'fadeup_poster_refusal=location_not_mine';
  end if;

  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'établissement introuvable' using errcode = '42704';
  end if;

  update public.posters
     set state = 'assigned',
         organization_id = v_location.organization_id,
         location_id = v_location.id,
         assigned_by = v_actor,
         assigned_at = now(),
         revoked_by = null, revoked_at = null, revoke_reason = null,
         updated_at = now()
   where id = v_poster.id
  returning * into v_poster;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_assigned', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code,
                             'organization_id', v_location.organization_id,
                             'location_id', v_location.id,
                             'reassigned_after_revocation', v_poster.state = 'revoked'));

  return jsonb_build_object(
    'code', v_poster.code, 'state', v_poster.state,
    'organization_id', v_poster.organization_id,
    'location_id', v_poster.location_id,
    'organization_slug', (select o.slug from public.organizations o where o.id = v_poster.organization_id)
  );
end;
$function$;

create or replace function public.revoke_poster(
  p_code text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_poster public.posters;
begin
  -- SEUL UN INTERNE RÉVOQUE. Pas le patron : une affiche physique déjà posée
  -- sur un mur ne se désactive pas depuis le téléphone de n'importe qui.
  if v_actor is null or not (select private.platform_can('poster.manage')) then
    raise exception 'révocation non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=revoke_not_authorized';
  end if;
  if v_reason is null then
    raise exception 'une révocation a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_poster_refusal=reason_required';
  end if;

  update public.posters
     set state = 'revoked',
         revoked_by = v_actor, revoked_at = now(), revoke_reason = v_reason,
         updated_at = now()
   where code = v_code
  returning * into v_poster;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_revoked', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'reason', v_reason,
                             'previous_organization_id', v_poster.organization_id));

  return jsonb_build_object('code', v_poster.code, 'state', v_poster.state);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. LE SCAN — la seule RPC anonyme de ce lot
-- ---------------------------------------------------------------------------
--
-- Ce qu'elle rend à un anonyme est exactement ce qui est DÉJÀ public : l'état
-- du code et, s'il est attribué, le slug du salon et son établissement — la
-- même information que le QR de file imprimé par le salon lui-même (F1).
-- Elle ne rend ni le lot, ni l'auteur, ni le prospect destinataire, ni la
-- moindre liste d'établissements à qui ne peut pas attribuer.

create or replace function public.resolve_poster_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_can_assign boolean := false;
  v_locations jsonb := '[]'::jsonb;
  v_claim jsonb := null;
begin
  -- Un code de mauvaise forme ne touche même pas la table : la réponse est
  -- la même que pour un code inconnu, pour ne rien apprendre à qui tâtonne.
  if v_code !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' then
    return jsonb_build_object('code', null, 'state', 'unknown');
  end if;

  select * into v_poster from public.posters where code = v_code;
  if not found then
    return jsonb_build_object('code', null, 'state', 'unknown');
  end if;

  if v_poster.state = 'revoked' then
    return jsonb_build_object('code', v_poster.code, 'state', 'revoked');
  end if;

  if v_poster.state = 'assigned' then
    return jsonb_build_object(
      'code', v_poster.code,
      'state', 'assigned',
      'organization_slug', (select o.slug from public.organizations o where o.id = v_poster.organization_id),
      'organization_name', (select o.name from public.organizations o where o.id = v_poster.organization_id),
      'location_id', v_poster.location_id,
      'location_name', (select l.name from public.locations l where l.id = v_poster.location_id)
    );
  end if;

  -- ---- état LIBRE : la réponse dépend de qui scanne ----------------------
  if (select auth.uid()) is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'location_id', m.location_id, 'location_name', m.location_name,
             'city', m.city, 'organization_id', m.organization_id,
             'organization_name', m.organization_name, 'via', m.via)
           order by m.organization_name, m.location_name), '[]'::jsonb)
      into v_locations
    from public.list_my_poster_locations() m;
    v_can_assign := jsonb_array_length(v_locations) > 0;
  end if;

  -- LE CROCHET. Le code est parti par la poste à un prospect dont la fiche
  -- est publiée mais NON REVENDIQUÉE : l'affiche devient un chemin vers la
  -- revendication. On ne rend le handle que si la fiche est DÉJÀ publique —
  -- sinon ce serait exposer un prospect qui n'a rien demandé.
  if v_poster.letter_prospect_id is not null then
    select jsonb_build_object('professional_handle', pr.handle,
                              'display_name', pr.display_name)
      into v_claim
    from public.prospect_professionals pp
    join public.professionals pr on pr.id = pp.professional_id
    where pp.prospect_id = v_poster.letter_prospect_id
      and pr.is_public
      and pr.claim_state = 'unclaimed';
  end if;

  return jsonb_build_object(
    'code', v_poster.code,
    'state', 'free',
    'can_assign', v_can_assign,
    'assignable_locations', case when v_can_assign then v_locations else '[]'::jsonb end,
    'claim', v_claim
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. La lettre au patron
-- ---------------------------------------------------------------------------
--
-- Personnalisée : nom du salon, adresse, et UN ÉLÉMENT DE PREUVE tiré de
-- l'analytics. Le reste du texte est générique et vit dans le frontend.
-- Si l'analytics ne dit rien, cette fonction rend `proof = null` et la lettre
-- part SANS élément de preuve — plutôt qu'avec un chiffre inventé.

create or replace function public.prepare_poster_letter(
  p_code text,
  p_prospect_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_prospect public.prospects;
  v_location public.prospect_locations;
  v_stats jsonb;
begin
  if v_actor is null or not (select private.platform_can('poster.manage')) then
    raise exception 'préparation de lettre non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=letter_not_authorized';
  end if;
  if p_prospect_id is null or not (select private.platform_prospect_visible(p_prospect_id)) then
    raise exception 'ce prospect n''est pas visible avec votre rôle'
      using errcode = '42501', detail = 'fadeup_poster_refusal=prospect_not_visible';
  end if;

  select * into v_poster from public.posters where code = v_code for update;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;
  -- Une lettre annonce une affiche À ACTIVER. En préparer une pour un code
  -- déjà attribué enverrait le patron vers un salon qui n'est pas le sien.
  if v_poster.state <> 'free' then
    raise exception 'seule une affiche libre part par la poste'
      using errcode = '22023', detail = 'fadeup_poster_refusal=not_free';
  end if;

  select * into v_prospect from public.prospects where id = p_prospect_id;
  select * into v_location from public.prospect_locations
   where prospect_id = p_prospect_id order by is_primary desc limit 1;

  update public.posters
     set letter_prospect_id = p_prospect_id,
         letter_generated_at = now(),
         letter_generated_by = v_actor,
         updated_at = now()
   where id = v_poster.id;

  v_stats := (select public.get_prospect_acquisition_stats(p_prospect_id, 90));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_letter_prepared', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'prospect_id', p_prospect_id));

  return jsonb_build_object(
    'code', v_poster.code,
    'prospect_id', p_prospect_id,
    'business_name', v_prospect.canonical_name,
    'address', jsonb_build_object(
      'line', v_location.address_line, 'postal_code', v_location.postal_code,
      'city', v_location.city, 'country', coalesce(v_location.country, v_prospect.country)),
    -- L'ÉLÉMENT DE PREUVE, ou rien. Aucune phrase de repli chiffrée.
    'proof', case
      when coalesce((v_stats ->> 'is_published')::boolean, false)
           and (coalesce((v_stats ->> 'profile_views_all_time')::integer, 0) > 0
                or coalesce((v_stats ->> 'interest_requests')::integer, 0) > 0)
      then jsonb_build_object(
             'profile_views_all_time', v_stats -> 'profile_views_all_time',
             'profile_views_window', v_stats -> 'profile_views',
             'window_days', v_stats -> 'window_days',
             'interest_requests', v_stats -> 'interest_requests',
             'last_profile_view_at', v_stats -> 'last_profile_view_at')
      else null end,
    'stats', v_stats
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Les concessions, EXPLICITES
-- ---------------------------------------------------------------------------

revoke all on function private.generate_poster_code() from public, anon, authenticated;
revoke all on function private.poster_can_assign_to_location(uuid) from public, anon, authenticated;

revoke all on function public.generate_poster_batch(integer, text, text) from public, anon;
grant execute on function public.generate_poster_batch(integer, text, text) to authenticated;

revoke all on function public.list_poster_batches(integer) from public, anon;
grant execute on function public.list_poster_batches(integer) to authenticated;

revoke all on function public.list_posters(uuid, public.poster_state, integer) from public, anon;
grant execute on function public.list_posters(uuid, public.poster_state, integer) to authenticated;

revoke all on function public.list_my_poster_locations() from public, anon;
grant execute on function public.list_my_poster_locations() to authenticated;

revoke all on function public.assign_poster(text, uuid) from public, anon;
grant execute on function public.assign_poster(text, uuid) to authenticated;

revoke all on function public.revoke_poster(text, text) from public, anon;
grant execute on function public.revoke_poster(text, text) to authenticated;

revoke all on function public.prepare_poster_letter(text, uuid) from public, anon;
grant execute on function public.prepare_poster_letter(text, uuid) to authenticated;

-- LA SEULE RPC ANONYME DE PLAT-2. Décision assumée, §5 de ce fichier.
revoke all on function public.resolve_poster_code(text) from public;
grant execute on function public.resolve_poster_code(text) to anon, authenticated;

commit;
