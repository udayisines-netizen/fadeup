-- FadeUp — OS-2 : les notes privées client.
--
-- RÔLE D'APPLICATION : postgres (objets NEUFS uniquement — DB_OWNERSHIP §3
-- règle 1). Aucune fonction `supabase_admin` n'est redéfinie ici.
--
-- CE QUE TRANCHE CE FICHIER
--
-- Le fondateur : « notes visibles par l'équipe du salon, plus support,
-- modérateur, admin, fondateur ; commerciaux et stagiaires exclus ; chaque
-- consultation par un rôle interne est tracée ; le client peut demander ce
-- qui est écrit sur lui ».
--
-- 1. STOCKAGE. `customers.notes` existe (texte libre, une seule case, sans
--    auteur ni date, 0 ligne en production, aucun écrivain dans le code V2 —
--    seul `src/lib/queries/customers.ts`, module mort non importé, la
--    référence). Une case unique ne permet NI de savoir qui a écrit quoi, NI
--    de répondre honnêtement à un droit d'accès. OS-2 crée donc
--    `customer_notes` : une note = une ligne, un auteur, une date. La
--    colonne héritée reste en place (rien n'est supprimé) mais devient
--    INÉCRIVABLE : un trigger refuse toute valeur non nulle en la nommant.
--    Sans cela la frontière d'audit posée ici aurait une porte dérobée.
--
-- 2. ACCÈS ÉQUIPE. RLS : lecture par tout membre de l'organisation — un
--    barber écrit et lit les notes du salon où il travaille. Écriture par
--    tout membre, pour lui-même. Correction/suppression : l'auteur, ou
--    owner/manager.
--
-- 3. ACCÈS INTERNE. AUCUN rôle plateforme n'est dans la policy RLS — ni
--    `is_platform_admin()`, ni rien. Le chemin interne est UNE RPC,
--    `list_customer_notes`, qui exige le droit NEUF `customer_notes.read`
--    (fondateur, admin, support, modérateur) et ÉCRIT une ligne d'audit
--    PLAT-1 à chaque consultation. `platform_sales` et `platform_intern`
--    n'ont pas ce droit : ils ne lisent rien, et c'est testé.
--
-- 4. DROIT D'ACCÈS RGPD. `get_my_customer_notes()` rend au SUJET lui-même
--    tout ce que les salons ont écrit sur lui, tous salons confondus,
--    résolu par `customers.user_id = auth.uid()`. La donnée est donc
--    extractible sans intervention humaine ; l'écran client viendra plus
--    tard (prompt OS-2 §2).
--
-- LE MOTIF NUL (X3). Chaque garde évalue une EXISTENCE ou compare une
-- variable déjà testée `is null` — jamais `colonne = auth.uid()` dans un
-- `if not (...)`, dont la valeur NULL ne lève pas.

begin;

-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_notes_body_not_blank check (btrim(body) <> ''),
  constraint customer_notes_body_length check (char_length(body) <= 2000)
);

comment on table public.customer_notes is
  'Notes privées du salon sur un client. Une note = une ligne, un auteur, une date. Lisible par l''équipe de l''organisation (RLS) ; les rôles internes passent OBLIGATOIREMENT par list_customer_notes(), qui exige customer_notes.read et trace. Le sujet lit les siennes par get_my_customer_notes() (droit d''accès RGPD).';
comment on column public.customer_notes.author_user_id is
  'Auteur. Nullable : un compte supprimé ne fait pas disparaître la note du salon (ON DELETE SET NULL) — l''information reste, la personne non.';

create index if not exists customer_notes_customer_idx
  on public.customer_notes (customer_id, created_at desc);
create index if not exists customer_notes_organization_idx
  on public.customer_notes (organization_id);
create index if not exists customer_notes_author_idx
  on public.customer_notes (author_user_id) where author_user_id is not null;

-- Cohérence client ↔ organisation, le motif des autres tables du domaine.
create or replace function public.check_customer_note_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization_id as the note'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.check_customer_note_consistency() is
  'Interdit une note rattachée à un client d''une autre organisation. Motif des triggers check_*_consistency du domaine.';

drop trigger if exists customer_notes_check_consistency on public.customer_notes;
create trigger customer_notes_check_consistency
  before insert or update on public.customer_notes
  for each row execute function public.check_customer_note_consistency();

