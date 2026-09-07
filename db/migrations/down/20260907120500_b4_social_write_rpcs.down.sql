-- FadeUp — B4 chantiers 4 (2/2) et 5 (2/2), retour arrière.
--
-- Retire les RPC d'écriture, les triggers de notification sociale et les
-- gabarits e-mail B4. Les notifications et e-mails déjà émis pendant que la
-- migration était en vigueur ne sont PAS supprimés : ce sont des faits
-- advenus, pas du schéma. Les lignes d'outbox non parties référencant les
-- gabarits retirés échoueraient au rendu — le script le signale s'il en
-- reste.

set lock_timeout = '5s';

begin;

do $$
declare
  v_pending bigint;
begin
  select count(*) into v_pending
  from public.email_outbox
  where template in ('review_received','review_reply')
    and status not in ('sent','failed');
  if v_pending > 0 then
    raise notice '% email_outbox rows still reference the review templates being removed; they will fail rendering until handled.', v_pending;
  end if;
end;
$$;

drop trigger if exists reviews_notify_reply on public.reviews;
drop trigger if exists reviews_notify_received on public.reviews;
drop trigger if exists post_likes_notify on public.post_likes;
drop trigger if exists organization_follows_notify on public.organization_follows;
drop trigger if exists professional_follows_notify on public.professional_follows;

drop function if exists public.notify_review_reply();
drop function if exists public.notify_review_received();
drop function if exists public.notify_post_like();
drop function if exists public.notify_organization_follow();
drop function if exists public.notify_professional_follow();
drop function if exists private.notify_social(uuid, public.notification_type, text, text, uuid, text);

drop function if exists public.resolve_review_report(uuid, text);
drop function if exists public.moderate_review(uuid, text, text);
drop function if exists public.report_review(uuid, text, text);
drop function if exists public.reply_to_review(uuid, text);
drop function if exists public.submit_review(uuid, integer, text, text, boolean);
drop function if exists public.unlike_post(uuid);
drop function if exists public.like_post(uuid);
drop function if exists public.delete_post(uuid);
drop function if exists public.create_post(text, jsonb, text, text, uuid, uuid, uuid[]);

delete from public.email_templates
 where template_key in ('review_received','review_reply');

commit;
