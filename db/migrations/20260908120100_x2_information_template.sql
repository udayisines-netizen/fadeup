-- FadeUp — X2 : le gabarit de l'e-mail d'information (article 14 RGPD).
--
-- À APPLIQUER EN postgres.
--
-- DEUX E-MAILS, PAS UN
--
--   L'e-mail de PROSPECTION (B2) part quand une demande client arrive : « un
--   client souhaite réserver chez vous ». C'est un acte commercial.
--
--   CET e-mail part à la PUBLICATION de la fiche : votre fiche existe, voici
--   pourquoi, voici vos droits, voici comment la retirer. C'est une
--   obligation légale, et il ne vend RIEN — pas d'abonnement, pas de tarif,
--   pas d'offre, pas d'appel à réserver. Un e-mail qui informe ET vend
--   mélange les deux registres, et un professionnel mécontent y verrait un
--   argument. verify_x2.sql contrôle l'absence de vocabulaire commercial sur
--   le texte rendu, mot à mot.
--
--   Le flux reste 'prospecting' : ce n'est pas une question de contenu mais
--   de RÉPUTATION — ce message va à des destinataires qui ne nous ont rien
--   demandé, exactement la population dont les plaintes et rebonds ne
--   doivent jamais toucher le domaine des liens magiques (BLOCKERS §6).
--   Il porte donc aussi les en-têtes List-Unsubscribe du flux.
--
-- Placeholders : display_name, profile_url, info_url, withdrawal_url,
-- unsubscribe_url — tous résolus par private.enqueue_publication_information ;
-- un jeton non résolu fait échouer le rendu (garde B2, 22023).
--
-- Idempotent : on conflict do update, comme les gabarits B2.

set lock_timeout = '5s';

begin;

-- La même coquille HTML que B2 (20260904180400) : créée, utilisée, supprimée
-- en fin de fichier — un outil de migration, pas une API.

create or replace function pg_temp_x2_shell(p_heading text, p_body_html text, p_footer_html text default '')
returns text
language sql
immutable
as $$
  select concat(
'<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f6;">',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f6;padding:32px 16px;">',
'<tr><td align="center">',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8e7;border-radius:12px;">',
'<tr><td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;">',
'<div style="font-size:14px;font-weight:600;color:#00875A;letter-spacing:0.02em;">FadeUp</div>',
'<h1 style="margin:16px 0 0 0;font-size:22px;line-height:1.3;color:#080F0D;font-weight:600;">', p_heading, '</h1>',
'</td></tr>',
'<tr><td style="padding:8px 32px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#2c3330;">',
p_body_html,
'</td></tr>',
'</table>',
case when p_footer_html = '' then '' else
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td style="padding:16px 32px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b736f;">'
|| p_footer_html || '</td></tr></table>' end,
'</td></tr></table></body></html>');
$$;

create or replace function pg_temp_x2_button(p_url text, p_label text)
returns text
language sql
immutable
as $$
  select '<p style="margin:24px 0;"><a href="' || p_url || '" style="display:inline-block;background:#00C27A;color:#080F0D;text-decoration:none;font-weight:600;font-size:16px;padding:12px 20px;border-radius:8px;">' || p_label || '</a></p>';
$$;

insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html) values

