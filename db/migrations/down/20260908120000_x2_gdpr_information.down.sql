-- X2 — retour arrière de 20260908120000_x2_gdpr_information.sql.
-- À APPLIQUER EN postgres.
--
-- Restaure publish_external_professional (version B1, 20260904160000) et
-- private.prospect_outreach_payload (version B2, 20260904180500) à
-- l'identique ; supprime tout objet X2. Les demandes de retrait entrées par
-- les canaux publics X2 sont SUPPRIMÉES par ce down (elles n'existent que si
-- X2 a tourné) — un down qui les garderait violerait la contrainte de canal
-- restaurée.

set lock_timeout = '5s';

begin;

-- GARDE (revue X2) : les traces d'information article 14 et les demandes de
-- retrait publiques sont LA PREUVE de conformité — exactement ce qu'on
-- produit si un professionnel conteste. Ce down les détruirait ; il refuse
-- donc de s'exécuter si elles existent. Sur un bac d'essai (ou en pleine
-- connaissance de cause) : set fadeup.x2_force_down = 'on';
do $$
begin
  if coalesce(current_setting('fadeup.x2_force_down', true), '') <> 'on'
     and (exists (select 1 from public.professional_information_notices)
          or exists (select 1 from public.marketplace_withdrawal_requests
                     where requested_via in ('public_form', 'email_link'))) then
    raise exception 'X2 down refuse: information notices or public withdrawal requests exist — dropping them would destroy compliance evidence. To force: set fadeup.x2_force_down = ''on'';';
  end if;
end $$;

-- 1. Fonctions X2.
drop function if exists public.submit_marketplace_withdrawal_request(uuid, text, text, text);
drop function if exists public.run_email_feedback_maintenance();
drop function if exists private.apply_resend_webhook_feedback(integer);
drop function if exists private.enqueue_publication_information(uuid);

-- 2. publish_external_professional — version B1 restaurée verbatim.
create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  -- Lock the PROSPECT, not the linkage row, because the linkage row is what we
  -- are about to create and therefore cannot be locked. Two administrators
  -- double-clicking Publish on the same candidate serialise here; the loser
  -- re-reads a gate that now says already_published and returns the winner's
  -- identity instead of a 23505 they would have to interpret.
  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    -- Idempotent, and self-healing for identities minted while the R1B CHECK
    -- still forbade publication: those rows exist, are linked, and are
    -- invisible. Pressing Publish again finishes the job.
    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    return v_existing;
  end if;

  -- Checked here so the operator gets the reason by name. The trigger would
  -- refuse the insert regardless; this is ergonomics on top of the guarantee,
  -- never in place of it.
  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  -- Publication is the point of this function. It happens AFTER the linkage
  -- row exists, because professionals_guard_publication reads the linkage to
  -- find the anchor — the same ordering the guard's INSERT branch describes.
  update public.professionals
  set is_public = true
  where id = v_professional_id;

  -- Constitution §4.4's discipline, applied to acquisition: a decision that
  -- creates a durable public-facing identity records who took it and when.
  -- The prospect's name is captured AS PUBLISHED, so a later rename of the
  -- prospect does not rewrite the history of what was approved.
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  -- Fold the verdict forward immediately so the review queue stops offering a
  -- candidate that has just been published, without waiting for the next
  -- Worker sweep.
  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  return v_professional_id;
end;
$$;

-- 3. prospect_outreach_payload — version B2 restaurée verbatim.
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

-- 4. Demande de retrait : colonne et contrainte d'origine.
delete from public.marketplace_withdrawal_requests
where requested_via in ('public_form', 'email_link');

alter table public.marketplace_withdrawal_requests
  drop constraint if exists marketplace_withdrawal_requests_requester_email_shape;
alter table public.marketplace_withdrawal_requests
  drop column if exists requester_email;

alter table public.marketplace_withdrawal_requests
  drop constraint if exists marketplace_withdrawal_requests_via_valid;
alter table public.marketplace_withdrawal_requests
  add constraint marketplace_withdrawal_requests_via_valid
    check (requested_via in ('email', 'phone', 'platform_operator', 'legal', 'other'));

-- 5. Tables X2.
drop table if exists public.professional_information_notices;
drop table if exists public.resend_webhook_events;

-- 6. email_outbox : colonnes et index X2. Les messages d'information déjà en
-- file référencent un gabarit que le down du fichier 120100 supprime — on les
-- retire pour ne pas laisser des lignes qui échoueraient au rendu.
delete from public.email_outbox
where template = 'external_profile_published' and status = 'queued';

drop index if exists public.email_outbox_provider_message_id_idx;

alter table public.email_outbox
  drop column if exists delivered_at,
  drop column if exists opened_at,
  drop column if exists bounced_at,
  drop column if exists complained_at,
  drop column if exists bounce_classification;

commit;
