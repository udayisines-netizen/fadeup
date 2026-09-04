-- FadeUp — B2, chantier 3: les trois relances au professionnel.
--
-- MASTER_SPEC §5 : « Trois touches : immédiate, +8 h, dernier rappel avant
-- expiration. E-mail uniquement. » §13 : heures calmes respectées pour le non
-- urgent.
--
-- LA GARDE CONTRE LA FUITE DE DONNÉES PERSONNELLES
--
-- MASTER_SPEC §5 est une règle produit, pas une préférence : avant
-- vérification du professionnel, il voit un prénom ou une initiale, le service
-- et l'horaire. **Jamais le téléphone ni l'e-mail complet du client.**
--
-- B2 exige que ce soit techniquement impossible. La garde a trois étages, et
-- c'est le premier qui compte :
--
--   1. STRUCTUREL. Les coordonnées vivent dans
--      professional_interest_request_contacts, une table distincte.
--      private.prospect_outreach_payload lit
--      professional_interest_requests — où ces colonnes N'EXISTENT PAS.
--      La fonction ne s'abstient pas de les lire, elle n'a rien à lire.
--
--   2. À L'ÉCRITURE. Le nom est déjà réduit à « Prénom I. » au moment de
--      l'insertion, par private.reduce_customer_display_name. Aucun gabarit
--      ne peut « dé-réduire » ce qui n'a jamais été stocké entier.
--
--   3. TESTÉ. verify_b2.sql assert que la définition de
--      prospect_outreach_payload ne mentionne jamais la table de contacts, et
--      que le payload produit ne contient ni « @ » ni « + » suivi de
--      chiffres. Le test échoue si quelqu'un ajoute un jour la jointure.
--
-- L'IDEMPOTENCE
--
-- Elle ne vient pas d'une table de suivi supplémentaire mais de
-- email_outbox.dedupe_key, sur lequel B2 a posé un index unique partiel. La
-- clé est `interest:<request_id>:<touche>` : réémettre la même touche est un
-- ON CONFLICT DO NOTHING, quel que soit le moment où le conteneur redémarre.
-- Une seule ligne, une seule vérité, pas de second registre à garder cohérent.
--
-- LES HEURES CALMES
--
-- 08:00–21:00 dans le fuseau du PROSPECT, dérivé de son pays via
-- suggested_timezone_for_country. Hors de cette fenêtre, la touche n'est pas
-- annulée : elle n'est pas encore due, et le tick suivant la reprendra. Une
-- relance de prospection à 3 h du matin est un motif de plainte, et une
-- plainte coûte la délivrabilité des e-mails d'authentification — qui partent
-- aujourd'hui du même domaine, faute d'un second domaine vérifié.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Le jeton de désabonnement
--
-- Sur le prospect, pas sur la demande : on se désabonne d'un émetteur, pas
-- d'un message. Un lien reçu il y a trois mois doit encore fonctionner.
-- ---------------------------------------------------------------------------

alter table public.prospects
  add column if not exists outreach_unsubscribe_token text;

update public.prospects
set outreach_unsubscribe_token = encode(extensions.gen_random_bytes(16), 'hex')
where outreach_unsubscribe_token is null;

alter table public.prospects
  alter column outreach_unsubscribe_token set not null,
  alter column outreach_unsubscribe_token set default encode(extensions.gen_random_bytes(16), 'hex');

create unique index if not exists prospects_outreach_unsubscribe_token_unique
  on public.prospects (outreach_unsubscribe_token);

comment on column public.prospects.outreach_unsubscribe_token is
  'Le jeton du lien « ne plus recevoir ces messages ». Porté par le PROSPECT et non par la demande : on se désabonne d''un émetteur, et un lien reçu il y a trois mois doit encore fonctionner. Jamais retourné par une RPC de lecture — il ne circule que dans le corps des e-mails de prospection.';

-- ---------------------------------------------------------------------------
-- 2. Se désabonner — anon, en un clic, définitif
-- ---------------------------------------------------------------------------

