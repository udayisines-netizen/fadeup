-- Retour arrière — correctif B5 (grants private).
-- Rôle : postgres. Rétablit l'état cassé : après ce retour, « Appeler le
-- suivant », la mise à jour d'un rendez-vous par un barber et l'écriture
-- d'un avis répondent de nouveau 403. À ne jouer que si le lot B5 est lui
-- aussi retiré.
begin;

do $rollback$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.erasure_display_sentinel()',
    'private.account_erasure_active()',
    'private.erasure_update_allowed(jsonb, jsonb, jsonb)'
  ] loop
    if to_regprocedure(v_signature) is not null then
      execute format('revoke execute on function %s from authenticated', v_signature);
    end if;
  end loop;
end;
$rollback$;

commit;
