-- B5 — retour arrière du chantier 1 (suppression de compte et export).
--
-- À APPLIQUER EN postgres.
--
-- Les cinq gardes reviennent à leur corps EXACT d'avant B5, copié verbatim
-- de la production (md5 comparé après down dans le bac d'essai fidèle).
-- La contrainte de clé étrangère des avis revient à NOT NULL + CASCADE :
-- c'est un RÉTRÉCISSEMENT, donc il échoue s'il reste un avis anonymisé en
-- base — refus voulu, pas un accident. Le remettre en force exigerait de
-- décider quoi faire de ces avis, ce qu'un down ne doit pas décider seul.

begin;

drop function if exists public.export_my_data();
drop function if exists public.delete_my_account();
drop function if exists private.erase_customer_account(uuid);
drop function if exists private.account_erasure_blockers(uuid);

drop trigger if exists account_erasure_log_append_only_truncate on public.account_erasure_log;
drop trigger if exists account_erasure_log_append_only on public.account_erasure_log;
drop table if exists public.account_erasure_log;
drop function if exists public.reject_account_erasure_log_mutation();

create or replace function public.reject_analytics_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'analytics_events is append-only: a recorded event cannot be modified'
      using errcode = '22023';
  end if;

  if coalesce(current_setting('fadeup.analytics_retention_purge', true), '') <> 'on' then
    raise exception 'analytics_events is append-only: events are removed only by the retention purge'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

create or replace function public.reviews_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.appointment_id  is distinct from old.appointment_id
     or new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id  is distinct from old.professional_id
     or new.organization_id  is distinct from old.organization_id
     or new.rating           is distinct from old.rating
     or new.comment          is distinct from old.comment
     or new.reviewer_display_name is distinct from old.reviewer_display_name
     or new.source           is distinct from old.source
     or new.external_attribution is distinct from old.external_attribution
     or new.created_at       is distinct from old.created_at then
    raise exception 'review core fields are immutable once submitted';
  end if;
  if old.reply_body is not null
     and (new.reply_body is distinct from old.reply_body
          or new.replied_at is distinct from old.replied_at
          or new.replied_by_user_id is distinct from old.replied_by_user_id) then
    raise exception 'a review reply is written once — one public reply per review';
  end if;
  return new;
end;
$$;

create or replace function public.guard_customers_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- X3 : l'absence de JWT n'exempte que les sessions serveur — jamais le
  -- rôle-claim 'anon' d'un client PostgREST.
  if ((select auth.uid()) is null
      and coalesce((select auth.role()), '') not in ('anon', 'authenticated'))
     or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$$;

create or replace function public.restrict_appointment_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Managing roles keep full edit rights untouched by this trigger.
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  -- public.reschedule_appointment() raises this for the single UPDATE it
  -- performs, after verifying the caller owns the appointment or manages the
  -- organization. current_setting(..., true) yields null when it was never
  -- set, so every ordinary path falls through to the restriction below.
  if coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on' then
    return new;
  end if;

  -- Everyone else who could reach this far already passed RLS as "the
  -- assigned barber" (appointments_update_self) — restrict them to status
  -- and notes only.
  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.chair_id is distinct from old.chair_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.buffer_before_minutes is distinct from old.buffer_before_minutes
    or new.buffer_after_minutes is distinct from old.buffer_after_minutes
  then
    raise exception 'a barber may only update status and notes on their own appointments';
  end if;

  return new;
end;
$$;

create or replace function public.restrict_queue_entry_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Une RPC de déplacement F1b (move_queue_entry) a déjà vérifié le droit —
  -- y compris pour un barber qui déplace vers un CONFRÈRE, ce que la règle
  -- ci-dessous interdit à raison en accès direct.
  if coalesce(current_setting('fadeup.queue_move', true), '') = '1' then
    return new;
  end if;

  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$$;

drop function if exists private.erasure_update_allowed(jsonb, jsonb, jsonb);
drop function if exists private.erasure_update_allowed(jsonb, jsonb, text[]);
drop function if exists private.account_erasure_active();
drop function if exists private.erasure_display_sentinel();

alter table public.reviews
  drop constraint reviews_customer_user_id_fkey;

alter table public.reviews
  alter column customer_user_id set not null;

alter table public.reviews
  add constraint reviews_customer_user_id_fkey
  foreign key (customer_user_id) references auth.users(id) on delete cascade;

comment on column public.reviews.customer_user_id is null;

commit;
