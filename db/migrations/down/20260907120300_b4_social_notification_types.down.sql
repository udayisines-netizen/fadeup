-- FadeUp — B4 chantier 5 (1/2), retour arrière.
--
-- Postgres ne sait pas retirer une valeur d'un enum : le retrait honnête
-- reconstruit le type. Ce script :
--   1. refuse de détruire des données — s'il reste des notifications
--      sociales, il échoue bruyamment ;
--   2. sauvegarde puis recrée private.emit_booking_notification, la seule
--      fonction dont la SIGNATURE porte le type (les autres ne l'utilisent
--      que dans leur corps, sans dépendance statique) ;
--   3. reconstruit notification_type sans les quatre valeurs sociales et
--      re-type notifications.type.
--
-- À exécuter APRÈS 20260907120500.down.sql (qui retire les triggers
-- producteurs de ces valeurs).

set lock_timeout = '5s';

begin;

do $$
declare
  v_count bigint;
  v_def text;
begin
  select count(*) into v_count
  from public.notifications
  where type::text in ('new_follower','post_liked','review_received','review_reply');
  if v_count > 0 then
    raise exception 'cannot roll back social notification types: % notification rows still carry them. Delete them deliberately first.', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'emit_booking_notification';

  if v_def is not null then
    drop function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text);
  end if;

  alter type public.notification_type rename to notification_type_b4_old;

  create type public.notification_type as enum (
    'booking_request_created',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
    'booking_rescheduled',
    'team_invitation'
  );

  alter table public.notifications
    alter column type type public.notification_type
    using type::text::public.notification_type;

  drop type public.notification_type_b4_old;

  if v_def is not null then
    execute v_def;
    -- ACL d'origine de la fonction : aucune explicite (helper private appelé
    -- par des fonctions definer possédées par postgres) — rien à restaurer.
  end if;
end;
$$;

commit;
