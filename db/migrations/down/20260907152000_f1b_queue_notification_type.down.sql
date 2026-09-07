-- F1b — retour arrière du type de notification queue_grace_removed.
--
-- Postgres ne sait pas retirer une valeur d'un enum : le retrait honnête
-- reconstruit le type (même procédé que le down B4) :
--   1. refuse de détruire des données — s'il reste des notifications de
--      balayage, il échoue bruyamment ;
--   2. sauvegarde puis recrée private.emit_booking_notification, la seule
--      fonction dont la SIGNATURE porte le type ;
--   3. reconstruit notification_type sans la valeur et re-type
--      notifications.type.
--
-- À exécuter APRÈS 20260907153000.down.sql (qui retire la passe productrice).

set lock_timeout = '5s';

begin;

do $$
declare
  v_count bigint;
  v_def text;
  v_social_def text;
begin
  select count(*) into v_count
  from public.notifications
  where type::text = 'queue_grace_removed';
  if v_count > 0 then
    raise exception 'cannot roll back queue_grace_removed: % notification rows still carry it. Delete them deliberately first.', v_count;
  end if;

  -- DEUX fonctions portent le type dans leur signature depuis B4 :
  -- private.emit_booking_notification ET private.notify_social.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'emit_booking_notification';

  if v_def is not null then
    drop function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text);
  end if;

  select pg_get_functiondef(p.oid) into v_social_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'notify_social';

  if v_social_def is not null then
    drop function private.notify_social(uuid, public.notification_type, text, text, uuid, text);
  end if;

  alter type public.notification_type rename to notification_type_f1b_old;

  create type public.notification_type as enum (
    'booking_request_created',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
    'booking_rescheduled',
    'team_invitation',
    'new_follower',
    'post_liked',
    'review_received',
    'review_reply'
  );

  alter table public.notifications
    alter column type type public.notification_type
    using type::text::public.notification_type;

  drop type public.notification_type_f1b_old;

  if v_def is not null then
    execute v_def;
    -- ACL d'origine : {postgres=X/postgres} — PUBLIC révoqué. Une fonction
    -- recréée sans ce revoke serait exécutable par authenticated via le
    -- défaut PUBLIC (vérifié au diff ACL du bac d'essai F1b).
    revoke execute on function private.emit_booking_notification(public.appointments, public.notification_type, text, text, text, text, text) from public;
  end if;
  if v_social_def is not null then
    execute v_social_def;
  end if;
end;
$$;

commit;