('external_profile_published', 'fr', 'prospecting',
 'Une fiche professionnelle vous concernant est publiée sur FadeUp',
 E'Bonjour,\n\nUne fiche professionnelle concernant {{display_name}} vient d''être publiée sur FadeUp, un annuaire qui met en relation des professionnels de la coiffure et leurs clients.\n\nPourquoi ce message : cette fiche a été créée à partir d''informations publiquement accessibles (site, annuaires professionnels, profils publics). Vous ne nous avez pas transmis ces informations vous-même — l''article 14 du RGPD nous impose donc de vous en informer et de vous rappeler vos droits.\n\nCe que la fiche contient : nom professionnel, catégorie d''activité, secteur géographique et liens publics. Elle est clairement marquée comme non gérée par vous, et rien n''y est inventé : aucune disponibilité, aucun avis, aucun chiffre.\n\nVoir la fiche : {{profile_url}}\n\nVos droits (accès, rectification, effacement, opposition), la source exacte de vos données et l''identité du responsable de traitement : {{info_url}}\n\nRetirer la fiche : si vous ne souhaitez pas y figurer, demandez son retrait — il est effectif au plus tard 72 heures après validation de la demande.\n{{withdrawal_url}}\n\nSi vous préférez gérer cette fiche vous-même, vous pouvez la revendiquer depuis la page de la fiche.\n\nNe plus recevoir d''e-mails de ce type : {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_x2_shell(
   'Une fiche vous concernant est publiée',
   '<p style="margin:0 0 16px 0;">Une fiche professionnelle concernant <strong>{{display_name}}</strong> vient d''être publiée sur FadeUp, un annuaire qui met en relation des professionnels de la coiffure et leurs clients.</p>'
   || '<p style="margin:0 0 16px 0;"><strong>Pourquoi ce message :</strong> cette fiche a été créée à partir d''informations publiquement accessibles (site, annuaires professionnels, profils publics). Vous ne nous avez pas transmis ces informations vous-même — l''article 14 du RGPD nous impose donc de vous en informer et de vous rappeler vos droits.</p>'
   || '<p style="margin:0 0 16px 0;"><strong>Ce que la fiche contient :</strong> nom professionnel, catégorie d''activité, secteur géographique et liens publics. Elle est clairement marquée comme non gérée par vous, et rien n''y est inventé : aucune disponibilité, aucun avis, aucun chiffre.</p>'
   || '<p style="margin:0 0 8px 0;"><a href="{{profile_url}}" style="color:#00875A;">Voir la fiche</a></p>'
   || pg_temp_x2_button('{{info_url}}', 'Vos données et vos droits')
   || '<p style="margin:0 0 8px 0;">Si vous ne souhaitez pas figurer sur FadeUp, <a href="{{withdrawal_url}}" style="color:#00875A;">demandez le retrait de la fiche</a> — effectif au plus tard 72 heures après validation de la demande.</p>'
   || '<p style="margin:0;">Si vous préférez gérer cette fiche vous-même, vous pouvez la revendiquer depuis la page de la fiche.</p>',
   'Vous recevez ce message parce qu''une fiche créée à partir de sources publiques et vous concernant est publiée sur FadeUp. <a href="{{unsubscribe_url}}" style="color:#6b736f;">Ne plus recevoir ces messages</a> · <a href="{{withdrawal_url}}" style="color:#6b736f;">Demander le retrait de la fiche</a>.')),

('external_profile_published', 'en', 'prospecting',
 'A professional listing about you was published on FadeUp',
 E'Hello,\n\nA professional listing about {{display_name}} was just published on FadeUp, a directory connecting hair professionals with their customers.\n\nWhy this message: this listing was created from publicly accessible information (website, professional directories, public profiles). You did not provide this information to us yourself — Article 14 of the GDPR therefore requires us to inform you and to remind you of your rights.\n\nWhat the listing contains: professional name, business category, area, and public links. It is clearly marked as not managed by you, and nothing on it is invented: no availability, no reviews, no numbers.\n\nSee the listing: {{profile_url}}\n\nYour rights (access, rectification, erasure, objection), the exact source of your data and the identity of the data controller: {{info_url}}\n\nRemove the listing: if you do not wish to appear, request its removal — effective no later than 72 hours after the request is validated.\n{{withdrawal_url}}\n\nIf you would rather manage this listing yourself, you can claim it from the listing page.\n\nStop receiving emails like this one: {{unsubscribe_url}}\n\nFadeUp',
 pg_temp_x2_shell(
   'A listing about you was published',
   '<p style="margin:0 0 16px 0;">A professional listing about <strong>{{display_name}}</strong> was just published on FadeUp, a directory connecting hair professionals with their customers.</p>'
   || '<p style="margin:0 0 16px 0;"><strong>Why this message:</strong> this listing was created from publicly accessible information (website, professional directories, public profiles). You did not provide this information to us yourself — Article 14 of the GDPR therefore requires us to inform you and to remind you of your rights.</p>'
   || '<p style="margin:0 0 16px 0;"><strong>What the listing contains:</strong> professional name, business category, area, and public links. It is clearly marked as not managed by you, and nothing on it is invented: no availability, no reviews, no numbers.</p>'
   || '<p style="margin:0 0 8px 0;"><a href="{{profile_url}}" style="color:#00875A;">See the listing</a></p>'
   || pg_temp_x2_button('{{info_url}}', 'Your data and your rights')
   || '<p style="margin:0 0 8px 0;">If you do not wish to appear on FadeUp, <a href="{{withdrawal_url}}" style="color:#00875A;">request the removal of the listing</a> — effective no later than 72 hours after the request is validated.</p>'
   || '<p style="margin:0;">If you would rather manage this listing yourself, you can claim it from the listing page.</p>',
   'You are receiving this because a listing about you, created from public sources, is published on FadeUp. <a href="{{unsubscribe_url}}" style="color:#6b736f;">Stop receiving these messages</a> · <a href="{{withdrawal_url}}" style="color:#6b736f;">Request the removal of the listing</a>.'))

on conflict (template_key, locale) do update
set stream = excluded.stream,
    subject = excluded.subject,
    body_text = excluded.body_text,
    body_html = excluded.body_html,
    updated_at = now();

drop function pg_temp_x2_shell(text, text, text);
drop function pg_temp_x2_button(text, text);

commit;