create or replace function public.unsubscribe_prospect_outreach(p_token text)
returns table (unsubscribed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id uuid;
begin
  select id into v_prospect_id
  from public.prospects
  where outreach_unsubscribe_token = lower(btrim(coalesce(p_token, '')))
  for update;

  if not found then
    -- Jeton inconnu, jeton déjà utilisé, jeton inventé : même réponse. Un
    -- refus distinct laisserait énumérer les prospects.
    return query select true;
    return;
  end if;

  update public.prospects
  set do_not_contact = true
  where id = v_prospect_id and not do_not_contact;

  -- La suppression durable, pour que la déduplication du Worker la voie aussi :
  -- do_not_contact protège CE prospect, une suppression protège aussi ses
  -- futurs doublons découverts sous un autre nom.
  insert into public.prospect_suppressions (scope, prospect_id, reason)
  values ('prospect', v_prospect_id, 'unsubscribed_from_outreach')
  on conflict do nothing;

  return query select true;
end;
$$;

comment on function public.unsubscribe_prospect_outreach(text) is
'Anon-callable, appelée par le lien de désabonnement des e-mails de prospection. Pose do_not_contact ET une suppression durable : le premier arrête les relances vers ce prospect, la seconde protège aussi les doublons que le Worker découvrirait plus tard sous un autre nom.

Répond toujours true, y compris sur un jeton inconnu : une réponse distincte permettrait d''énumérer les prospects. Le désabonnement est DÉFINITIF — aucune nouvelle demande client ne le contourne, create_professional_interest_request refuse un profil dont le prospect est do_not_contact.';

revoke all on function public.unsubscribe_prospect_outreach(text) from public;
grant execute on function public.unsubscribe_prospect_outreach(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Le payload — la fonction qui NE PEUT PAS voir les coordonnées
--
-- Lisez ses FROM. professional_interest_requests, professionals, prospects,
-- prospect_locations. La table de contacts n'y est pas, et il n'existe aucun
-- chemin depuis ces quatre-là vers un e-mail ou un téléphone de client.
-- ---------------------------------------------------------------------------

create or replace function private.prospect_timezone(p_prospect_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.suggested_timezone_for_country((select pr.country from public.prospects pr where pr.id = p_prospect_id)),
    'Europe/Paris'
  );
$$;

comment on function private.prospect_timezone(uuid) is
  'Le fuseau du destinataire, dérivé de son pays. Repli sur Europe/Paris, le marché de lancement — un repli sur UTC enverrait des relances à 2 h du matin en France l''été, ce qui est exactement le comportement que les heures calmes existent pour éviter.';

revoke all on function private.prospect_timezone(uuid) from public, anon, authenticated;

create or replace function private.prospect_outreach_payload(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Déjà réduit à l'écriture : « Karim B. ». C'est tout ce que cette table
    -- connaît du client.
    'customer_display_name', r.customer_display_name,
    'service_label', r.service_label,
    'preferred_starts_at_fr', to_char(r.preferred_starts_at at time zone private.prospect_timezone(pr.id), 'DD/MM/YYYY à HH24:MI'),
    'preferred_starts_at_en', to_char(r.preferred_starts_at at time zone private.prospect_timezone(pr.id), 'YYYY-MM-DD at HH24:MI'),
    'expires_at_fr', to_char(r.expires_at at time zone private.prospect_timezone(pr.id), 'DD/MM/YYYY à HH24:MI'),
    'expires_at_en', to_char(r.expires_at at time zone private.prospect_timezone(pr.id), 'YYYY-MM-DD at HH24:MI'),
    'city', coalesce((select pl.city from public.prospect_locations pl
                      where pl.prospect_id = pr.id order by pl.is_primary desc limit 1), ''),
    'profile_url', 'https://fade-up.com/p/' || coalesce(p.handle, p.id::text),
    'unsubscribe_url', 'https://fade-up.com/unsubscribe/' || pr.outreach_unsubscribe_token
  )
  from public.professional_interest_requests r
  join public.professionals p on p.id = r.professional_id
  join public.prospect_professionals pp on pp.professional_id = p.id
  join public.prospects pr on pr.id = pp.prospect_id
  where r.id = p_request_id;
$$;

comment on function private.prospect_outreach_payload(uuid) is
'Le SEUL payload autorisé pour un e-mail de prospection. MASTER_SPEC §5 : avant vérification, le professionnel voit un prénom ou une initiale, le service et l''horaire — jamais le téléphone ni l''e-mail complet du client.

La garde n''est pas une convention de rédaction : cette fonction lit professional_interest_requests, qui NE CONTIENT AUCUNE COLONNE DE CONTACT, et il n''existe aucun chemin de jointure d''ici vers professional_interest_request_contacts. La fuite n''est pas improbable, elle est irreprésentable. verify_b2.sql échoue si la table de contacts apparaît un jour dans cette définition.';

revoke all on function private.prospect_outreach_payload(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. La mise en file des relances
-- ---------------------------------------------------------------------------

create or replace function private.enqueue_prospect_outreach(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_touch text;
  v_template text;
  v_local_hour integer;
  v_count integer := 0;
begin
  for v_row in
    select
      r.id as request_id,
      r.locale,
      r.created_at,
      r.expires_at,
      pr.id as prospect_id,
      pr.email as prospect_email,
      private.prospect_timezone(pr.id) as tz,
      (select count(*) from public.email_outbox o
        where o.dedupe_key like 'interest:' || r.id::text || ':%') as touches_sent
    from public.professional_interest_requests r
    join public.professionals p on p.id = r.professional_id
    join public.prospect_professionals pp on pp.professional_id = p.id
    join public.prospects pr on pr.id = pp.prospect_id
    where r.status = 'pending'
      and r.expires_at > now()
      -- Le professionnel n'a pas encore revendiqué : c'est le seul cas où une
      -- relance de prospection a un sens.
      and p.claim_state = 'unclaimed'
      and p.is_public
      -- Joignable, et qui n'a pas dit non.
      and pr.email is not null
      and not pr.do_not_contact
      and not exists (
        select 1 from public.prospect_suppressions s
        where s.scope = 'prospect' and s.prospect_id = pr.id
      )
      and not private.is_prospect_value_suppressed('email', pr.email)
      -- MASTER_SPEC §5 : trois touches, jamais plus.
      and (select count(*) from public.email_outbox o
            where o.dedupe_key like 'interest:' || r.id::text || ':%') < 3
    order by r.created_at
    limit greatest(p_limit, 0)
  loop
    -- HEURES CALMES, dans le fuseau du destinataire. La touche n'est pas
    -- annulée : elle n'est pas encore due, et le tick suivant la reprendra.
    v_local_hour := extract(hour from (now() at time zone v_row.tz))::integer;
    if v_local_hour < 8 or v_local_hour >= 21 then
      continue;
    end if;

    -- Quelle touche est due.
    if v_row.touches_sent = 0 then
      v_touch := '1'; v_template := 'prospect_request_first';
    elsif v_row.touches_sent = 1 and now() >= v_row.created_at + interval '8 hours'
          -- Inutile de relancer une demande qui expire dans l'heure : la
          -- troisième touche, plus utile, arriverait juste après.
          and v_row.expires_at > now() + interval '1 hour' then
      v_touch := '2'; v_template := 'prospect_request_reminder';
    elsif v_row.touches_sent = 2 and now() >= v_row.expires_at - interval '2 hours' then
      v_touch := '3'; v_template := 'prospect_request_final';
    else
      continue;
    end if;

    insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
    values (
      v_row.prospect_email,
      v_template,
      v_row.locale,
      -- LE payload, et rien d'autre. Voir prospect_outreach_payload.
      private.prospect_outreach_payload(v_row.request_id),
      'prospecting',
      'interest:' || v_row.request_id::text || ':' || v_touch
    )
    -- Prédicat requis : l'index unique sur dedupe_key est PARTIEL.
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function private.enqueue_prospect_outreach(integer) is
'Met en file les relances dues, une seule par tick et par demande. Trois touches au maximum (MASTER_SPEC §5) : immédiate, +8 h, puis dernier rappel dans les deux heures précédant l''échéance.

Idempotente par email_outbox.dedupe_key = interest:<request_id>:<touche>, sur index unique partiel : un redémarrage du scheduler au milieu d''un lot ne peut pas produire de doublon, parce que la deuxième insertion de la même clé est un ON CONFLICT DO NOTHING.

N''envoie jamais : à un profil revendiqué, à un profil dépublié, à un prospect do_not_contact ou supprimé, à une adresse supprimée, ni en dehors de 08:00–21:00 heure locale du destinataire.';

revoke all on function private.enqueue_prospect_outreach(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Le tick d'acquisition
-- ---------------------------------------------------------------------------

create or replace function public.run_acquisition_maintenance()
returns table (expired_requests integer, outreach_queued integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Expirer d'abord : une demande échue ne doit pas recevoir sa troisième
  -- touche une seconde plus tard.
  return query select public.expire_interest_requests(500), private.enqueue_prospect_outreach(100);
end;
$$;

comment on function public.run_acquisition_maintenance() is
  'Le tick d''acquisition, appelé par le conteneur fadeup-scheduler : expire les demandes d''intérêt échues, puis met en file les relances dues. Ne fait rien d''autre, et surtout n''envoie rien lui-même — l''envoi est run_email_delivery, séparé pour qu''une panne de Resend n''empêche pas les expirations.';

revoke all on function public.run_acquisition_maintenance() from public, anon, authenticated;
grant execute on function public.run_acquisition_maintenance() to fadeup_scheduler;

commit;
