-- X3 — instantané ACL normalisé, pour comparaison privilège par privilège
-- avant/après migration et après retour arrière. Sortie stable et triée :
-- à lancer avec psql -X -A -t -q, puis diff.
--
-- Trois familles : relations (tables/vues/séquences), fonctions, privilèges
-- par défaut. Chaque ligne porte l'objet, le bénéficiaire, le privilège et le
-- CONCÉDANT — c'est lui qui rend les no-op silencieux visibles.
--
-- Les fonctions à ACL NULL sont normalisées via acldefault(propriétaire) et
-- marquées « (implicite) » : un down qui re-matérialise l'équivalent exact du
-- défaut est accepté comme fidèle (privilèges effectifs identiques).

select 'REL|' || n.nspname || '.' || c.relname || '|' ||
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '|' ||
       a.privilege_type || '|grantor=' || pg_get_userbyid(a.grantor)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
where n.nspname in ('public', 'private', 'storage')
  and c.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
union all
select 'FN|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
       case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '|' ||
       a.privilege_type || '|grantor=' || pg_get_userbyid(a.grantor) ||
       case when p.proacl is null then '|(implicite)' else '' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
where n.nspname in ('public', 'private', 'storage')
union all
select 'DEFACL|' || r.rolname || '|' || coalesce(n.nspname, '(global)') || '|' ||
       d.defaclobjtype::text || '|' || array_to_string(d.defaclacl, ',')
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
join pg_roles r on r.oid = d.defaclrole
order by 1;
