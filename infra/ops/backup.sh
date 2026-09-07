#!/bin/bash
# FadeUp ops — sauvegarde quotidienne de la base et du volume storage.
#
# POURQUOI CRON ET PAS LE SCHEDULER. Le conteneur fadeup-scheduler se connecte
# en fadeup_scheduler, un rôle qui détient EXECUTE sur six fonctions de
# maintenance et AUCUN privilège de table — c'est un choix de sécurité
# délibéré (cf. infra/scheduler/docker-compose.yml). Un pg_dump exige la
# lecture de toute la base ; l'y ajouter aurait détruit ce cloisonnement, et
# monter le socket Docker dans le scheduler aurait été pire. Une tâche cron
# système de l'utilisateur `fadeup`, qui a déjà accès à Docker, est le chemin
# le plus court et le moins privilégié en pratique.
#
# CE QUE FAIT UNE PASSE
#   1. pg_dump -Fc de la base entière, exécuté dans fadeup-supabase-db
#      (même binaire que le serveur, aucun risque de décalage de version) ;
#   2. contrôle de cohérence : pg_restore --list doit lire le dump, et sa
#      taille doit dépasser BACKUP_MIN_BYTES (un dump tronqué de 40 Ko qui
#      "réussit" est le pire des échecs silencieux) ;
#   3. archive tar du volume storage (fichiers des buckets passport-photos,
#      post-media, review-photos — le pg_dump ne couvre pas les octets) ;
#   4. chiffrement GPG symétrique AES-256 (RGPD : coordonnées clients dans la
#      base ; un dump en clair sur un stockage tiers est exclu). Rien ne
#      quitte cette machine en clair, et rien n'y reste en clair non plus ;
#   5. rétention locale : 7 quotidiennes, 4 hebdomadaires (dimanche),
#      3 mensuelles (le 1er) ;
#   6. copie hors serveur via rclone si configurée (BACKUP_REMOTE dans .env
#      + ~/.config/rclone/rclone.conf), avec relecture de la liste distante ;
#      sinon, rappel hebdomadaire — pas quotidien — que la copie manque ;
#   7. tout échec déclenche une alerte par alert.sh (chemin Resend direct,
#      indépendant de la base sauvegardée).
#
# LA PASSPHRASE EST LA SAUVEGARDE. Si elle n'existe que sur ce disque, les
# copies chiffrées meurent avec lui. Le fondateur DOIT en garder une copie
# hors serveur (gestionnaire de mots de passe) — voir README.md §2.

set -euo pipefail

# rclone est installé sans root dans ~/bin, que cron ne met pas dans PATH.
PATH="$HOME/bin:$PATH"

OPS_DIR="${OPS_DIR:-$HOME/ops}"
OPS_ENV="${OPS_ENV:-$OPS_DIR/.env}"
# shellcheck disable=SC1090
. "$OPS_ENV"

ALERT="$OPS_DIR/alert.sh"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/fadeup/backups/auto}"
STORAGE_VOLUME="${STORAGE_VOLUME:-/opt/fadeup/infra/supabase/volumes/storage}"
DB_CONTAINER="${DB_CONTAINER:-fadeup-supabase-db}"
PASSFILE="${BACKUP_PASSPHRASE_FILE:-$OPS_DIR/backup.passphrase}"
MIN_BYTES="${BACKUP_MIN_BYTES:-1000000}"
STATE_DIR="${OPS_STATE_DIR:-$OPS_DIR/state}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DOW="$(date +%u)"   # 7 = dimanche
DOM="$(date +%d)"

fail() {
  echo "backup.sh: ÉCHEC: $1" >&2
  "$ALERT" raise backup "Sauvegarde quotidienne en échec" \
    "La passe de sauvegarde $STAMP a échoué : $1

Aucun nouveau dump n'a été produit. Vérifier ~/ops/ops.log et l'espace disque." || true
  exit 1
}

[ -r "$PASSFILE" ] || fail "passphrase illisible ($PASSFILE)"
mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly" "$STATE_DIR"

workdir="$(mktemp -d "${TMPDIR:-/tmp}/fadeup-backup.XXXXXX")"
trap 'rm -rf "$workdir"; docker exec "$DB_CONTAINER" rm -f /tmp/fadeup-daily.dump 2>/dev/null || true' EXIT