drop trigger if exists customer_notes_set_updated_at on public.customer_notes;
create trigger customer_notes_set_updated_at
  before update on public.customer_notes
  for each row execute function public.set_updated_at();

alter table public.customer_notes enable row level security;
alter table public.customer_notes force row level security;

drop policy if exists customer_notes_select on public.customer_notes;
create policy customer_notes_select
  on public.customer_notes
  for select
  to authenticated
  using ((select private.is_org_member(customer_notes.organization_id)));

comment on policy customer_notes_select on public.customer_notes is
  'L''équipe du salon, et elle seule. AUCUN rôle plateforme ici : l''accès interne passe par list_customer_notes(), qui trace. Ajouter is_platform_admin() ici rouvrirait une lecture non tracée.';

drop policy if exists customer_notes_insert on public.customer_notes;
create policy customer_notes_insert
  on public.customer_notes
  for insert
  to authenticated
  with check (
    (select private.is_org_member(customer_notes.organization_id))
    and author_user_id = (select auth.uid())
  );

drop policy if exists customer_notes_update on public.customer_notes;
create policy customer_notes_update
  on public.customer_notes
  for update
  to authenticated
  using (
    (select private.is_org_member(customer_notes.organization_id))
    and (
      author_user_id = (select auth.uid())
      or (select private.has_org_role(customer_notes.organization_id,
            array['owner', 'manager']::public.membership_role[]))
    )
  )
  with check (
    (select private.is_org_member(customer_notes.organization_id))
    and (
      author_user_id = (select auth.uid())
      or (select private.has_org_role(customer_notes.organization_id,
            array['owner', 'manager']::public.membership_role[]))
    )
  );

drop policy if exists customer_notes_delete on public.customer_notes;
create policy customer_notes_delete
  on public.customer_notes
  for delete
  to authenticated
  using (
    (select private.is_org_member(customer_notes.organization_id))
    and (
      author_user_id = (select auth.uid())
      or (select private.has_org_role(customer_notes.organization_id,
            array['owner', 'manager']::public.membership_role[]))
    )
  );

-- AUCUN privilège de table pour `authenticated`, et c'est le point de
-- l'affaire. Les quatre policies ci-dessus restent en place comme SECONDE
-- couche — si un jour un privilège de table revient, elles gouverneront —
-- mais le chemin normal est FERMÉ : les quatre RPC ci-dessous sont
-- SECURITY DEFINER et sont le SEUL accès.
--
-- Pourquoi cette sévérité ici et pas ailleurs : avec un simple
-- `grant select`, PostgREST exposerait `/rest/v1/customer_notes` à tout
-- membre d'un salon, avec filtre libre — un seul GET suffirait à aspirer
-- toutes les notes de l'organisation. La RLS ne l'interdirait pas (l'équipe
-- A le droit de les lire), mais une lecture en masse n'est pas une
-- consultation de fiche. `list_customer_notes` lit UN client à la fois,
-- et c'est elle qui porte la trace pour les rôles internes. On ne laisse
-- pas une porte plus large à côté de la porte qu'on surveille.
revoke all on public.customer_notes from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. La colonne héritée `customers.notes` — condamnée, pas supprimée
-- ---------------------------------------------------------------------------

create or replace function public.reject_legacy_customer_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.notes is not null and btrim(new.notes) <> ''
     and (tg_op = 'INSERT' or new.notes is distinct from old.notes) then
    raise exception 'customers.notes is retired: write to public.customer_notes instead'
      using errcode = '42501',
            detail = 'fadeup_customer_notes_refusal=legacy_column',
            hint = 'La case unique n''a ni auteur, ni date, ni trace de consultation. OS-2 lui substitue customer_notes.';
  end if;
  return new;
end;
$$;

comment on function public.reject_legacy_customer_notes() is
  'Condamne customers.notes (0 ligne en production, aucun écrivain V2). Sans ce refus, une écriture future contournerait en silence la frontière d''audit de customer_notes.';

drop trigger if exists customers_reject_legacy_notes on public.customers;
create trigger customers_reject_legacy_notes
  before insert or update on public.customers
  for each row execute function public.reject_legacy_customer_notes();

comment on column public.customers.notes is
  'RETIRÉE par OS-2 (2026-09-11). Conservée pour ne rien détruire ; inécrivable (trigger customers_reject_legacy_notes). Les notes privées vivent dans public.customer_notes.';

