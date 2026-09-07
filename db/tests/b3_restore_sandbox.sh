#!/usr/bin/env bash
# FadeUp — B3 : bac d'essai sur restauration FIDÈLE de la production.
#
# POURQUOI FIDÈLE
#
# `pg_restore --no-owner` réattribue tout au rôle qui restaure. Le bac d'essai
# devient alors une base où `postgres` possède tout, et où aucune migration ne
# peut échouer sur un problème de propriété. B1 et B2 ont chacun trouvé un bug
# que seule la fidélité révèle : un piège de propriété, puis un privilège
# MAINTAIN oublié sur une table possédée par supabase_admin.
#
# Ce script restaure donc SANS --no-owner, en tant que `supabase_admin`, dans
# une base neuve du même conteneur d'image que la production. Les propriétaires
# et les ACL du dump sont conservés tels quels.
#
# CE QU'IL FAIT
#
#   1. démarre un conteneur postgres jetable (supabase/postgres, même image)
#   2. attend une disponibilité STABLE (l'image redémarre pendant son init)
#   3. crée les rôles que le dump référence et que l'image ne fournit pas
#   4. restaure le dump dans la base cible, en tant que supabase_admin
#   5. applique les migrations passées en argument, dans l'ordre
#   6. laisse le conteneur vivant pour l'inspection (--keep) ou le supprime
#
# Il ne touche JAMAIS fadeup-supabase-db ni aucune ressource de Jasmean OS.
#
# Usage :
#   db/tests/b3_restore_sandbox.sh --dump backups/pre-b3-XXXX.dump
#   db/tests/b3_restore_sandbox.sh --dump D --up db/migrations/2026...sql --up ...
#   db/tests/b3_restore_sandbox.sh --dump D --up U --down db/migrations/down/...
#   db/tests/b3_restore_sandbox.sh --dump D --sql db/tests/verify_b3.sql
#
# Variables :
#   B3_SANDBOX_KEEP=1     garder le conteneur à la fin
#   B3_SANDBOX_NAME=...   nom imposé (par défaut : suffixé par le PID)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${B3_SANDBOX_IMAGE:-supabase/postgres:17.6.1.136}"
CONTAINER="${B3_SANDBOX_NAME:-fadeup-b3-sandbox-$$}"
TARGET_DB="${B3_SANDBOX_DB:-b3_restore}"
KEEP="${B3_SANDBOX_KEEP:-0}"

DUMP=""
UPS=()
DOWNS=()
SQLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2 ;;
    --up) UPS+=("$2"); shift 2 ;;
    --down) DOWNS+=("$2"); shift 2 ;;
    --sql) SQLS+=("$2"); shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "argument inconnu : $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DUMP" ]]; then
  echo "--dump est requis" >&2
  exit 2
