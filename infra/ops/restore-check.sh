#!/bin/bash
# FadeUp ops — test de restauration du dernier dump quotidien.
#
# Une sauvegarde jamais restaurée n'est pas une sauvegarde. Ce script prend le
# dernier dump chiffré, le déchiffre, le restaure dans une base JETABLE du
# conteneur de production, compte tables / fonctions / policies RLS, compare
# aux comptes de la base vivante, puis supprime la base jetable.
#
# POURQUOI DANS LE CONTENEUR DE PRODUCTION ET PAS UN BAC JETABLE À LA B3 :
# le bac fidèle de B3 démarre un second serveur postgres complet — le bon
# outil pour éprouver une migration, mais trop lourd pour une vérification
# hebdomadaire automatique sur une machine à 3,7 Go de RAM dont 130 Mo libres.
# Ici on ne teste pas une migration : on prouve que le dump se restaure. Une
# base supplémentaire dans le cluster existant coûte ~10 Mo et vit ~30 s.
# Le cluster contient déjà tous les rôles que le dump référence, donc la
# restauration conserve propriétaires et ACL sans préparation.
#
# SEUILS. La base vivante peut avoir dérivé depuis le dump du matin (une
# migration appliquée dans la journée) : une différence de comptes n'est donc
# une alerte que si le restauré est INFÉRIEUR au vivant — un dump qui contient
# moins que la production est suspect ; l'inverse signifie qu'on a supprimé
# quelque chose en production après le dump, ce qui se voit ailleurs.
#
# Usage : restore-check.sh [chemin/dump.gpg]  (défaut : dernier daily)

set -euo pipefail

OPS_DIR="${OPS_DIR:-$HOME/ops}"
OPS_ENV="${OPS_ENV:-$OPS_DIR/.env}"
# shellcheck disable=SC1090
. "$OPS_ENV"

ALERT="$OPS_DIR/alert.sh"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/fadeup/backups/auto}"
DB_CONTAINER="${DB_CONTAINER:-fadeup-supabase-db}"
PASSFILE="${BACKUP_PASSPHRASE_FILE:-$OPS_DIR/backup.passphrase}"
CHECK_DB="x1_restore_check"

fail() {
  echo "restore-check.sh: ÉCHEC: $1" >&2
  "$ALERT" raise restore-check "Test de restauration en échec" \
    "Le test de restauration du $(date -u +%F) a échoué : $1

Le dernier dump n'est PAS prouvé restaurable. À traiter comme si la
sauvegarde n'existait pas." || true
  exit 1
}

DUMP_GPG="${1:-$(ls -1t "$BACKUP_ROOT"/daily/db-*.dump.gpg 2>/dev/null | head -1 || true)}"
[ -n "$DUMP_GPG" ] && [ -r "$DUMP_GPG" ] || fail "aucun dump quotidien chiffré trouvé dans $BACKUP_ROOT/daily"

workdir="$(mktemp -d "${TMPDIR:-/tmp}/fadeup-restore.XXXXXX")"
cleanup() {
  rm -rf "$workdir"
  docker exec "$DB_CONTAINER" rm -f /tmp/x1-restore-check.dump 2>/dev/null || true
  docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -qAtc \
    "drop database if exists $CHECK_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- déchiffrement (prouve aussi que la passphrase ouvre bien les archives) --
gpg --batch --quiet --decrypt --passphrase-file "$PASSFILE" \
    -o "$workdir/check.dump" "$DUMP_GPG" \
  || fail "déchiffrement GPG impossible ($DUMP_GPG)"

docker cp "$workdir/check.dump" "$DB_CONTAINER:/tmp/x1-restore-check.dump" \
  || fail "docker cp vers le conteneur"

# --- restauration ------------------------------------------------------------
# Deux appels séparés : psql -c enveloppe ses instructions dans UNE
# transaction, et DROP/CREATE DATABASE refusent d'y vivre.
docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -qc \
  "drop database if exists $CHECK_DB;" \
  || fail "suppression préalable de la base jetable"
docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -qc \
  "create database $CHECK_DB;" \
  || fail "création de la base jetable"

# pg_restore d'un dump Supabase émet des erreurs bénignes attendues (objets
# appartenant à des extensions déjà en place, event triggers). On restaure
# sans --exit-on-error et on juge sur les COMPTES, qui ne mentent pas.
restore_log=$(docker exec "$DB_CONTAINER" pg_restore -U supabase_admin \
  -d "$CHECK_DB" /tmp/x1-restore-check.dump 2>&1 || true)
err_count=$(printf '%s' "$restore_log" | grep -c '^pg_restore: error:' || true)

counts_sql="select
  (select count(*) from pg_tables where schemaname in ('public','private')),
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private')),
  (select count(*) from pg_policies where schemaname in ('public','private'))"

restored=$(docker exec "$DB_CONTAINER" psql -U supabase_admin -d "$CHECK_DB" -qAtc "$counts_sql") \
  || fail "lecture des comptes restaurés"
live=$(docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -qAtc "$counts_sql") \
  || fail "lecture des comptes vivants"

r_tables=${restored%%|*}; rest=${restored#*|}; r_funcs=${rest%%|*}; r_pol=${rest#*|}
l_tables=${live%%|*};     rest=${live#*|};     l_funcs=${rest%%|*}; l_pol=${rest#*|}

echo "restore-check: restauré  tables=$r_tables fonctions=$r_funcs policies=$r_pol (erreurs pg_restore: $err_count)"
echo "restore-check: vivant    tables=$l_tables fonctions=$l_funcs policies=$l_pol"

[ "$r_tables" -ge "$l_tables" ] || fail "tables restaurées ($r_tables) < vivantes ($l_tables)"
[ "$r_funcs"  -ge "$l_funcs"  ] || fail "fonctions restaurées ($r_funcs) < vivantes ($l_funcs)"
[ "$r_pol"    -ge "$l_pol"    ] || fail "policies restaurées ($r_pol) < vivantes ($l_pol)"

"$ALERT" clear restore-check "Test de restauration en échec" || true
echo "restore-check: OK — le dump $(basename "$DUMP_GPG") se restaure."
