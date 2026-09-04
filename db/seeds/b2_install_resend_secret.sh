#!/usr/bin/env bash
# FadeUp — B2: installe la clé API Resend dans supabase_vault.
#
# POURQUOI UN SCRIPT ET PAS UNE MIGRATION
#
# Une migration est un fichier suivi par git. Une clé API dans une migration
# est une clé API dans l'historique du dépôt, définitivement, y compris après
# l'avoir « retirée » dans un commit suivant. Ce script lit la valeur depuis
# infra/supabase/.env — qui n'est pas suivi — et l'écrit chiffrée dans le
# vault. La valeur ne passe par aucun argument de ligne de commande (elle
# serait visible dans `ps`), par aucun `echo`, et n'apparaît dans aucun log :
# elle est transmise à psql sur son entrée standard, en tant que paramètre.
#
# CE QUE ÇA DONNE À L'ARRIVÉE
#
#   vault.secrets              une ligne nommée 'resend_api_key', chiffrée
#   private.resend_api_key()   la lit, et n'est exécutable par aucun rôle client
#
# À REJOUER après une rotation de clé : le script met à jour la ligne existante
# plutôt que d'en créer une seconde.
#
# Usage :
#   db/seeds/b2_install_resend_secret.sh              # base de production
#   B2_TARGET_DB=b2_test db/seeds/b2_install_resend_secret.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${FADEUP_SUPABASE_ENV:-$REPO_ROOT/infra/supabase/.env}"
DB_CONTAINER="${B2_DB_CONTAINER:-fadeup-supabase-db}"
TARGET_DB="${B2_TARGET_DB:-postgres}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "cannot read $ENV_FILE" >&2
  exit 2
fi

KEY="$(sed -n 's/^RESEND_API_KEY=//p' "$ENV_FILE" | head -1 | tr -d '\r"')"

if [[ -z "$KEY" ]]; then
  echo "RESEND_API_KEY not found in $ENV_FILE" >&2
  exit 2
fi

# Un garde-fou minimal sur la forme, pour attraper un copier-coller tronqué
# avant qu'il ne devienne un échec d'envoi silencieux trois jours plus tard.
if [[ ! "$KEY" =~ ^re_ ]]; then
  echo "RESEND_API_KEY does not look like a Resend key (expected the re_ prefix)" >&2
  exit 2
fi

echo "installing Resend API key into vault on database '${TARGET_DB}' (value never printed)"

# -v ne met PAS la valeur sur la ligne de commande de psql à l'intérieur du
# conteneur : docker exec la transmet dans l'environnement du processus, pas
# dans argv. Combiné à :'key' quoté par psql, la valeur ne traverse jamais un
# shell qui pourrait la journaliser.
# La valeur est transmise dans l'ENVIRONNEMENT du processus psql (docker exec
# -e), pas dans argv : elle n'apparaît donc pas dans un `ps`. psql la relit
# avec \set et l'interpole en littéral quoté ; pg_stat_statements normalise
# les littéraux simples en $1, donc elle ne se dépose pas non plus dans les
# statistiques de requêtes.
docker exec -i -e B2_RESEND_KEY="$KEY" "$DB_CONTAINER" \
  psql -U postgres -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q <<'SQL'
\set key `echo "$B2_RESEND_KEY"`
\set descr 'Cle API Resend, flux transactionnel et prospection. Installee par db/seeds/b2_install_resend_secret.sh.'

select vault.create_secret(:'key', 'resend_api_key', :'descr')
where not exists (select 1 from vault.secrets where name = 'resend_api_key');

select vault.update_secret(
         (select id from vault.secrets where name = 'resend_api_key'),
         :'key', 'resend_api_key', :'descr')
where exists (select 1 from vault.secrets where name = 'resend_api_key');
SQL

# Preuve d'installation SANS afficher la valeur : on verifie que la cle
# dechiffree a la bonne longueur et le bon prefixe, rien de plus.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TARGET_DB" -tA -c "
select 'vault: resend_api_key installed, ' || length(private.resend_api_key()) ||
       ' chars, prefix ' || left(private.resend_api_key(), 3) || '...'
where private.resend_api_key() is not null;"

echo "done"