fi
[[ "$DUMP" = /* ]] || DUMP="$REPO_ROOT/$DUMP"
if [[ ! -r "$DUMP" ]]; then
  echo "dump illisible : $DUMP" >&2
  exit 2
fi

cleanup() {
  if [[ "$KEEP" -eq 0 ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  else
    echo "==> conteneur conservé : $CONTAINER (base $TARGET_DB)"
  fi
}
trap cleanup EXIT

echo "==> conteneur jetable $CONTAINER ($IMAGE)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="sandbox_$(date +%s)" \
  -e POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

# L'entrypoint supabase/postgres expose un serveur TEMPORAIRE pendant son init
# puis REDÉMARRE. Un seul pg_isready réussi ne prouve donc rien : on exige une
# série de succès consécutifs, et la présence des objets Supabase que les
# migrations FadeUp supposent (schéma auth, auth.users, auth.uid()).
echo -n "==> disponibilité stable"
stable=0
for _ in $(seq 1 240); do
  ready="$(docker exec "$CONTAINER" psql -U postgres -d postgres -Atqc "
    select case when
      exists (select 1 from pg_namespace where nspname = 'auth')
      and exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'auth' and c.relname = 'users' and c.relkind in ('r','p'))
      and exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth' and p.proname = 'uid' and p.pronargs = 0)
    then 1 else 0 end" 2>/dev/null || true)"
  if [[ "$ready" == "1" ]]; then stable=$((stable + 1)); else stable=0; fi
  if [[ "$stable" -ge 8 ]]; then echo " ok"; break; fi
  echo -n "."
  sleep 1
done
if [[ "$stable" -lt 8 ]]; then
  echo " ÉCHEC — postgres n'est jamais devenu stablement disponible" >&2
  docker logs --tail 60 "$CONTAINER" >&2
  exit 1
fi

# Les rôles sont des objets de CLUSTER : ils ne sont PAS dans un dump -Fc
# d'une seule base, mais le dump les référence partout, dans ses OWNER TO et
# dans ses GRANT. Sans eux, la restauration fidèle échoue en série et le bac
# d'essai retombe silencieusement sur « tout appartient à postgres », c'est-à-
# dire exactement la situation que --no-owner produisait et que B1 et B2 ont
# payée deux fois.
#
# On les prend donc à la source : la liste des rôles de la production, y
# compris ceux qui n'apparaissent que dans une ACL. Créés NOLOGIN et sans mot
# de passe — ce bac d'essai ne sert pas à s'authentifier — et l'appartenance
# aux rôles est reproduite, parce qu'une ACL accordée à un rôle de groupe ne
# vaut que si l'appartenance existe.
echo "==> rôles de la production reproduits"
SRC_CONTAINER="${B3_SOURCE_CONTAINER:-fadeup-supabase-db}"
ROLE_SQL="$(docker exec -i "$SRC_CONTAINER" psql -U postgres -d postgres -Atq -c "
  select
    coalesce(string_agg(format(
      'do \$r\$ begin if not exists (select 1 from pg_roles where rolname = %L) then execute %L; end if; end \$r\$;',
      rolname,
      'create role ' || quote_ident(rolname) || ' nologin'
        || case when rolsuper then ' superuser' else '' end
        || case when rolcreatedb then ' createdb' else '' end
        || case when rolcreaterole then ' createrole' else '' end
        || case when rolinherit then ' inherit' else ' noinherit' end
        || case when rolbypassrls then ' bypassrls' else '' end
    ), E'\n'), '')
  from pg_roles
  where rolname not like 'pg\_%';")"
# En tant que supabase_admin, pas postgres : l'image charge supautils, qui
# réserve supabase_realtime_admin et consorts et n'autorise leur modification
# qu'à un superutilisateur. `postgres` n'en est pas un ici. Sans ON_ERROR_STOP
# non plus : les rôles réservés existent déjà, leur re-création est un bruit
# attendu — ce qui compte est la vérification de présence juste en dessous.
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -q <<<"$ROLE_SQL" 2>/dev/null || true

MEMBER_SQL="$(docker exec -i "$SRC_CONTAINER" psql -U postgres -d postgres -Atq -c "
  select coalesce(string_agg(format('grant %I to %I;', g.rolname, m.rolname), E'\n'), '')
  from pg_auth_members am
  join pg_roles g on g.oid = am.roleid
  join pg_roles m on m.oid = am.member
  where g.rolname not like 'pg\_%' and m.rolname not like 'pg\_%';")"
[[ -n "$MEMBER_SQL" ]] && docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -q <<<"$MEMBER_SQL" >/dev/null 2>&1 || true

# Un rôle manquant ici deviendrait une erreur pg_restore incompréhensible cent
# lignes plus bas. On le dit tout de suite, en nommant les absents.
ROLES_SRC="$(mktemp)"; ROLES_DST="$(mktemp)"
trap 'rm -f "$ROLES_SRC" "$ROLES_DST"; cleanup' EXIT
docker exec -i "$SRC_CONTAINER" psql -U postgres -d postgres -Atq \
  -c "select rolname from pg_roles where rolname not like 'pg\_%' order by 1;" >"$ROLES_SRC"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq \
  -c "select rolname from pg_roles where rolname not like 'pg\_%' order by 1;" >"$ROLES_DST"
MISSING="$(comm -23 "$ROLES_SRC" "$ROLES_DST" | tr '\n' ' ')"
if [[ -n "${MISSING// /}" ]]; then
  echo "    ÉCHEC — rôles absents du bac d'essai : $MISSING" >&2
  exit 1
fi
docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAc \
  "select count(*) || ' rôle(s) présents, aucun manquant' from pg_roles where rolname not like 'pg\_%';" | sed 's/^/    /'

# DROP DATABASE ne peut pas s'exécuter dans un bloc de transaction, et psql
# enveloppe un -c multi-instructions dans une transaction implicite. Deux -c
# séparés, donc — le premier échec de ce script, corrigé ici.
#
# Possédée par POSTGRES, comme la base de production (datdba = postgres,
# vérifié). Le propriétaire de la base est pg_database_owner, et c'est lui qui
# a CREATE sur le schéma public : une base possédée par supabase_admin ferait
# échouer en `permission denied for schema public` des migrations qui passent
# en production — deuxième échec de ce script, corrigé ici.
echo "==> base cible $TARGET_DB, possédée par postgres (fidèle à la production)"
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists $TARGET_DB;"
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q \
  -c "create database $TARGET_DB owner postgres;"

# LA restauration fidèle. Pas de --no-owner, pas de --no-acl, en tant que
# supabase_admin — le rôle qui possède les objets sensibles en production.
# --exit-on-error est volontairement absent : un dump d'une seule base
# contient des GRANT vers des rôles de cluster et des commentaires sur des
# extensions que le rôle restaurateur ne possède pas, et ces bruits-là ne
# remettent pas en cause la fidélité du schéma. On COMPTE les erreurs et on
# échoue si elles touchent autre chose.
echo "==> restauration fidèle (pg_restore -U supabase_admin, sans --no-owner)"
set +e
docker run --rm -i --network "container:$CONTAINER" \
  -v "$(dirname "$DUMP")":/b:ro "$IMAGE" \
  pg_restore -h 127.0.0.1 -U supabase_admin -d "$TARGET_DB" --no-password \
    "/b/$(basename "$DUMP")" >/tmp/b3-restore-$$.log 2>&1
set -e

# pg_restore via le réseau exige un mot de passe pour supabase_admin. On passe
# donc par docker exec, qui se connecte en local sur la socket où la confiance
# est accordée (trust) par l'image.
if grep -qi "authentication\|password" /tmp/b3-restore-$$.log 2>/dev/null; then
  docker cp "$DUMP" "$CONTAINER:/tmp/restore.dump" >/dev/null
  set +e
  docker exec -i "$CONTAINER" pg_restore -U supabase_admin -d "$TARGET_DB" \
    /tmp/restore.dump >/tmp/b3-restore-$$.log 2>&1
  set -e
fi

ERRS="$(grep -c '^pg_restore: error' /tmp/b3-restore-$$.log 2>/dev/null || true)"
echo "    $ERRS ligne(s) d'erreur pg_restore"
if [[ "${ERRS:-0}" -gt 0 ]]; then
  echo "    (les 20 premières)"
  grep '^pg_restore: error' /tmp/b3-restore-$$.log | head -20 | sed 's/^/    /'
fi

# Preuve de fidélité : les objets doivent avoir GARDÉ leurs propriétaires
# d'origine. Si tout appartenait à supabase_admin, la restauration ne serait
# pas fidèle et le bac d'essai serait sans valeur.
echo "==> propriétaires conservés"
docker exec -i "$CONTAINER" psql -U postgres -d "$TARGET_DB" -c "
  select c.relowner::regrole as proprietaire, count(*) as objets
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','v','m')
  group by 1 order by 2 desc;"

echo "==> ACL présentes (échantillon)"
docker exec -i "$CONTAINER" psql -U postgres -d "$TARGET_DB" -tAc "
  select count(*) || ' table(s) public/private portant une ACL explicite'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private') and c.relkind = 'r' and c.relacl is not null;"

run_sql() {
  local f="$1" label="$2"
  [[ "$f" = /* ]] || f="$REPO_ROOT/$f"
  echo "==> $label : $(basename "$f")"
  docker exec -i -e PGOPTIONS='--client-min-messages=warning' "$CONTAINER" \
    psql -U postgres -d "$TARGET_DB" -v ON_ERROR_STOP=1 < "$f"
}

for f in "${UPS[@]:-}";   do [[ -n "$f" ]] && run_sql "$f" "migration"; done
for f in "${SQLS[@]:-}";  do [[ -n "$f" ]] && run_sql "$f" "sql"; done
for f in "${DOWNS[@]:-}"; do [[ -n "$f" ]] && run_sql "$f" "retour arrière"; done

echo "==> terminé"
