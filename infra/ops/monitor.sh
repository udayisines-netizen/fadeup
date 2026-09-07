#!/bin/bash
# FadeUp ops — supervision de l'hôte et de la pile.
#
# PHILOSOPHIE. Un script qui vérifie et alerte, pas une pile de supervision.
# Chaque contrôle passe par alert.sh, qui est à état : une condition qui
# persiste n'envoie qu'un rappel par 24 h, et son rétablissement envoie un
# message OK. Peu de seuils, choisis pour signifier « il faut agir » :
#
#   disque   ≥ 80 %      (l'incident de la semaine est parti de 100 %)
#   mémoire  disponible < 250 Mo  (MemAvailable, pas MemFree : le cache compte)
#   conteneurs : chacun de la liste EXPECTED_CONTAINERS doit être running et,
#                s'il a un healthcheck, healthy — un conteneur en boucle de
#                redémarrage apparaît restarting/unhealthy
#   heartbeat scheduler : /tmp/last-tick dans le conteneur, < 300 s
#                (double le healthcheck Docker : si Docker lui-même ment ou si
#                le conteneur a été recréé sans healthcheck, on le voit ici)
#   fraîcheur sauvegarde : dernier succès < 26 h (24 h + marge de cron)
#
# Contrôles quotidiens (--daily, lancé par une entrée cron distincte) :
#   TLS fade-up.com : alerte si expiration < 14 jours — Let's Encrypt
#                renouvelle à J-30, donc J-14 encore rouge = renouvellement
#                cassé et il reste deux semaines pour agir
#
# La sonde des 21 RPC publiques est une entrée cron séparée (probe-rpcs),
# car elle vit dans db/tests/ et a son propre rythme (15 min).

set -uo pipefail  # pas -e : un contrôle qui casse ne doit pas masquer les suivants

OPS_DIR="${OPS_DIR:-$HOME/ops}"
OPS_ENV="${OPS_ENV:-$OPS_DIR/.env}"
# shellcheck disable=SC1090
. "$OPS_ENV"

ALERT="$OPS_DIR/alert.sh"
STATE_DIR="${OPS_STATE_DIR:-$OPS_DIR/state}"
DISK_ALERT_PCT="${DISK_ALERT_PCT:-80}"
MEM_MIN_MB="${MEM_MIN_MB:-250}"
HEARTBEAT_MAX_AGE="${HEARTBEAT_MAX_AGE:-300}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
TLS_MIN_DAYS="${TLS_MIN_DAYS:-14}"
TLS_HOST="${TLS_HOST:-fade-up.com}"
EXPECTED_CONTAINERS="${EXPECTED_CONTAINERS:-fadeup-supabase-db fadeup-supabase-kong fadeup-supabase-auth fadeup-supabase-rest fadeup-supabase-storage fadeup-supabase-meta fadeup-supabase-pooler fadeup-supabase-edge-functions fadeup-supabase-imgproxy fadeup-supabase-studio fadeup-realtime.supabase-realtime fadeup-web fadeup-scheduler}"

# --- disque ------------------------------------------------------------------
pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${pct:-0}" -ge "$DISK_ALERT_PCT" ]; then
  "$ALERT" raise disk "Disque à ${pct}%" \
    "Le disque / est à ${pct}% (seuil ${DISK_ALERT_PCT}%).
C'est la condition qui a failli tuer une migration cette semaine.
Pistes immédiates : docker system df, /opt/fadeup/backups, journaux."
else
  "$ALERT" clear disk "Disque à ${pct}%"
fi

# --- mémoire -----------------------------------------------------------------
avail_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "${avail_mb:-0}" -lt "$MEM_MIN_MB" ]; then
  swap_used=$(awk '/SwapTotal/{t=$2}/SwapFree/{f=$2}END{print int((t-f)/1024)}' /proc/meminfo)
  "$ALERT" raise memory "Mémoire disponible ${avail_mb} Mo" \
    "MemAvailable = ${avail_mb} Mo (seuil ${MEM_MIN_MB} Mo), swap utilisé ${swap_used} Mo.
Le prochain pic (build, restauration) peut déclencher l'OOM killer."
else
  "$ALERT" clear memory "Mémoire disponible ${avail_mb} Mo"
fi

# --- conteneurs --------------------------------------------------------------
bad=""
for c in $EXPECTED_CONTAINERS; do
  state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohc{{end}}' "$c" 2>/dev/null || echo "absent absent")
  case "$state" in
    "running healthy"|"running nohc") ;;
    *) bad="$bad$c: $state
" ;;
  esac
done
if [ -n "$bad" ]; then
  "$ALERT" raise containers "Conteneur(s) en défaut" \
    "État attendu : running (+healthy si healthcheck). Constaté :
