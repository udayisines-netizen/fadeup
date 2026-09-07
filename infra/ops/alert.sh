#!/bin/sh
# FadeUp ops — canal d'alerte.
#
# POURQUOI CE CHEMIN. L'e-mail applicatif (email_outbox + scheduler + pg_net)
# dépend exactement de ce que la supervision surveille : si la base ou le
# scheduler tombe, l'alerte tombe avec. Ce script appelle l'API Resend
# DIRECTEMENT depuis l'hôte, en curl. Il ne touche ni la base, ni Kong, ni un
# conteneur. Il survit donc à la panne de n'importe quel morceau de la pile
# FadeUp. Ce qu'il ne couvre pas — l'hôte mort, le réseau coupé, Resend en
# panne — est couvert par le moniteur HTTP externe documenté dans README.md.
#
# ANTI-BRUIT. Une alerte qui part tous les jours est ignorée en une semaine.
# Ce script est à état : pour une clé donnée, `raise` n'envoie que si l'état
# vient de basculer, puis au plus une fois par ALERT_REPEAT_SECONDS tant que
# la condition persiste. `clear` envoie UN message de rétablissement si et
# seulement si une alerte était ouverte.
#
# Usage :
#   alert.sh raise <clé> <sujet> <corps>
#   alert.sh clear <clé> <sujet>
#
# Codes retour : 0 = état géré (envoyé ou volontairement silencieux),
#                1 = l'envoi a été tenté et a échoué (Resend/réseau).
#
# Configuration : $OPS_ENV (défaut ~/ops/.env) doit définir RESEND_API_KEY,
# ALERT_EMAIL, ALERT_FROM. Voir env.example.

set -eu

OPS_ENV="${OPS_ENV:-$HOME/ops/.env}"
# shellcheck disable=SC1090
. "$OPS_ENV"

: "${RESEND_API_KEY:?RESEND_API_KEY manquant dans $OPS_ENV}"
: "${ALERT_EMAIL:?ALERT_EMAIL manquant dans $OPS_ENV}"
: "${ALERT_FROM:?ALERT_FROM manquant dans $OPS_ENV}"

STATE_DIR="${OPS_STATE_DIR:-$HOME/ops/state}"
REPEAT="${ALERT_REPEAT_SECONDS:-86400}"
mkdir -p "$STATE_DIR"

ACTION="${1:?usage: alert.sh raise|clear <clé> <sujet> [corps]}"
KEY="${2:?clé manquante}"
SUBJECT="${3:?sujet manquant}"
BODY="${4:-}"
STATE_FILE="$STATE_DIR/alert-$KEY"
HOSTNAME_TAG="$(hostname 2>/dev/null || echo fadeup-host)"

send_email() {
  # jq n'est pas garanti sur l'hôte : le JSON est assemblé à la main, donc le
  # texte passe par un échappement minimal (guillemets, antislash, retours).
  subj="$1"; text="$2"
  # Corps : les retours à la ligne réels deviennent des \n JSON, sans \n final.
  esc_body() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "\\n"} {printf "%s", $0}'; }
  # Sujet : mono-ligne obligatoire (Resend refuse tout \n dans subject).
  esc_subj() { printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
  payload=$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
    "$ALERT_FROM" "$ALERT_EMAIL" "$(esc_subj "$subj")" "$(esc_body "$text")")
  response=$(curl -sS -m 20 -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1) || {
    echo "alert.sh: envoi Resend échoué: $response" >&2
    return 1
  }
  case "$response" in
    *'"id"'*) echo "alert.sh: envoyé ($subj) -> $response" ;;
    *) echo "alert.sh: Resend a refusé: $response" >&2; return 1 ;;
  esac
}

now=$(date +%s)

case "$ACTION" in
  raise)
    if [ -f "$STATE_FILE" ]; then
      last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
      if [ $((now - last)) -lt "$REPEAT" ]; then
        exit 0  # alerte déjà ouverte et rappelée il y a moins de REPEAT
      fi
    fi
    if send_email "[FadeUp ALERTE] $SUBJECT" "Hôte: $HOSTNAME_TAG
Clé: $KEY
Heure: $(date -u +%FT%TZ)

$BODY"; then
      echo "$now" > "$STATE_FILE"
    else
      # L'échec d'envoi est journalisé (cron -> ops.log). On garde l'état
      # absent pour que la prochaine passe retente immédiatement.
      exit 1
    fi
    ;;
  clear)
    if [ -f "$STATE_FILE" ]; then
      rm -f "$STATE_FILE"
      send_email "[FadeUp OK] $SUBJECT" "Hôte: $HOSTNAME_TAG
Clé: $KEY
Heure: $(date -u +%FT%TZ)

La condition est revenue à la normale." || true
    fi
    ;;
  *)
    echo "action inconnue: $ACTION" >&2
    exit 2
    ;;
esac
