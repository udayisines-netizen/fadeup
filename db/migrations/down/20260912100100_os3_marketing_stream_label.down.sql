-- FadeUp — OS-3 : retour arrière de l'étiquette `marketing`.
--
-- IL N'Y EN A PAS, ET C'EST DÉCLARÉ. Postgres ne sait pas retirer une
-- étiquette d'un type énuméré. La retirer exigerait de recréer
-- `public.email_stream` et de réécrire les trois colonnes qui en dépendent
-- (`email_outbox.stream`, `email_templates.stream`, `email_streams.stream`)
-- plus le type de retour de `private.render_email_template` — une opération
-- bien plus dangereuse que l'étiquette inutilisée qu'elle supprimerait.
--
-- Ce que le retour arrière de 20260912100300 fait, en revanche : il retire la
-- LIGNE `email_streams` du flux marketing et ses huit gabarits. Après quoi
-- l'étiquette existe et ne désigne rien — état inoffensif : une ligne
-- d'outbox portant un flux inconnu est marquée `failed` par
-- `email_dispatch_batch` avec le motif « stream disabled or unknown », et il
-- n'en reste aucune (le retour les supprime).
--
-- Vérification que rien ne l'utilise plus, pour que ce fichier ne soit pas
-- qu'un commentaire :
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.email_outbox where stream = 'marketing';
  if v_rows > 0 then
    raise exception 'retour arrière refusé : % ligne(s) email_outbox portent encore le flux marketing', v_rows;
  end if;
  if exists (select 1 from public.email_streams where stream = 'marketing') then
    raise exception 'retour arrière refusé : la ligne email_streams du flux marketing existe encore — appliquer d''abord le retour de 20260912100300';
  end if;
  raise notice 'étiquette marketing conservée (Postgres ne retire pas une étiquette d''enum) ; plus rien ne l''utilise';
end;
$$;
