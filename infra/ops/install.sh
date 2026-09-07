#!/bin/bash
# FadeUp ops — installation/mise à jour de l'exécution.
#
# Copie les scripts versionnés (ce répertoire) vers ~/ops/, crée .env et la
# passphrase au premier passage, installe la crontab de l'utilisateur fadeup.
#
# POURQUOI ~/ops ET PAS LE REPO. La crontab doit pointer vers un chemin stable
# qui survit aux changements de branche : /opt/fadeup suit rebuild/social-first-v2
# et les worktrees vont et viennent. ~/ops est la copie déployée ; ce
# répertoire du repo est la source. Relancer install.sh redéploie.
#
# Idempotent : relançable sans risque ; .env, passphrase et état existants
# ne sont jamais écrasés.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="${OPS_DIR:-$HOME/ops}"
SUPABASE_ENV="${SUPABASE_ENV:-/opt/fadeup/infra/supabase/.env}"

mkdir -p "$OPS_DIR/state"
for f in alert.sh backup.sh restore-check.sh monitor.sh probe-rpcs.sh; do
  install -m 750 "$SRC/$f" "$OPS_DIR/$f"
done

# --- .env --------------------------------------------------------------------
if [ ! -f "$OPS_DIR/.env" ]; then
  key=$(sed -n 's/^RESEND_API_KEY=//p' "$SUPABASE_ENV" | head -1 | tr -d '"\r')
  if [ -z "$key" ]; then
    echo "install.sh: RESEND_API_KEY introuvable dans $SUPABASE_ENV — compléter $OPS_DIR/.env à la main" >&2
    key="re_A_REMPLIR"
  fi
  cat > "$OPS_DIR/.env" <<EOF
RESEND_API_KEY=$key
ALERT_EMAIL=${ALERT_EMAIL:-udayisbarwane@gmail.com}
ALERT_FROM="FadeUp Ops <ops@contact.fade-up.com>"
BACKUP_REMOTE=
EOF
  chmod 600 "$OPS_DIR/.env"
  echo "install.sh: $OPS_DIR/.env créé"
fi

# --- passphrase --------------------------------------------------------------
if [ ! -f "$OPS_DIR/backup.passphrase" ]; then
  umask 077
  openssl rand -base64 48 | tr -d '\n' > "$OPS_DIR/backup.passphrase"
  umask 022
  echo "install.sh: passphrase générée dans $OPS_DIR/backup.passphrase"
  echo "install.sh: >>> LE FONDATEUR DOIT LA COPIER HORS SERVEUR (README.md §2) <<<"
fi

# --- crontab -----------------------------------------------------------------
# Marqueurs pour ne gérer que notre bloc et laisser intact tout le reste.
BEGIN="# BEGIN fadeup-ops (géré par infra/ops/install.sh)"
END="# END fadeup-ops"
current=$(crontab -l 2>/dev/null || true)
without=$(printf '%s\n' "$current" | awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}')
block=$(cat <<EOF
$BEGIN
# Toute sortie va dans ops.log (rotation : voir README). MAILTO vide car
# aucun MTA local — les alertes partent par alert.sh, pas par cron.
MAILTO=""
*/5 * * * *  $OPS_DIR/monitor.sh          >> $OPS_DIR/ops.log 2>&1
*/15 * * * * $OPS_DIR/probe-rpcs.sh       >> $OPS_DIR/ops.log 2>&1
15 4 * * *   $OPS_DIR/backup.sh           >> $OPS_DIR/ops.log 2>&1
45 4 * * 0   $OPS_DIR/restore-check.sh    >> $OPS_DIR/ops.log 2>&1
5 6 * * *    $OPS_DIR/monitor.sh --daily  >> $OPS_DIR/ops.log 2>&1
$END
EOF
)
printf '%s\n%s\n' "$without" "$block" | sed '/^$/N;/^\n$/D' | crontab -
echo "install.sh: crontab installée :"
crontab -l | awk -v b="$BEGIN" -v e="$END" '$0==b{p=1} p{print} $0==e{p=0}'