-- ---------------------------------------------------------------------------
-- 3. Le droit interne NEUF — et à qui il est donné
-- ---------------------------------------------------------------------------

insert into public.platform_permissions (key, description) values
  ('customer_notes.read',
   'Lire les notes privées qu''un salon a écrites sur un de ses clients. Chaque lecture est tracée.')
on conflict (key) do update set description = excluded.description;

insert into public.platform_role_permissions (role, permission_key) values
  ('platform_owner',     'customer_notes.read'),
  ('platform_admin',     'customer_notes.read'),
  ('platform_support',   'customer_notes.read'),
  ('platform_moderator', 'customer_notes.read')
on conflict do nothing;

-- platform_sales et platform_intern : RIEN. Pas de CRM client, pas de besoin
-- métier — décision du fondateur, testée par verify_os2.sql.

-- ---------------------------------------------------------------------------
-- 4. Les RPC
-- ---------------------------------------------------------------------------

create or replace function public.list_customer_notes(p_customer_id uuid)
returns table (
  id uuid,
  body text,
  author_user_id uuid,
  author_display_name text,
  author_is_me boolean,
  can_edit boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile                       -- elle ÉCRIT la trace : jamais STABLE.
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_organization_id uuid;
  v_is_member boolean;
  v_can_manage boolean;
  v_internal boolean;
  v_count integer;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=anonymous';
  end if;

  select c.organization_id into v_organization_id
  from public.customers c where c.id = p_customer_id;

  -- Client inconnu : même refus qu'un client d'autrui, pour ne pas servir
  -- d'oracle d'existence.
  if v_organization_id is null then
    raise exception 'not authorized to read this customer''s notes'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=not_authorized';
  end if;

  v_is_member  := (select private.is_org_member(v_organization_id));
  v_can_manage := (select private.has_org_role(v_organization_id,
                     array['owner', 'manager']::public.membership_role[]));
  v_internal   := (select private.platform_can('customer_notes.read'));

  if not v_is_member and not v_internal then
    raise exception 'not authorized to read this customer''s notes'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=not_authorized';
  end if;

  -- LA TRACE. Un membre du salon lit ses propres notes : rien à tracer. Un
  -- rôle interne lit celles d'autrui : c'est consigné, même si la fiche est
  -- vide — la tentative compte autant que le résultat.
  if v_internal and not v_is_member then
    select count(*)::integer into v_count
    from public.customer_notes n where n.customer_id = p_customer_id;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_actor,
      'customer_notes_read',
      'customers',
      p_customer_id,
      jsonb_build_object(
        'organization_id', v_organization_id,
        'note_count', v_count,
        'support_session_id', (select private.platform_active_support_session())
      )
    );
  end if;

  return query
  select
    n.id,
    n.body,
    n.author_user_id,
    coalesce(nullif(btrim(sp.display_name), ''), nullif(btrim(pr.full_name), '')),
    n.author_user_id is not distinct from v_actor,
    v_is_member and (n.author_user_id is not distinct from v_actor or v_can_manage),
    n.created_at,
    n.updated_at
  from public.customer_notes n
  left join public.staff_profiles sp
    on sp.organization_id = n.organization_id and sp.user_id = n.author_user_id
  left join public.profiles pr on pr.id = n.author_user_id
  where n.customer_id = p_customer_id
  order by n.created_at desc;
end;
$$;

comment on function public.list_customer_notes(uuid) is
  'Les notes privées d''un client. Équipe du salon : lecture directe, non tracée (ce sont ses notes). Rôle interne portant customer_notes.read : lecture TRACÉE dans platform_audit_log (action customer_notes_read). Tout autre appelant : 42501.';

revoke all on function public.list_customer_notes(uuid) from public, anon;
grant execute on function public.list_customer_notes(uuid) to authenticated;