# --- 1. dump -----------------------------------------------------------------
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres -Fc \
  -f /tmp/fadeup-daily.dump \
  || fail "pg_dump a retourné une erreur"
docker cp "$DB_CONTAINER:/tmp/fadeup-daily.dump" "$workdir/db-$STAMP.dump" \
  || fail "docker cp du dump a échoué"

# --- 2. cohérence ------------------------------------------------------------
size=$(stat -c%s "$workdir/db-$STAMP.dump")
[ "$size" -ge "$MIN_BYTES" ] || fail "dump anormalement petit ($size octets < $MIN_BYTES)"
docker exec "$DB_CONTAINER" pg_restore --list /tmp/fadeup-daily.dump >/dev/null \
  || fail "pg_restore --list ne peut pas lire le dump produit"

# --- 3. storage --------------------------------------------------------------
tar -C "$(dirname "$STORAGE_VOLUME")" -czf "$workdir/storage-$STAMP.tar.gz" \
  "$(basename "$STORAGE_VOLUME")" \
  || fail "archive tar du volume storage a échoué"

# --- 4. chiffrement ----------------------------------------------------------
for f in "db-$STAMP.dump" "storage-$STAMP.tar.gz"; do
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase-file "$PASSFILE" \
      -o "$BACKUP_ROOT/daily/$f.gpg" "$workdir/$f" \
    || fail "chiffrement GPG de $f a échoué"
done

# --- 5. rétention ------------------------------------------------------------
if [ "$DOW" = "7" ]; then
  cp "$BACKUP_ROOT/daily/db-$STAMP.dump.gpg" "$BACKUP_ROOT/weekly/" || fail "promotion hebdomadaire"
  cp "$BACKUP_ROOT/daily/storage-$STAMP.tar.gz.gpg" "$BACKUP_ROOT/weekly/" || true
fi
if [ "$DOM" = "01" ]; then
  cp "$BACKUP_ROOT/daily/db-$STAMP.dump.gpg" "$BACKUP_ROOT/monthly/" || fail "promotion mensuelle"
  cp "$BACKUP_ROOT/daily/storage-$STAMP.tar.gz.gpg" "$BACKUP_ROOT/monthly/" || true
fi
prune() { # prune <dir> <motif> <n conservés>
  # || true : un répertoire encore vide (premiers jours) n'est pas un échec.
  { ls -1t "$1"/$2 2>/dev/null || true; } | tail -n +"$(( $3 + 1 ))" | while read -r old; do
    rm -f "$old"
  done
}
prune "$BACKUP_ROOT/daily"   'db-*.dump.gpg'        7
prune "$BACKUP_ROOT/daily"   'storage-*.tar.gz.gpg' 7
prune "$BACKUP_ROOT/weekly"  'db-*.dump.gpg'        4
prune "$BACKUP_ROOT/weekly"  'storage-*.tar.gz.gpg' 4
prune "$BACKUP_ROOT/monthly" 'db-*.dump.gpg'        3
prune "$BACKUP_ROOT/monthly" 'storage-*.tar.gz.gpg' 3

# --- 6. copie hors serveur ---------------------------------------------------
if [ -n "${BACKUP_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone sync "$BACKUP_ROOT" "$BACKUP_REMOTE" --transfers 2 --checkers 2 \
    || fail "rclone sync vers $BACKUP_REMOTE a échoué"
  remote_count=$(rclone ls "$BACKUP_REMOTE/daily" 2>/dev/null | wc -l)
  [ "$remote_count" -ge 1 ] || fail "la liste distante est vide après sync"
  "$ALERT" clear backup-offsite "Copie hors serveur des sauvegardes" || true
else
  # Rappel hebdomadaire, pas quotidien : c'est un état connu et documenté,
  # pas un incident — mais l'oublier trois mois serait un incident.
  ALERT_REPEAT_SECONDS=604800 "$ALERT" raise backup-offsite \
    "Sauvegardes : copie hors serveur non configurée" \
    "Les dumps chiffrés n'existent que sur le disque du serveur.
Suivre infra/ops/README.md §2 (identifiants S3/OVH + rclone) pour activer la copie distante." || true
fi

echo "$(date +%s)" > "$STATE_DIR/backup-last-success"
"$ALERT" clear backup "Sauvegarde quotidienne en échec" || true
echo "backup.sh: OK $STAMP (db $size octets)"