$bad
docker ps -a et docker logs <nom> pour le détail."
else
  "$ALERT" clear containers "Conteneur(s) en défaut"
fi

# --- heartbeat scheduler -----------------------------------------------------
hb=$(docker exec fadeup-scheduler cat /tmp/last-tick 2>/dev/null || echo 0)
age=$(( $(date +%s) - hb ))
if [ "$hb" = "0" ] || [ "$age" -gt "$HEARTBEAT_MAX_AGE" ]; then
  "$ALERT" raise scheduler-heartbeat "Scheduler sans battement depuis ${age}s" \
    "Le scheduler porte l'expiration des demandes, les e-mails, les essais et
la facturation. Dernier battement il y a ${age}s (seuil ${HEARTBEAT_MAX_AGE}s).
docker logs fadeup-scheduler --tail 50"
else
  "$ALERT" clear scheduler-heartbeat "Scheduler sans battement"
fi

# --- fraîcheur de la sauvegarde ----------------------------------------------
last=$(cat "$STATE_DIR/backup-last-success" 2>/dev/null || echo 0)
bage_h=$(( ( $(date +%s) - last ) / 3600 ))
if [ "$last" = "0" ] || [ "$bage_h" -ge "$BACKUP_MAX_AGE_H" ]; then
  "$ALERT" raise backup-freshness "Dernière sauvegarde il y a ${bage_h} h" \
    "Aucune sauvegarde réussie depuis ${bage_h} h (seuil ${BACKUP_MAX_AGE_H} h).
La passe quotidienne n'a pas abouti — ou n'a pas tourné du tout, ce que
l'alerte d'échec de backup.sh ne peut pas voir (cron arrêté, crontab perdue)."
else
  "$ALERT" clear backup-freshness "Dernière sauvegarde"
fi

# --- webhooks Stripe bloqués -------------------------------------------------
# Un webhook Stripe qui échoue en silence et la base ne sait plus qui paie.
# Plutôt que d'instrumenter les fonctions Edge de production (risque > gain),
# on lit la file d'événements de B3 : un événement encore queued/failed une
# heure après réception a raté son traitement par run_billing_maintenance.
stuck=$(docker exec fadeup-supabase-db psql -U supabase_admin -d postgres -qAtc \
  "select count(*) from public.stripe_webhook_events
    where status <> 'processed' and received_at < now() - interval '1 hour';" 2>/dev/null || echo "err")
if [ "$stuck" = "err" ]; then
  : # la panne de la base est déjà couverte par le contrôle conteneurs
elif [ "${stuck:-0}" -gt 0 ]; then
  "$ALERT" raise stripe-webhooks "$stuck webhook(s) Stripe non traités" \
    "$stuck événement(s) dans stripe_webhook_events restent non 'processed'
plus d'une heure après réception. La facturation dérive de la réalité Stripe.
select event_id, event_type, status, error, attempts from
public.stripe_webhook_events where status <> 'processed';"
else
  "$ALERT" clear stripe-webhooks "Webhooks Stripe non traités"
fi

# --- contrôles quotidiens ----------------------------------------------------
if [ "${1:-}" = "--daily" ]; then
  end=$(echo | timeout 20 openssl s_client -connect "$TLS_HOST:443" -servername "$TLS_HOST" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
  if [ -z "$end" ]; then
    "$ALERT" raise tls "Certificat TLS de $TLS_HOST illisible" \
      "Impossible de lire le certificat de $TLS_HOST:443 depuis l'hôte.
Soit le service est tombé, soit le TLS est cassé — les deux sont graves."
  else
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    if [ "$days" -lt "$TLS_MIN_DAYS" ]; then
      "$ALERT" raise tls "TLS $TLS_HOST expire dans ${days} j" \
        "Le certificat de $TLS_HOST expire le $end (dans ${days} jours).
Let's Encrypt renouvelle normalement à J-30 : le renouvellement est cassé.
Vérifier certbot/nginx sur l'hôte (root requis)."
    else
      "$ALERT" clear tls "TLS $TLS_HOST"
    fi
  fi
fi

# --- dead-man ----------------------------------------------------------------
# Si cron ou ce script meurent, tout l'alerting meurt en silence avec eux.
# Un service de heartbeat externe (healthchecks.io, gratuit) inverse la
# logique : c'est LUI qui alerte quand ce ping cesse d'arriver. Optionnel
# tant que le fondateur n'a pas créé le check (README §3).
if [ -n "${HEALTHCHECKS_PING_URL:-}" ]; then
  curl -sS -m 10 -o /dev/null "$HEALTHCHECKS_PING_URL" || true
fi

exit 0