create or replace function public.add_customer_note(p_customer_id uuid, p_body text)
returns public.customer_notes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_organization_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.customer_notes;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=anonymous';
  end if;

  if v_body = '' then
    raise exception 'a note cannot be empty'
      using errcode = '22023', detail = 'fadeup_customer_notes_refusal=empty_body';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'a note is limited to 2000 characters'
      using errcode = '22023', detail = 'fadeup_customer_notes_refusal=body_too_long';
  end if;

  select c.organization_id into v_organization_id
  from public.customers c where c.id = p_customer_id;

  if v_organization_id is null
     or not (select private.is_org_member(v_organization_id)) then
    raise exception 'not authorized to write a note on this customer'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=not_authorized';
  end if;

  insert into public.customer_notes (organization_id, customer_id, author_user_id, body)
  values (v_organization_id, p_customer_id, v_actor, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.add_customer_note(uuid, text) is
  'Écrit une note privée. Tout membre de l''organisation, pour lui-même (l''auteur est auth.uid(), jamais un paramètre). Un rôle interne n''écrit PAS : il ne fait que consulter, sous trace.';

revoke all on function public.add_customer_note(uuid, text) from public, anon;
grant execute on function public.add_customer_note(uuid, text) to authenticated;


create or replace function public.update_customer_note(p_note_id uuid, p_body text)
returns public.customer_notes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_note public.customer_notes;
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.customer_notes;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=anonymous';
  end if;

  if v_body = '' then
    raise exception 'a note cannot be empty'
      using errcode = '22023', detail = 'fadeup_customer_notes_refusal=empty_body';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'a note is limited to 2000 characters'
      using errcode = '22023', detail = 'fadeup_customer_notes_refusal=body_too_long';
  end if;

  select * into v_note from public.customer_notes n where n.id = p_note_id;

  if v_note.id is null
     or not (select private.is_org_member(v_note.organization_id))
     or not (
       v_note.author_user_id is not distinct from v_actor
       or (select private.has_org_role(v_note.organization_id,
             array['owner', 'manager']::public.membership_role[]))
     ) then
    raise exception 'not authorized to edit this note'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=not_authorized';
  end if;

  update public.customer_notes n set body = v_body
   where n.id = p_note_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.update_customer_note(uuid, text) is
  'Corrige une note. L''auteur, ou owner/manager. L''auteur d''origine n''est jamais réécrit.';

revoke all on function public.update_customer_note(uuid, text) from public, anon;
grant execute on function public.update_customer_note(uuid, text) to authenticated;


create or replace function public.delete_customer_note(p_note_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_note public.customer_notes;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=anonymous';
  end if;

  select * into v_note from public.customer_notes n where n.id = p_note_id;

  if v_note.id is null
     or not (select private.is_org_member(v_note.organization_id))
     or not (
       v_note.author_user_id is not distinct from v_actor
       or (select private.has_org_role(v_note.organization_id,
             array['owner', 'manager']::public.membership_role[]))
     ) then
    raise exception 'not authorized to delete this note'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=not_authorized';
  end if;

  delete from public.customer_notes n where n.id = p_note_id;
end;
$$;

comment on function public.delete_customer_note(uuid) is
  'Supprime une note. L''auteur, ou owner/manager. Une note n''est pas un historique commercial : elle est effaçable, et c''est aussi ce qui permet de répondre à un droit d''effacement.';

revoke all on function public.delete_customer_note(uuid) from public, anon;
grant execute on function public.delete_customer_note(uuid) to authenticated;


create or replace function public.get_my_customer_notes()
returns table (
  organization_id uuid,
  organization_name text,
  note_id uuid,
  body text,
  author_display_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Le motif nul : sans ce refus explicite, un appel anonyme joindrait
  -- `c.user_id = NULL` — zéro ligne, donc pas de fuite, mais un 200 qui
  -- ferait croire « rien d'écrit sur vous ». On répond ce qui est vrai.
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_customer_notes_refusal=anonymous';
  end if;

  return query
  select
    n.organization_id,
    o.name,
    n.id,
    n.body,
    coalesce(nullif(btrim(sp.display_name), ''), nullif(btrim(pr.full_name), '')),
    n.created_at,
    n.updated_at
  from public.customer_notes n
  join public.customers c on c.id = n.customer_id
  join public.organizations o on o.id = n.organization_id
  left join public.staff_profiles sp
    on sp.organization_id = n.organization_id and sp.user_id = n.author_user_id
  left join public.profiles pr on pr.id = n.author_user_id
  where c.user_id = v_actor
  order by n.created_at desc;
end;
$$;

comment on function public.get_my_customer_notes() is
  'DROIT D''ACCÈS RGPD (art. 15) : tout ce que les salons ont écrit sur le demandeur, tous salons confondus, résolu par customers.user_id. Rend la donnée extractible sans intervention humaine ; l''écran client viendra plus tard.';

revoke all on function public.get_my_customer_notes() from public, anon;
grant execute on function public.get_my_customer_notes() to authenticated;

commit;
