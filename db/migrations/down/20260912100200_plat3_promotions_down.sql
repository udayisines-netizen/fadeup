-- Retour arrière de 20260912100200_plat3_promotions.sql — EN postgres.
--
-- CE QU'IL DÉTRUIT, à savoir avant de l'ordonner :
--
--   * TOUTES LES PROMOTIONS et TOUTES LEURS APPLICATIONS. Les tables sont
--     supprimées, pas vidées.
--   * ET C'EST LE PIÈGE : les COUPONS STRIPE, eux, NE SONT PAS SUPPRIMÉS.
--     Ils continuent d'exister chez Stripe, et une remise déjà posée sur un
--     abonnement vivant CONTINUE DE S'APPLIQUER À CHAQUE FACTURE — FadeUp
--     n'en aura simplement plus la trace. Avant d'ordonner ce retour arrière,
--     retirer les remises en cours (revoke_promotion_redemption) et archiver
--     les coupons dans le tableau de bord Stripe.
--   * le plafond par rôle, les deux droits et leurs attributions.
--
-- Le journal d'audit garde `promotion_created`, `promotion_applied`,
-- `promotion_revoked` et `promotion_ended` : il est en ajout seul. C'est la
-- seule mémoire qui survit, et c'est voulu.

begin;

drop function if exists public.resolve_checkout_discount(uuid);
drop function if exists public.get_my_organization_promotion(uuid);
drop function if exists public.list_promotion_redemptions(uuid);
drop function if exists public.list_promotions(boolean);
drop function if exists public.revoke_promotion_redemption(uuid, text);
drop function if exists public.apply_promotion(uuid, uuid, text);
drop function if exists public.redeem_promotion_code(uuid, text);
drop function if exists public.end_promotion(uuid, text);
drop function if exists public.verify_promotion_sync(uuid);
drop function if exists public.create_promotion(text, public.promotion_kind, numeric, integer, public.promotion_duration, integer, timestamptz, timestamptz, integer, text[], text);
drop function if exists private.record_promotion_redemption(public.promotions, uuid, public.promotion_application, text);
drop function if exists private.assert_promotion_applicable(public.promotions, uuid);
drop function if exists private.stripe_create_promotion_coupon(uuid);
drop function if exists private.promotion_actor_limits();

drop policy if exists promotion_redemptions_select on public.promotion_redemptions;
drop policy if exists promotions_select on public.promotions;
drop policy if exists promotion_role_limits_select on public.promotion_role_limits;

drop table if exists public.promotion_redemptions;
drop table if exists public.promotions;
drop table if exists public.promotion_role_limits;

drop type if exists public.promotion_application;
drop type if exists public.promotion_status;
drop type if exists public.promotion_duration;
drop type if exists public.promotion_kind;

delete from public.platform_role_permissions where permission_key in ('promotions.manage', 'promotions.apply');
delete from public.platform_permissions where key in ('promotions.manage', 'promotions.apply');

commit;
